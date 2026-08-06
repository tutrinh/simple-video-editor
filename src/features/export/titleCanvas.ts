// Shared browser-native title renderer (ADR-0008).
//
// The SAME function draws a title layer in two places:
//   • the preview — onto a visible <canvas> at full export resolution, then
//     CSS-scaled down to the preview box;
//   • the export — onto an offscreen canvas → PNG → ffmpeg `overlay`.
//
// One rendering engine (the browser's own text layout) → the exported title is
// pixel-identical to the preview: same font, weight, letter-spacing, wrapping,
// shadow, and position. This replaces ffmpeg `drawtext`, which had no CSS
// letter-spacing, different shaping, and a guessed wrap width.
//
// The canvas is ALWAYS drawn at export pixels (e.g. 1920×1080). The preview
// shows that same bitmap scaled down, so geometry lives in one unit system and
// wrap boundaries can never flip between the two sides.

/** The fields the renderer needs. Both the preview layer and the export
 *  TitleLayer map onto this. All geometry is in EXPORT pixels. */
export interface TitleRenderLayer {
  text: string;
  /** Family to pass to ctx.font — the unique name from ensureTitleFontFace,
   *  or a CSS family fallback. */
  canvasFamily: string;
  /** Real CSS family (e.g. "'Montserrat', sans-serif") — used by the arc SVG. */
  cssFamily: string;
  /** TTF bytes, needed to embed the font into the arc SVG. */
  fontBytes?: Uint8Array;
  fontWeight: number;
  sizePx: number;
  letterSpacing?: number;
  arcDeg?: number;
  shadow?: boolean;
  color: string;
  /** Degrees, about the layer's own anchor. Not the arc — that curves the
   *  baseline; this tilts the whole block. */
  rotation?: number;
  posX: number; // -50..+50 (% horizontal offset from frame center)
  posY: number; // -50..+50 (% vertical offset from frame center)
  boxWidthPct?: number; // 10..100 (% of frame width for text wrapping)
  lineHeight?: number; // -2..+2 (multiplier of font size)
  typewriterProgress?: number; // 0..1 progress of character reveal
  showCursor?: boolean; // whether to show blinking cursor '|' at typing tip
  maskMode?: "none" | "video";
  maskColor?: string; // opaque matte surrounding video-filled glyphs
}


/** Animation geometry, shared by preview (CSS transform) and export (ffmpeg
 *  overlay x/y expressions), expressed as a fraction of the frame so both sides
 *  move the title by the same proportion. */
export const TITLE_ANIM = {
  slideXFrac: 0.13, // of frame width
  slideYFrac: 0.055, // of frame height
};

/** Stable FontFace key for a layer, identical on both sides so the preview and
 *  the export resolve to the same registered face. Custom fonts (no CSS family)
 *  are disambiguated by byte length so two different uploads don't collide. */
