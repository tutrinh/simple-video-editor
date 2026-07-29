import type { Sticker, SfxSegment } from "../../domain/types";
import { stickerFileUrl } from "../../lib/stickerLibrary";


// The SHARED Sticker renderer (ADR-0011, obeying ADR-0008). One function composes
// a Sticker onto a full-frame transparent bitmap at export resolution; the preview
// displays that bitmap CSS-scaled and the export hands the identical PNG to ffmpeg
// `overlay`. Position, scale and rotation therefore cannot drift between the two
// sides — the same code computes both.
//
// Mirrors titleCanvas.ts, which does exactly this for Title overlays.

/** Where a Sticker lands, in export pixels. Pure, so the geometry is unit-testable. */
export interface StickerRect {
  /** Centre of the drawn image. */
  cx: number;
  cy: number;
  /** Drawn size, preserving the asset's aspect ratio. */
  width: number;
  height: number;
  /** Clockwise degrees, matching CSS `rotate()` and ffmpeg `rotate` alike. */
  rotationDeg: number;
}

const MIN_SCALE = 0.01;
const MAX_SCALE = 2;

const clamp = (n: number, lo: number, hi: number) => (n < lo ? lo : n > hi ? hi : n);

/**
 * The destination box for a Sticker on a w×h frame.
 *
 * `scale` is a fraction of the frame's WIDTH regardless of aspect, so a sticker
 * keeps its apparent size when a Cut is re-aimed from 16:9 to 9:16. Height comes
 * from the asset's own aspect ratio, never from the frame's.
 */
export function stickerRect(
  sticker: Pick<Sticker, "x" | "y" | "scale" | "rotation">,
  frameW: number,
  frameH: number,
  assetW: number,
  assetH: number,
): StickerRect {
  const scale = clamp(sticker.scale, MIN_SCALE, MAX_SCALE);
  const width = frameW * scale;
  const aspect = assetW > 0 && assetH > 0 ? assetH / assetW : 1;
  return {
    cx: clamp(sticker.x, 0, 1) * frameW,
    cy: clamp(sticker.y, 0, 1) * frameH,
    width,
    height: width * aspect,
    rotationDeg: clamp(sticker.rotation, -180, 180),
  };
}

/**
 * Everything `drawSticker` reads, as one string. Memo keys derive from this
 * rather than hand-listing fields, so adding a visual property can never leave a
 * cache stale — which is exactly what happened when the tint was added and the
 * preview kept showing the untinted bitmap.
 *
 * Deliberately excludes timing, which does not change pixels.
 */
export function stickerRenderKey(s: Sticker): string {
  return [
    s.id,
    s.fileName,
    s.x,
    s.y,
    s.scale,
    s.rotation,
    s.opacity,
    s.tintColor ?? "",
    s.tintStrength ?? 0,
  ].join(":");
}

/** A Sticker's tint, normalised. Pure, so the clamping is unit-testable. */
export function stickerTint(sticker: Pick<Sticker, "tintColor" | "tintStrength">): { color: string; strength: number } {
  return {
    color: sticker.tintColor || "#ffffff",
    strength: clamp(sticker.tintStrength ?? 0, 0, 1),
  };
}

/**
 * Rasterise the asset at its DESTINATION size and lay the tint over it, clipped
 * to the asset's own alpha via `source-atop`. Destination size matters: an SVG
 * icon may be 24x24 intrinsically, and tinting before scaling would bake in that
 * resolution. Returns the image unchanged when there is no tint to apply.
 */
function tintedSource(
  img: CanvasImageSource,
  dw: number,
  dh: number,
  color: string,
  strength: number,
): CanvasImageSource {
  if (strength <= 0 || typeof document === "undefined") return img;
  const w = Math.max(1, Math.ceil(dw));
  const h = Math.max(1, Math.ceil(dh));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const cx = c.getContext("2d");
  if (!cx) return img;
  cx.drawImage(img, 0, 0, w, h);
  // source-atop paints only where the asset is already opaque and blends over
  // it, so a partial strength keeps some of the original colour and the alpha
  // channel survives untouched.
  cx.globalCompositeOperation = "source-atop";
  cx.globalAlpha = strength;
  cx.fillStyle = color;
  cx.fillRect(0, 0, w, h);
  return c;
}

