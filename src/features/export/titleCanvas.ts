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
  posX: number; // -50..+50 (% horizontal offset from frame center)
  posY: number; // -50..+50 (% vertical offset from frame center)
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
      const face = new FontFace(family, bytes as BufferSource);
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

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const trial = line ? `${line} ${word}` : word;
    if (!line || ctx.measureText(trial).width <= maxWidth) {
      line = trial;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
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
    fontFaceCss = `<style>@font-face { font-family: '${primary}'; src: url('data:font/ttf;base64,${b64}') format('truetype'); }</style>`;
  }

  const hOffset = (curvature / 180) * (h * 0.45);
  const startY = h / 2 + hOffset * 0.4 + h * (layer.posY / 100);
  const controlY = h / 2 - hOffset + h * (layer.posY / 100);
  const pathD = `M 40,${startY} Q ${w / 2},${controlY} ${w - 40},${startY}`;
  const pathId = `arc_${Math.random().toString(36).slice(2, 8)}`;
  const shadow = layer.shadow !== false ? 'filter="drop-shadow(2px 2px 4px rgba(0,0,0,0.7))"' : "";
  const spacing = layer.letterSpacing ? `letter-spacing="${layer.letterSpacing}px"` : "";

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<defs>${fontFaceCss}<path id="${pathId}" d="${pathD}" fill="none" /></defs>` +
    `<text fill="${layer.color}" font-weight="${layer.fontWeight}" font-family="'${primary}', sans-serif" font-size="${size}px" ${spacing} ${shadow}>` +
    `<textPath href="#${pathId}" startOffset="50%" text-anchor="middle">${escapeXml(layer.text)}</textPath>` +
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

/** Draw one title layer's STATIC glyphs onto a full-frame canvas context.
 *  Animation and scope-fade are applied on top (CSS in preview, ffmpeg overlay
 *  expressions in export) — never baked into the bitmap. */
export async function drawTitleLayer(
  ctx: CanvasRenderingContext2D,
  layer: TitleRenderLayer,
  w: number,
  h: number,
): Promise<void> {
  if ((layer.arcDeg ?? 0) !== 0) {
    await drawArc(ctx, layer, w, h);
    return;
  }

  const size = layer.sizePx;
  const centerX = w / 2 + w * (layer.posX / 100);
  const centerY = h / 2 + h * (layer.posY / 100);

  ctx.save();
  ctx.font = `${layer.fontWeight} ${size}px ${layer.canvasFamily}, sans-serif`;
  // Real tracking — the thing ffmpeg drawtext could not do.
  if ("letterSpacing" in ctx) {
    (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${layer.letterSpacing ?? 0}px`;
  }
  ctx.fillStyle = layer.color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (layer.shadow !== false) {
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = size * 0.06;
    ctx.shadowOffsetX = size * 0.03;
    ctx.shadowOffsetY = size * 0.03;
  }

  const lines = wrapLines(ctx, layer.text, w * 0.9);
  const lineH = size * 1.15;
  const totalH = (lines.length - 1) * lineH;
  lines.forEach((ln, i) => {
    ctx.fillText(ln, centerX, centerY - totalH / 2 + i * lineH);
  });
  ctx.restore();
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    canvas.toBlob((b) => {
      if (!b) return resolve(null);
      b.arrayBuffer().then((buf) => resolve(new Uint8Array(buf))).catch(() => resolve(null));
    }, "image/png");
  });
}

/** Export path: render one title layer to a full-frame transparent PNG for
 *  ffmpeg to overlay. Returns null when there is no canvas (e.g. non-browser). */
export async function renderTitleLayerToPng(
  layer: TitleRenderLayer,
  w: number,
  h: number,
): Promise<Uint8Array | null> {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  try {
    await drawTitleLayer(ctx, layer, w, h);
  } catch {
    return null;
  }
  return canvasToPng(canvas);
}