export function titleFontKey(cssFamily: string, weight: number, bytesLen?: number): string {
  const primary = (cssFamily.split(",")[0] || "custom").replace(/['"]/g, "").trim() || "custom";
  return primary === "custom" && bytesLen ? `custom-${weight}-${bytesLen}` : `${primary}-${weight}`;
}

const fontFaceCache = new Map<string, Promise<string>>();

/**
 * Register TTF bytes as a uniquely-named FontFace so the preview and the export
 * draw with byte-identical glyphs, and so measureText wraps against the real
 * metrics. Returns the family string to use in `ctx.font` (quoted). Falls back
 * to the CSS family when bytes are unavailable or FontFace is unsupported.
 *
 * `key` must be stable per font+weight (e.g. `montserrat-700`) so both sides and
 * repeated calls resolve to the same registered face.
 */
export function ensureTitleFontFace(
  key: string,
  bytes: Uint8Array | undefined,
  cssFallback: string,
): Promise<string> {
  if (
    !bytes ||
    bytes.length === 0 ||
    typeof FontFace === "undefined" ||
    typeof document === "undefined"
  ) {
    return Promise.resolve(cssFallback);
  }
  const family = `title-${key}`;
  const cached = fontFaceCache.get(family);
  if (cached) return cached;
  const p = (async () => {
    try {
      const weightMatch = key.match(/-(\d+)$/);
      const weight = weightMatch ? weightMatch[1] : "400";
      const face = new FontFace(family, bytes as BufferSource, { weight });
      await face.load();
      document.fonts.add(face);
      return `'${family}'`;
    } catch {
      return cssFallback;
    }
  })();
  fontFaceCache.set(family, p);
  return p;
}

export function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    let line = "";
    for (const word of words) {
      if (ctx.measureText(word).width > maxWidth) {
        if (line) {
          out.push(line);
          line = "";
        }
        let charChunk = "";
        for (const char of word) {
          const trialChunk = charChunk + char;
          if (!charChunk || ctx.measureText(trialChunk).width <= maxWidth) {
            charChunk = trialChunk;
          } else {
            out.push(charChunk);
            charChunk = char;
          }
        }
        if (charChunk) {
          line = charChunk;
        }
      } else {
        const trial = line ? `${line} ${word}` : word;
        if (!line || ctx.measureText(trial).width <= maxWidth) {
          line = trial;
        } else {
          out.push(line);
          line = word;
        }
      }
    }
    if (line) out.push(line);
  }
  return out.length ? out : [""];
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Curved title: SVG `textPath` (the browser's own path text) → drawImage.
 *  The font is embedded as @font-face so the isolated SVG image sees it. */
async function drawArc(
  ctx: CanvasRenderingContext2D,
  layer: TitleRenderLayer,
  w: number,
  h: number,
): Promise<void> {
  const size = layer.sizePx;
  const curvature = layer.arcDeg ?? 0;
  const primary = (layer.cssFamily.split(",")[0] || "customFont").replace(/['"]/g, "").trim();

  let fontFaceCss = "";
  if (layer.fontBytes && layer.fontBytes.length > 0) {
    let binary = "";
    const bytes = layer.fontBytes;
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    const b64 = btoa(binary);
    fontFaceCss = `<style>@font-face { font-family: '${primary}'; font-weight: ${layer.fontWeight}; src: url('data:font/ttf;base64,${b64}') format('truetype'); }</style>`;
  }

  const hOffset = (curvature / 180) * (h * 0.45);
  const startY = h / 2 + hOffset * 0.4 + h * (layer.posY / 100);
  const controlY = h / 2 - hOffset + h * (layer.posY / 100);
  const pathD = `M 40,${startY} Q ${w / 2},${controlY} ${w - 40},${startY}`;
  const pathId = `arc_${Math.random().toString(36).slice(2, 8)}`;
  const shadow = layer.shadow !== false ? 'filter="drop-shadow(2px 2px 4px rgba(0,0,0,0.7))"' : "";
  const spacing = layer.letterSpacing ? `letter-spacing="${layer.letterSpacing}px"` : "";

  let renderText = layer.text;
  if (layer.typewriterProgress !== undefined) {
    const chars = Math.floor(Math.max(0, Math.min(1, layer.typewriterProgress)) * layer.text.length);
    renderText = layer.text.substring(0, chars);
    if (layer.showCursor && chars < layer.text.length) {
      renderText += "|";
    }
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<defs>${fontFaceCss}<path id="${pathId}" d="${pathD}" fill="none" /></defs>` +
    `<text fill="${layer.color}" font-weight="${layer.fontWeight}" font-family="'${primary}', sans-serif" font-size="${size}px" ${spacing} ${shadow}>` +
    `<textPath href="#${pathId}" startOffset="50%" text-anchor="middle">${escapeXml(renderText)}</textPath>` +
    `</text></svg>`;

  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise<void>((resolve) => {
      img.onload = () => resolve();
      img.onerror = () => resolve();
      img.src = url;
    });
    ctx.drawImage(img, 0, 0);
  } finally {
    URL.revokeObjectURL(url);
  }
}

import { createOffscreenOrDomCanvas, canvasToPngBuffer } from "../../lib/offscreenCanvas";

/** Draw one title layer's STATIC or TYPEWRITER glyphs onto a full-frame canvas context.
 *  Animation and scope-fade are applied on top (CSS in preview, ffmpeg overlay
 *  expressions in export) — never baked into the bitmap. */
/**
 * Tilt the whole title block, about its own anchor rather than the frame's
 * centre — rotating an off-centre title about the frame would swing it across
 * the picture instead of turning it in place.
 *
 * Wraps the draw rather than living inside it so it covers the arc branch too:
 * an arced title still tilts as one piece.
 *
 * Every surface reaches the title through here — the Cover canvas, the preview's
 * drawTitleLayerAsset, and the export's renderTitleLayerToPng (ADR-0008) — so
 * this lands on all three at once and cannot drift between them.
 */
export async function drawTitleLayer(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  layer: TitleRenderLayer,
  w: number,
  h: number,
): Promise<void> {
  const deg = layer.rotation ?? 0;
  if (deg === 0) {
    await drawTitleLayerFlat(ctx, layer, w, h);
    return;
  }
  const cx = w / 2 + w * (layer.posX / 100);
  const cy = h / 2 + h * (layer.posY / 100);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((deg * Math.PI) / 180);
  ctx.translate(-cx, -cy);
  await drawTitleLayerFlat(ctx, layer, w, h);
  ctx.restore();
}

async function drawTitleLayerFlat(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  layer: TitleRenderLayer,
  w: number,
  h: number,
): Promise<void> {
  if ((layer.arcDeg ?? 0) !== 0) {
    await drawArc(ctx as CanvasRenderingContext2D, layer, w, h);
    return;
  }

  const size = layer.sizePx;
  const centerX = w / 2 + w * (layer.posX / 100);
  const centerY = h / 2 + h * (layer.posY / 100);

  ctx.save();
  ctx.font = `${layer.fontWeight} ${size}px ${layer.canvasFamily}, sans-serif`;
  // Real tracking — the thing ffmpeg drawtext could not do.
  if ("letterSpacing" in ctx) {
    (ctx as unknown as { letterSpacing: string }).letterSpacing = `${layer.letterSpacing ?? 0}px`;
  }
  ctx.fillStyle = layer.color;
  ctx.textBaseline = "middle";
  if (layer.shadow !== false) {
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = size * 0.06;
    ctx.shadowOffsetX = size * 0.03;
    ctx.shadowOffsetY = size * 0.03;
  }

  const boxWidthFrac = (layer.boxWidthPct ?? 90) / 100;
  const lines = wrapLines(ctx as unknown as CanvasRenderingContext2D, layer.text, w * boxWidthFrac);

  const lineH = size * (layer.lineHeight ?? 1.15);
  const totalH = (lines.length - 1) * lineH;

  const isTypewriter = layer.typewriterProgress !== undefined;
  const progress = isTypewriter ? Math.max(0, Math.min(1, layer.typewriterProgress!)) : 1.0;

  if (!isTypewriter || progress >= 1.0) {
    // Normal centered rendering
    ctx.textAlign = "center";
    lines.forEach((ln, i) => {
      ctx.fillText(ln, centerX, centerY - totalH / 2 + i * lineH);
    });
  } else {
    // Typewriter rendering with locked left anchors per line to prevent horizontal text jitter
    const totalChars = layer.text.length;
    const targetRevealed = Math.floor(progress * totalChars);

    let charsRemaining = targetRevealed;
    let foundCursorLine = false;

    lines.forEach((fullLn, i) => {
      const lineStartY = centerY - totalH / 2 + i * lineH;
      const fullLen = fullLn.length;

      let typedInLine = 0;
      if (charsRemaining >= fullLen) {
        typedInLine = fullLen;
        charsRemaining -= fullLen;
      } else {
        typedInLine = charsRemaining;
        charsRemaining = 0;
      }

      const partialLn = fullLn.substring(0, typedInLine);
      const isCurrentActiveLine = !foundCursorLine && (typedInLine < fullLen || i === lines.length - 1);
      if (typedInLine < fullLen) foundCursorLine = true;

      // Measure full line width to lock the centered left-start position
      const fullLineWidth = ctx.measureText(fullLn).width;
      const lineStartX = centerX - fullLineWidth / 2;

      ctx.textAlign = "left";
      ctx.fillText(partialLn, lineStartX, lineStartY);

      if (layer.showCursor !== false && isCurrentActiveLine && progress < 1.0) {
        const partialWidth = ctx.measureText(partialLn).width;
        const cursorX = lineStartX + partialWidth + size * 0.04;
        ctx.fillText("|", cursorX, lineStartY);
      }
    });
  }

  ctx.restore();
}

/**
 * Draw the final title bitmap shared by preview and export. Video-mask mode is
 * an opaque configurable matte with title-shaped transparent holes; overlaying it on
 * the composited Beat reveals the live picture inside the glyphs.
 */
export async function drawTitleLayerAsset(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  layer: TitleRenderLayer,
  w: number,
  h: number,
): Promise<void> {
  if (layer.maskMode !== "video") {
    await drawTitleLayer(ctx, layer, w, h);
    return;
  }

  ctx.save();
  ctx.fillStyle = layer.maskColor ?? "#000000";
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = "destination-out";
  await drawTitleLayer(ctx, { ...layer, color: "#ffffff" }, w, h);
  ctx.restore();
}

/** Export path: render one title layer to a full-frame transparent PNG for
 *  ffmpeg to overlay. Returns null when there is no canvas (e.g. non-browser). */
export async function renderTitleLayerToPng(
  layer: TitleRenderLayer,
  w: number,
  h: number,
  typewriterProgress?: number,
): Promise<Uint8Array | null> {
  const { canvas, ctx } = createOffscreenOrDomCanvas(w, h);
  if (!ctx) return null;
  try {
    const renderLayer = typewriterProgress !== undefined ? { ...layer, typewriterProgress } : layer;
    await drawTitleLayerAsset(ctx, renderLayer, w, h);
    return await canvasToPngBuffer(canvas);
  } catch {
    return null;
  }
}
