// Shared caption renderer (ADR-0008, PR 2). ONE canvas function draws the caption
// block for both the preview and the export, so the exported caption matches the
// preview's font, wrapping, background box, and placement. Replaces the per-line
// ffmpeg drawtext captions (which also used a different font than the preview).

const CAPTION_FONT_URL = "/caption-font.ttf";
const CAPTION_FAMILY = "caption-font";
let captionFontPromise: Promise<string> | null = null;

/** Load /caption-font.ttf once and register it so both sides draw the real
 *  caption face. Returns the family string for ctx.font (falls back to
 *  sans-serif if the asset or FontFace is unavailable). */
export function ensureCaptionFont(): Promise<string> {
  if (captionFontPromise) return captionFontPromise;
  captionFontPromise = (async () => {
    if (typeof document === "undefined" || typeof FontFace === "undefined" || typeof fetch === "undefined") {
      return "sans-serif";
    }
    try {
      const res = await fetch(CAPTION_FONT_URL);
      if (!res.ok) return "sans-serif";
      const buf = await res.arrayBuffer();
      const face = new FontFace(CAPTION_FAMILY, buf);
      await face.load();
      document.fonts.add(face);
      return `'${CAPTION_FAMILY}'`;
    } catch {
      return "sans-serif";
    }
  })();
  return captionFontPromise;
}

export interface CaptionSpec {
  text: string;
  /** Font size in EXPORT pixels (canvas is always full export resolution). */
  fontSizePx: number;
  bgOpacity: number;
  /** Line height as a multiple of font size. */
  lineHeight: number;
  /** Gap from the bottom edge of the frame, in export pixels. */
  marginPx: number;
  color?: string; // default white
  weight?: number; // default 700
  maxWidthFrac?: number; // default 0.9 of frame width
}

/** Wrap on width, but honour explicit newlines as hard breaks. Same rule on both
 *  sides so the exported caption breaks exactly where the preview does. */
function wrapParagraphs(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    let line = "";
    for (const word of words) {
      const trial = line ? `${line} ${word}` : word;
      if (!line || ctx.measureText(trial).width <= maxWidth) line = trial;
      else {
        out.push(line);
        line = word;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Draw the caption block (wrapped, boxed, bottom-aligned, centered) onto a
 *  full-frame canvas context. */
export async function drawCaptionBlock(
  ctx: CanvasRenderingContext2D,
  spec: CaptionSpec,
  w: number,
  h: number,
): Promise<void> {
  const text = spec.text.trim();
  if (!text) return;
  const family = await ensureCaptionFont();
  const size = spec.fontSizePx;
  const weight = spec.weight ?? 700;

  ctx.save();
  ctx.font = `${weight} ${size}px ${family}, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const lines = wrapParagraphs(ctx, text, w * (spec.maxWidthFrac ?? 0.9));
  if (lines.length === 0) {
    ctx.restore();
    return;
  }

  const lineH = size * spec.lineHeight;
  const padH = size * 0.5;
  const padV = size * 0.18;
  const maxLineW = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const boxW = Math.min(w, maxLineW + padH * 2);
  const boxH = lines.length * lineH + padV * 2;
  const boxX = (w - boxW) / 2;
  const boxY = h - spec.marginPx - boxH;

  ctx.fillStyle = `rgba(0,0,0,${spec.bgOpacity})`;
  roundRectPath(ctx, boxX, boxY, boxW, boxH, size * 0.18);
  ctx.fill();

  ctx.fillStyle = spec.color ?? "#ffffff";
  lines.forEach((ln, i) => {
    ctx.fillText(ln, w / 2, boxY + padV + lineH * (i + 0.5));
  });
  ctx.restore();
}

/** Export path: render a caption cue to a full-frame transparent PNG for ffmpeg
 *  to overlay (time-gated with `enable`). Null when there is no canvas. */
export async function renderCaptionToPng(spec: CaptionSpec, w: number, h: number): Promise<Uint8Array | null> {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  try {
    await drawCaptionBlock(ctx, spec, w, h);
  } catch {
    return null;
  }
  return new Promise((resolve) => {
    canvas.toBlob((b) => {
      if (!b) return resolve(null);
      b.arrayBuffer().then((buf) => resolve(new Uint8Array(buf))).catch(() => resolve(null));
    }, "image/png");
  });
}
