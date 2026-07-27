import type { ColorAdjustments } from "../domain/types";

// The single source of truth for colour grading (ADR-0010). Every renderer —
// the preview's SVG filter and the export's baked .cube — derives from the
// functions here. Nothing else computes colour.
//
// A Grade is one per-channel curve step composed with one channel-mixing step:
//
//   gradePixel(rgb) = matrixStep( curveStep(rgb) )
//
// The split is not arbitrary: exposure, contrast and split-tone act on each
// channel independently, so they are expressible as an SVG feComponentTransfer
// table; saturation, hue and white balance mix channels, so they are one
// feColorMatrix. Both halves also bake exactly into a 3D LUT for ffmpeg.

/** The bound every axis is defined in — sliders, AI prompt, and the LUT input. */
export const AXIS_LIMIT = 100;

/** Number of samples in each feComponentTransfer channel table. */
export const CURVE_SAMPLES = 64;

export type Rgb = [number, number, number];

/** A 4x5 colour matrix in feColorMatrix row-major order (20 values). */
export type ColorMatrix = number[];

const clampAxis = (n: number): number => Math.max(-AXIS_LIMIT, Math.min(AXIS_LIMIT, n));
const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

const AXES: (keyof ColorAdjustments)[] = [
  "exposure", "contrast", "shadows", "blackPoint", "highlights", "colorTone", "warmth",
  "saturation", "skinTone", "tint", "shadowWarmth", "shadowTint", "highlightWarmth", "highlightTint",
];

/**
 * Compose a Beat's Grade with the global override and clamp every axis.
 *
 * The clamp is the fix for the old unbounded sum: a Beat at +80 warmth under a
 * +40 global preset used to resolve to +120, outside the range the model, the
 * sliders and the AI prompt are all defined in — and outside what a LUT bake
 * can take as input.
 */
export function resolveGrade(
  beatAdj?: ColorAdjustments,
  globalAdj?: ColorAdjustments,
  globalIntensity = 1,
): ColorAdjustments {
  const out: ColorAdjustments = {};
  for (const k of AXES) {
    const v = (beatAdj?.[k] ?? 0) + (globalAdj?.[k] ?? 0) * globalIntensity;
    if (v !== 0) out[k] = clampAxis(v);
  }
  return out;
}

/** True when a Grade would leave every pixel untouched. */
export function isIdentityGrade(adj?: ColorAdjustments): boolean {
  if (!adj) return true;
  return AXES.every((k) => !adj[k]);
}

/**
 * Per-channel white-balance offsets for a (warmth, tint) pair, normalised to
 * roughly [-0.25, 0.25]. Warmth pushes amber (R up, B down); positive tint
 * pushes magenta (G down). Carried over from the export's colorbalance mapping
 * so existing Grades keep their meaning.
 */
function wbOffsets(warm: number, tint: number): Rgb {
  const w = warm / 100;
  const t = tint / 100;
  return [
    0.25 * w + 0.05 * t,
    0.08 * w - 0.20 * t,
    -0.25 * w + 0.05 * t,
  ];
}

/**
 * The per-channel curve: exposure, contrast, and split-tone.
 *
 * Exposure is **multiplicative** — a gain, so black stays black. The old export
 * path used an additive `eq=brightness` offset, which lifted blacks to grey and
 * was the single largest source of preview/export mismatch.
 *
 * Split-tone weights each tint by tonal position: shadows by (1-x)², highlights
 * by x². That is what CSS could not express and why the preview used to fold
 * both into the global white balance at 0.4× as a "directional hint".
 */
/** Where the highlight rolloff begins. Below this, values pass through untouched. */
export const SHOULDER_KNEE = 0.75;

/**
 * Highlight rolloff. Above the knee, values approach 1 asymptotically instead of
 * truncating at it, so two different overshooting values stay *distinct* rather
 * than both landing on 255 — the flat neon primaries a hard clip produces.
 *
 * Shadows keep a hard floor at 0 deliberately. A mirrored toe cannot both hold
 * black at black and approach 0 asymptotically from below, and "black stays
 * black" is the property that distinguishes this pipeline from the old additive
 * `eq=brightness` export.
 */
