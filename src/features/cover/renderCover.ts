import type { Aspect, ColorAdjustments, Cover, CoverTitle } from "../../domain/types";
import { canvasDims } from "../export/export";
import { gradePixel, isIdentityGrade } from "../../lib/grade";
import { rotationCoverScale } from "../../studio/util";
import { drawSticker, loadStickerImage } from "../export/stickerCanvas";
import { drawTitleLayer, ensureTitleFontFace, titleFontKey, type TitleRenderLayer } from "../export/titleCanvas";
import { getTitleFontBytes } from "../export/titleFonts";
import { findFontById } from "../../lib/googleFonts";
import { drawVeil } from "./veil";

// The one renderer (ADR-0021). The canvas the author edits on and the file that
// downloads are this same call at two sizes, so there is no second
// implementation for the two to drift apart — the failure mode that
// ARCHITECTURE_BACKLOG Candidate B documents sixteen times over.
//
// Order is load-bearing: crop → grade → Veil → Stickers → Titles. The Grade runs
// over the picture's pixels BEFORE anything composites on top, or it would grade
// the Veil and the text as well.

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);
const positive = (n: number) => (Number.isFinite(n) && n > 0 ? n : 1);

export interface CropRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/**
 * The region of the source picture that fills the canvas.
 *
 * **Cover-fit is the floor**, not contain. A Beat at zoom 1× is letterboxed —
 * `renderStillContained` pads to the canvas aspect so "scale 1.0 means the same
 * framing Beat.zoom 1× does" — but bars on a thumbnail are just a worse
 * thumbnail. So a Cover always fills. The consequence: for a source whose aspect
 * differs from the Cover's, a seeded framing shows a tighter crop than the Beat
 * did. That is the intent; for a source that matches, the two are identical.
 *
 * Focus follows `kenBurnsVisibleCenter`'s rule — it positions the crop within
 * the *leftover* space rather than centring on the focus point, so focus 50 sits
 * flush against the edge. Both leftovers stack into one: what cover-fit discards
 * and what zoom discards are the same axis, which is what lets a 16:9 source be
 * panned across while being cropped to 9:16 at zoom 1.
 */
export function coverCropRect(
  frameW: number,
  frameH: number,
  canvasW: number,
  canvasH: number,
  zoom: number,
  zoomX: number,
  zoomY: number,
): CropRect {
  const fw = positive(frameW);
  const fh = positive(frameH);
  const dstAspect = positive(canvasW) / positive(canvasH);

  // The largest canvas-aspect rectangle that fits inside the source.
  const srcAspect = fw / fh;
  const baseW = srcAspect > dstAspect ? fh * dstAspect : fw;
  const baseH = srcAspect > dstAspect ? fh : fw / dstAspect;

  const z = Math.max(1, Number.isFinite(zoom) ? zoom : 1);
  const sw = baseW / z;
  const sh = baseH / z;

  const fx = clamp01(0.5 + (Number.isFinite(zoomX) ? zoomX : 0) / 100);
  const fy = clamp01(0.5 + (Number.isFinite(zoomY) ? zoomY : 0) / 100);

  return { sx: (fw - sw) * fx, sy: (fh - sh) * fy, sw, sh };
}

/**
 * Draw the cropped picture, rotated about the centre.
 *
 * Rotation scales the picture up by `rotationCoverScale` so the corners it
 * exposes stay off-frame. A Beat deliberately leaves those corners showing
 * (`util.ts:359`), but a cover image is a finished deliverable — wedges of
 * background in the corners read as broken rather than as a style.
 *
 * Separated from `renderCover` so the transform is assertable: canvas cannot be
 * inspected in this project's default test environment, but the call sequence
 * can.
 */
export function drawCoverPicture(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  crop: CropRect,
  w: number,
  h: number,
  rotation = 0,
): void {
  const deg = Number.isFinite(rotation) ? rotation : 0;
  ctx.save();
  if (deg !== 0) {
    const cover = rotationCoverScale(w, h, deg);
    ctx.translate(w / 2, h / 2);
    ctx.rotate((deg * Math.PI) / 180);
    ctx.scale(cover, cover);
    ctx.drawImage(source, crop.sx, crop.sy, crop.sw, crop.sh, -w / 2, -h / 2, w, h);
  } else {
    ctx.drawImage(source, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, w, h);
  }
  ctx.restore();
}

/**
 * Run the Grade over the picture already on the canvas.
 *
 * `gradePixel` is the reference transform both export emitters derive from
 * (ADR-0010), so this is not a third emitter — it is the thing itself, and more
 * faithful than the export's interpolated 33³ lattice. Identity Grades skip the
 * pass entirely, which is the common case while the author is dragging a
 * position slider.
 */