/** Draw one Sticker onto a full-frame context. Translate to the centre, rotate, draw centred. */
export function drawSticker(
  ctx: CanvasRenderingContext2D,
  sticker: Sticker,
  img: CanvasImageSource,
  frameW: number,
  frameH: number,
  assetW: number,
  assetH: number,
): void {
  const r = stickerRect(sticker, frameW, frameH, assetW, assetH);
  const { color, strength } = stickerTint(sticker);
  const src = tintedSource(img, r.width, r.height, color, strength);
  ctx.save();
  ctx.globalAlpha = clamp(sticker.opacity ?? 1, 0, 1);
  ctx.translate(r.cx, r.cy);
  ctx.rotate((r.rotationDeg * Math.PI) / 180);
  ctx.drawImage(src, -r.width / 2, -r.height / 2, r.width, r.height);
  ctx.restore();
}

// One image per filename, shared by the preview and the export so an asset is
// decoded once. SVGs rasterise at whatever size they are drawn to, which is why
// the renderer always works at export resolution — a large `scale` stays sharp.
const imageCache = new Map<string, Promise<HTMLImageElement>>();

export function loadStickerImage(fileName: string): Promise<HTMLImageElement> {
  const hit = imageCache.get(fileName);
  if (hit) return hit;
  const p = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    // No crossOrigin: the asset is same-origin through the dev proxy, and setting
    // it would make this a CORS request for no benefit. Under the app's COEP
    // require-corp isolation a same-origin response is allowed as-is.
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Sticker asset failed to load: ${fileName}`));
    img.src = stickerFileUrl(fileName);
  });
  imageCache.set(fileName, p);
  return p;
}



/** Render Stickers onto one full-frame bitmap. Returns null off-DOM. */
export async function renderStickersToCanvas(
  stickers: Sticker[],
  w: number,
  h: number,
): Promise<HTMLCanvasElement | null> {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  for (const sticker of stickers) {
    try {
      const img = await loadStickerImage(sticker.fileName);
      drawSticker(ctx, sticker, img, w, h, img.naturalWidth, img.naturalHeight);
    } catch (err) {
      // A missing or undrawable asset skips that sticker rather than failing the
      // whole frame — the same tolerance the export gives a failed B-roll
      // pre-trim. Warn rather than fail silently: an invisible sticker with no
      // console trace is near-impossible to diagnose from the UI.
      console.warn(`[sticker] could not draw "${sticker.fileName}" — skipping`, err);
    }
  }
  return canvas;
}

import { createOffscreenOrDomCanvas, canvasToPngBuffer } from "../../lib/offscreenCanvas";

/** The export's entry point: the same bitmap the preview shows, as PNG bytes. */
export async function renderStickersToPng(
  stickers: Sticker[],
  w: number,
  h: number,
): Promise<Uint8Array | null> {
  const { canvas, ctx } = createOffscreenOrDomCanvas(w, h);
  if (!ctx) return null;
  for (const sticker of stickers) {
    try {
      const img = await loadStickerImage(sticker.fileName);
      drawSticker(ctx as CanvasRenderingContext2D, sticker, img, w, h, img.naturalWidth, img.naturalHeight);
    } catch (err) {
      console.warn(`[sticker] could not draw "${sticker.fileName}" — skipping`, err);
    }
  }
  try {
    return await canvasToPngBuffer(canvas);
  } catch (err) {
    console.warn("[sticker] canvas could not be exported to PNG", err);
    return null;
  }
}

/**
 * The Stickers visible at a moment in cut time.
 * Half-open on the end so a Sticker ending exactly where another starts does not
 * show both on the boundary frame.
 */
export function activeStickers(stickers: Sticker[] | undefined, cutSec: number): Sticker[] {
  return (stickers ?? []).filter((s) => cutSec >= s.startTimeSec && cutSec < s.startTimeSec + s.durationSec);
}

/**
 * A Sticker's window inside one Beat segment, in segment-local seconds, or null
 * when it does not overlap. Mirrors how B-roll Overlays are gated per segment.
 */
export function stickerWindowInSegment(
  sticker: Sticker,
  segStartSec: number,
  segDurationSec: number,
): { startSec: number; endSec: number } | null {
  const segEnd = segStartSec + segDurationSec;
  const from = Math.max(sticker.startTimeSec, segStartSec);
  const to = Math.min(sticker.startTimeSec + sticker.durationSec, segEnd);
  if (to <= from) return null;
  return { startSec: from - segStartSec, endSec: to - segStartSec };
}

/** One Beat's span in cut time. */
export interface BeatSpan {
  startSec: number;
  durationSec: number;
}

/** Beat spans in cut time — the same cumulative walk the timeline and export do. */
export function beatSpans(beats: { durationSec: number }[]): BeatSpan[] {
  const spans: BeatSpan[] = [];
  let acc = 0;
  for (const b of beats) {
    const durationSec = b.durationSec || 0;
    spans.push({ startSec: acc, durationSec });
    acc += durationSec;
  }
  return spans;
}

/**
 * A Sticker with its EFFECTIVE window applied.
 *
 * `fitToBeat` is resolved here rather than written into the Sticker, so
 * retrimming a Beat can never leave a stale duration behind. Returning a Sticker
 * (not a separate window type) means every downstream reader — the preview, the
 * export, the timeline chip — needs no change at all.
 */
export function resolveSticker(sticker: Sticker, spans: BeatSpan[]): Sticker {
  if (!sticker.fitToBeat || spans.length === 0) return sticker;
  const span =
    spans.find((s) => sticker.startTimeSec >= s.startSec && sticker.startTimeSec < s.startSec + s.durationSec) ??
    spans[spans.length - 1];
  return { ...sticker, startTimeSec: span.startSec, durationSec: span.durationSec };
}

/**
 * The furthest a Sticker's start may be dragged.
 *
 * A fitToBeat Sticker takes its length from whichever Beat it lands in, so it is
 * only bounded by the end of the Cut — bounding it by its stored duration would
 * pin it inside its current Beat and make it undraggable, which is the whole
 * point of dragging it.
 */
export function maxStickerStart(sticker: Sticker, totalDurSec: number): number {
  if (sticker.fitToBeat) return Math.max(0, totalDurSec - 0.05);
  return Math.max(0, totalDurSec - sticker.durationSec);
}

/** Every Sticker with its effective window applied. */
export function resolveStickers(stickers: Sticker[] | undefined, spans: BeatSpan[]): Sticker[] {
  return (stickers ?? []).map((s) => resolveSticker(s, spans));
}

/**
 * An SfxSegment with its EFFECTIVE window applied.
 * `fitToBeat` is resolved dynamically here based on beatSpans.
 */
export function resolveSfx(seg: SfxSegment, spans: BeatSpan[]): SfxSegment {
  if (!seg.fitToBeat || spans.length === 0) return seg;
  const span =
    spans.find((s) => seg.startTimeSec >= s.startSec && seg.startTimeSec < s.startSec + s.durationSec) ??
    spans[spans.length - 1];
  const targetDur = Math.round(Math.min(span.durationSec, seg.sourceDurationSec) * 10) / 10;
  return { ...seg, startTimeSec: span.startSec, durationSec: targetDur };
}

/** Every SfxSegment with its effective window applied. */
export function resolveSfxSegments(segs: SfxSegment[] | undefined, spans: BeatSpan[]): SfxSegment[] {
  return (segs ?? []).map((s) => resolveSfx(s, spans));
}