export function softClip(x: number): number {
  if (x <= 0) return 0;
  if (x <= SHOULDER_KNEE) return x;
  const k = SHOULDER_KNEE;
  return k + (1 - k) * Math.tanh((x - k) / (1 - k));
}

/** Peak of x(1-x)³ at x=0.25 — the normaliser that makes the tone weights top out at 1. */
const TONE_WEIGHT_PEAK = 0.25 * 0.75 * 0.75 * 0.75;

/** How far ±100 on a tone axis can move a channel at the weight's peak. */
export const TONE_RANGE = 0.25;

/**
 * Weight for the Shadows axis: zero at true black, peaking at x=0.25, zero at
 * white. Holding both ends is what keeps blacks black — a Shadows slider here
 * recovers the dark region rather than fogging it, matching what Lightroom
 * means by the word (and therefore what Claude assumes when it emits a value).
 */
export function shadowsWeight(x: number): number {
  const c = 1 - x;
  return (x * c * c * c) / TONE_WEIGHT_PEAK;
}

/** Mirror of `shadowsWeight`: zero at black, peaking at x=0.75, zero at pure white. */
export function highlightsWeight(x: number): number {
  return ((1 - x) * x * x * x) / TONE_WEIGHT_PEAK;
}

/** True when any axis in the curve half of the Grade can drive a channel out of range. */
function curveIsActive(adj: ColorAdjustments): boolean {
  return !!(adj.exposure || adj.contrast || adj.shadows || adj.blackPoint || adj.highlights
    || adj.shadowWarmth || adj.shadowTint || adj.highlightWarmth || adj.highlightTint);
}

/** The curve before any clipping — may land outside [0,1]. */
function rawCurve(adj: ColorAdjustments, channel: 0 | 1 | 2, x: number): number {
  const exposure = adj.exposure ?? 0;
  const contrast = adj.contrast ?? 0;

  let v = x * (1 + exposure / 100);
  v = (v - 0.5) * (1 + contrast / 100) + 0.5;

  // Tonal shaping, after exposure/contrast and before the colour split-tone.
  const shadows = adj.shadows ?? 0;
  const highlights = adj.highlights ?? 0;
  if (shadows !== 0 || highlights !== 0) {
    const t = clamp01(v);
    v += shadowsWeight(t) * (shadows / 100) * TONE_RANGE
      + highlightsWeight(t) * (highlights / 100) * TONE_RANGE;
  }

  // Black point / Lift offset (shifts true black, tapering off toward highlights)
  const blackPoint = adj.blackPoint ?? 0;
  if (blackPoint !== 0) {
    const t = clamp01(v);
    v += (1 - t) * (1 - t) * (blackPoint / 100) * 0.2;
  }

  const shadow = wbOffsets(adj.shadowWarmth ?? 0, adj.shadowTint ?? 0)[channel];
  const highlight = wbOffsets(adj.highlightWarmth ?? 0, adj.highlightTint ?? 0)[channel];
  if (shadow !== 0 || highlight !== 0) {
    const t = clamp01(v);
    const ws = (1 - t) * (1 - t);
    const wh = t * t;
    v += ws * shadow + wh * highlight;
  }

  return v;
}

// Whether a Grade's curve ever leaves [0,1] decides whether the shoulder runs at
// all. It has to: the shoulder trades a little in-range highlight for headroom,
// and a Grade that never overshoots — Shadows or Highlights on their own, which
// hold both ends by construction — must not pay that price. Sampled rather than
// bounded analytically so the split-tone humps are accounted for exactly.
const overshootCache = new Map<string, boolean>();

function curveOvershoots(adj: ColorAdjustments, channel: 0 | 1 | 2): boolean {
  const key = `${channel}|${adj.exposure ?? 0},${adj.contrast ?? 0},${adj.shadows ?? 0},${adj.blackPoint ?? 0},`
    + `${adj.highlights ?? 0},${adj.shadowWarmth ?? 0},${adj.shadowTint ?? 0},`
    + `${adj.highlightWarmth ?? 0},${adj.highlightTint ?? 0}`;
  const hit = overshootCache.get(key);
  if (hit !== undefined) return hit;

  let over = false;
  for (let i = 0; i < CURVE_SAMPLES; i++) {
    if (rawCurve(adj, channel, i / (CURVE_SAMPLES - 1)) > 1) { over = true; break; }
  }
  if (overshootCache.size > 512) overshootCache.clear();
  overshootCache.set(key, over);
  return over;
}