export function applyGradeToCanvas(
  ctx: CanvasRenderingContext2D,
  grade: ColorAdjustments | undefined,
  w: number,
  h: number,
): void {
  if (!grade || isIdentityGrade(grade)) return;
  const image = ctx.getImageData(0, 0, w, h);
  const d = image.data;
  for (let i = 0; i < d.length; i += 4) {
    const out = gradePixel(grade, [d[i] / 255, d[i + 1] / 255, d[i + 2] / 255]);
    // Uint8ClampedArray rounds and clamps on assignment.
    d[i] = out[0] * 255;
    d[i + 1] = out[1] * 255;
    d[i + 2] = out[2] * 255;
  }
  ctx.putImageData(image, 0, 0);
}

/**
 * How much smaller this render is than the Cover's true output size.
 *
 * Everything else a Cover carries is already relative — the crop is a fraction
 * of the source, a Sticker's scale is a fraction of frame width, the Veil fills
 * whatever it is given — but a Title's `sizePx` and `letterSpacing` are absolute
 * pixels, authored against the full canvas. Drawn unscaled onto a smaller proof
 * they occupy a far larger share of the frame and wrap differently, which is
 * exactly how the on-screen canvas and the downloaded file came to disagree.
 */
export function coverRenderScale(aspect: Aspect, w: number): number {
  const [fullW] = canvasDims(aspect);
  if (!(fullW > 0) || !Number.isFinite(w) || w <= 0) return 1;
  return w / fullW;
}

/**
 * A Cover's title with its font resolved, ready for `drawTitleLayer`.
 *
 * `scale` converts the authored, output-space sizes into whatever size this
 * particular render is happening at.
 */
export async function resolveCoverTitle(title: CoverTitle, scale = 1): Promise<TitleRenderLayer> {
  const weight = title.weight ?? 400;
  const fontBytes = title.fontId
    ? await getTitleFontBytes(title.fontId, weight, title.fontFile)
    : undefined;
  const cssFamily = (title.fontId ? findFontById(title.fontId)?.cssFamily : undefined) ?? "sans-serif";
  const canvasFamily = await ensureTitleFontFace(
    titleFontKey(cssFamily, weight, fontBytes?.length),
    fontBytes,
    cssFamily,
  );
  return {
    text: title.text,
    canvasFamily,
    cssFamily,
    fontBytes,
    fontWeight: weight,
    sizePx: title.sizePx * scale,
    letterSpacing: title.letterSpacing === undefined ? undefined : title.letterSpacing * scale,
    arcDeg: title.arcDeg,
    rotation: title.rotation,
    shadow: title.shadow,
    color: title.color,
    posX: title.posX,
    posY: title.posY,
    boxWidthPct: title.boxWidthPct,
    lineHeight: title.lineHeight,
    maskMode: title.maskMode,
    maskColor: title.maskColor,
  };
}

/** The Titles a Cover actually draws: enabled, and carrying text. */
export function visibleTitles(titles: CoverTitle[]): CoverTitle[] {
  return titles.filter((t) => t.enabled && t.text.trim().length > 0);
}

/**
 * Draw a Cover onto a context sized `w`×`h`.
 *
 * `source` is the decoded frame. The caller owns decoding and sizing, so the
 * editor's proof canvas and the full-resolution download are the same call.
 */
export async function renderCover(
  ctx: CanvasRenderingContext2D,
  cover: Cover,
  source: CanvasImageSource,
  sourceW: number,
  sourceH: number,
  w: number,
  h: number,
): Promise<void> {
  const crop = coverCropRect(sourceW, sourceH, w, h, cover.zoom, cover.zoomX, cover.zoomY);

  ctx.clearRect(0, 0, w, h);
  drawCoverPicture(ctx, source, crop, w, h, cover.rotation ?? 0);

  applyGradeToCanvas(ctx, cover.grade, w, h);
  drawVeil(ctx, cover.veil, w, h);

  for (const sticker of cover.stickers) {
    const img = await loadStickerImage(sticker.fileName);
    drawSticker(ctx, sticker, img, w, h, img.naturalWidth, img.naturalHeight);
  }

  // Titles carry absolute pixel sizes authored against the full canvas, so they
  // are the one thing that has to be told how big this render is.
  const scale = coverRenderScale(cover.aspect, w);
  for (const title of visibleTitles(cover.titles)) {
    await drawTitleLayer(ctx, await resolveCoverTitle(title, scale), w, h);
  }
}