export function curveStep(adj: ColorAdjustments, channel: 0 | 1 | 2, x: number): number {
  // A Grade with no curve axes leaves the curve alone entirely, so a
  // saturation-only or hue-only Look never dulls whites via the shoulder.
  if (!curveIsActive(adj)) return clamp01(x);
  const v = rawCurve(adj, channel, x);
  return curveOvershoots(adj, channel) ? softClip(v) : clamp01(v);
}

/** `CURVE_SAMPLES` evenly spaced values of `curveStep` — an feFuncX tableValues row. */
export function curveTable(adj: ColorAdjustments, channel: 0 | 1 | 2): number[] {
  const out: number[] = [];
  for (let i = 0; i < CURVE_SAMPLES; i++) {
    out.push(curveStep(adj, channel, i / (CURVE_SAMPLES - 1)));
  }
  return out;
}

/** Row-major 4x5 identity, the starting point for the matrix composition. */
function identityMatrix(): ColorMatrix {
  return [
    1, 0, 0, 0, 0,
    0, 1, 0, 0, 0,
    0, 0, 1, 0, 0,
    0, 0, 0, 1, 0,
  ];
}

/** Multiply two 4x5 colour matrices (a applied after b). */
function multiply(a: ColorMatrix, b: ColorMatrix): ColorMatrix {
  const out = new Array<number>(20).fill(0);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[r * 5 + k] * b[k * 5 + c];
      out[r * 5 + c] = sum;
    }
    let off = a[r * 5 + 4];
    for (let k = 0; k < 4; k++) off += a[r * 5 + k] * b[k * 5 + 4];
    out[r * 5 + 4] = off;
  }
  return out;
}

// Rec. 601 luma weights — the same basis CSS `saturate()` and `hue-rotate()` use,
// so the preview matrix and the baked LUT agree with the filters they replace.
const LR = 0.213, LG = 0.715, LB = 0.072;

function saturationMatrix(saturation: number): ColorMatrix {
  const s = 1 + saturation / 100;
  return [
    LR + (1 - LR) * s, LG - LG * s, LB - LB * s, 0, 0,
    LR - LR * s, LG + (1 - LG) * s, LB - LB * s, 0, 0,
    LR - LR * s, LG - LG * s, LB + (1 - LB) * s, 0, 0,
    0, 0, 0, 1, 0,
  ];
}

function hueMatrix(colorTone: number): ColorMatrix {
  // colorTone maps to degrees at the same 1.8x scale the old hue-rotate used.
  const rad = (colorTone * 1.8 * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [
    LR + c * (1 - LR) + s * -LR, LG + c * -LG + s * -LG, LB + c * -LB + s * (1 - LB), 0, 0,
    LR + c * -LR + s * 0.143, LG + c * (1 - LG) + s * 0.140, LB + c * -LB + s * -0.283, 0, 0,
    LR + c * -LR + s * -(1 - LR), LG + c * -LG + s * LG, LB + c * (1 - LB) + s * LB, 0, 0,
    0, 0, 0, 1, 0,
  ];
}

function whiteBalanceMatrix(warm: number, tint: number): ColorMatrix {
  const [r, g, b] = wbOffsets(warm, tint);
  return [
    1 + r, 0, 0, 0, 0,
    0, 1 + g, 0, 0, 0,
    0, 0, 1 + b, 0, 0,
    0, 0, 0, 1, 0,
  ];
}

/**
 * The channel-mixing half of the Grade: white balance, then saturation, then
 * hue, collapsed into one 4x5 matrix.
 */
export function matrixStep(adj: ColorAdjustments): ColorMatrix {
  let m = identityMatrix();
  const warm = adj.warmth ?? 0;
  const tint = adj.tint ?? 0;
  if (warm !== 0 || tint !== 0) m = multiply(whiteBalanceMatrix(warm, tint), m);
  if (adj.saturation) m = multiply(saturationMatrix(adj.saturation), m);
  if (adj.colorTone) m = multiply(hueMatrix(adj.colorTone), m);
  return m;
}

/** Apply a 4x5 colour matrix to an RGB triple, clamped to [0,1]. */
export function applyMatrix(m: ColorMatrix, rgb: Rgb): Rgb {
  const [r, g, b] = rgb;
  return [
    clamp01(m[0] * r + m[1] * g + m[2] * b + m[4]),
    clamp01(m[5] * r + m[6] * g + m[7] * b + m[9]),
    clamp01(m[10] * r + m[11] * g + m[12] * b + m[14]),
  ];
}

/**
 * The reference transform. Both emitters derive from this — the `.cube` calls it
 * per lattice point, and the SVG filter reproduces it as a table plus a matrix.
 */
export function gradePixel(adj: ColorAdjustments, rgb: Rgb): Rgb {
  const curved: Rgb = [
    curveStep(adj, 0, clamp01(rgb[0])),
    curveStep(adj, 1, clamp01(rgb[1])),
    curveStep(adj, 2, clamp01(rgb[2])),
  ];
  let res = applyMatrix(matrixStep(adj), curved);
  const skinTone = adj.skinTone ?? 0;
  if (skinTone !== 0) {
    let [r, g, b] = res;
    const maxC = Math.max(r, g, b);
    const minC = Math.min(r, g, b);
    const delta = maxC - minC;
    if (delta > 0.05 && maxC === r && g >= b) {
      const sat = delta / maxC;
      const gRatio = (g - minC) / delta;
      const orangeWeight = sat * Math.max(0, 1 - Math.abs(gRatio - 0.6) * 3);
      if (orangeWeight > 0) {
        const shift = (skinTone / 100) * 0.15 * orangeWeight;
        g = clamp01(g + shift);
        res = [r, g, b];
      }
    }
  }
  return res;
}

const fmt = (n: number): string => Number(n.toFixed(5)).toString();

/**
 * The preview emitter — a CSS `filter` value wrapping one inline-SVG data URI.
 *
 * The SVG carries the same two steps in the same order: an feComponentTransfer
 * whose three tables sample `curveStep`, then an feColorMatrix from
 * `matrixStep`. Because both come from the functions the `.cube` bake also
 * calls, preview and export agree by construction rather than by tuning.
 */
export function gradeSvgFilter(adj?: ColorAdjustments): string {
  if (isIdentityGrade(adj)) return "none";
  const a = adj as ColorAdjustments;

  const rows = ([0, 1, 2] as const)
    .map((ch) => {
      const tag = ["feFuncR", "feFuncG", "feFuncB"][ch];
      return `<${tag} type="table" tableValues="${curveTable(a, ch).map(fmt).join(" ")}"/>`;
    })
    .join("");

  const matrix = matrixStep(a).map(fmt).join(" ");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg">` +
    `<filter id="g" color-interpolation-filters="sRGB">` +
    `<feComponentTransfer>${rows}</feComponentTransfer>` +
    `<feColorMatrix type="matrix" values="${matrix}"/>` +
    `</filter></svg>`;

  return `url('data:image/svg+xml;utf8,${encodeURIComponent(svg)}#g')`;
}

/**
 * Lattice resolution for the baked LUT. 33 is the conventional `.cube` grid:
 * fine enough that gradients do not band, small enough that the file stays
 * ~1 MB of text (33³ = 35,937 rows) and cheap for ffmpeg to load per segment.
 */
export const CUBE_SIZE = 33;

/**
 * The export emitter — an Adobe `.cube` 3D LUT baked straight from `gradePixel`.
 *
 * This replaces the old `eq`/`hue`/`colorbalance` chain wholesale, which is what
 * removes the additive-vs-multiplicative exposure mismatch rather than tuning
 * around it. Rows vary red fastest, then green, then blue, per the format.
 */
export function gradeCube(adj: ColorAdjustments, size = CUBE_SIZE): string {
  const lines: string[] = [`# Generated by simple-video-editor (ADR-0010)`, `LUT_3D_SIZE ${size}`];
  const last = size - 1;
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const out = gradePixel(adj, [r / last, g / last, b / last]);
        lines.push(`${fmt(out[0])} ${fmt(out[1])} ${fmt(out[2])}`);
      }
    }
  }
  return lines.join("\n") + "\n";
}
