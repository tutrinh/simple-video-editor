import type { ColorAdjustments } from "../domain/types";
import { callClaudeVision, type ClaudeConfig } from "./claudeClient";

// AI film-look grading: Claude derives a reusable Look from a reference image, then
// grades each beat's frame toward it. Claude can't emit a true LUT — it estimates the
// app's ±100 color sliders, which the preview/export pipeline already renders.

export interface FilmLook {
  /** Short evocative preset name from Claude (e.g. "Teal & Amber Dusk"). */
  name: string;
  description: string;
  colorAdjustments: ColorAdjustments;
}

const ADJ_KEYS: (keyof ColorAdjustments)[] = [
  "exposure", "contrast", "shadows", "blackPoint", "highlights", "colorTone", "warmth",
  "saturation", "tint", "shadowWarmth", "shadowTint", "highlightWarmth", "highlightTint",
];

const COLOR_KEYS_DOC =
  "exposure, contrast, shadows (brightness of the dark region only), highlights (brightness " +
  "of the bright region only), colorTone (global hue), warmth (blue↔amber), tint (green↔magenta), " +
  "saturation, shadowWarmth, shadowTint, highlightWarmth, highlightTint — each an integer " +
  "from -100 to 100 where 0 means no change. Use shadows/highlights for TONAL range (they hold " +
  "true black and pure white, like Lightroom) and split-tone (shadow*/highlight*) for COLOUR in " +
  "those ranges. Use split-tone for cinematic looks.";

/** Keep only known keys with a finite numeric value; clamp to ±100 integers. */
export function parseAdjustments(obj: unknown): ColorAdjustments {
  const src = obj && typeof obj === "object" ? (obj as Record<string, unknown>) : {};
  const out: ColorAdjustments = {};
  for (const k of ADJ_KEYS) {
    const raw = src[k];
    if (raw === undefined || raw === null) continue;
    const v = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(v)) continue; // skip non-numeric junk rather than forcing 0
    out[k] = Math.max(-100, Math.min(100, Math.round(v)));
  }
  return out;
}

function extractJson(text: string): unknown {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  const slice = start >= 0 && end > start ? body.slice(start, end + 1) : body;
  return JSON.parse(slice);
}

/** Parse the Look-analysis response (tolerates fences/prose; adjustments may be nested or flat). */
export function parseLookResponse(text: string): FilmLook {
  const data = extractJson(text) as { name?: unknown; description?: unknown; adjustments?: unknown };
  const adjSource = data && typeof data === "object" && "adjustments" in data ? data.adjustments : data;
  return {
    name: typeof data?.name === "string" ? data.name.trim() : "",
    description: typeof data?.description === "string" ? data.description : "",
    colorAdjustments: parseAdjustments(adjSource),
  };
}

/** Parse a per-beat grade response into ColorAdjustments. */
export function parseGradeResponse(text: string): ColorAdjustments {
  const data = extractJson(text);
  const adjSource = data && typeof data === "object" && "adjustments" in data ? (data as { adjustments: unknown }).adjustments : data;
  return parseAdjustments(adjSource);
}

/** Phase 1 — derive a reusable Look from a reference image. */
export async function analyzeFilmLook(refBase64: string, cfg: ClaudeConfig): Promise<FilmLook> {
  const prompt =
    `You are a colorist. Analyze the FILM LOOK / color grade of this reference image — ` +
    `ignore its subject and composition, focus only on the grade: white balance, split-toning ` +
    `(shadow vs highlight color), contrast, and saturation.\n\n` +
    `Give a short evocative NAME for the look (2-4 words, like a LUT/preset name), a one-phrase ` +
    `description, then the color-grade values that would push neutral footage TOWARD this look. ` +
    `Values: ${COLOR_KEYS_DOC}\n\n` +
    `Reply with ONLY this JSON, no prose:\n` +
    `{"name":"<2-4 word name>","description":"<short phrase>","adjustments":{"exposure":0,"contrast":0,"shadows":0,"highlights":0,"colorTone":0,"warmth":0,"tint":0,"saturation":0,"shadowWarmth":0,"shadowTint":0,"highlightWarmth":0,"highlightTint":0}}`;
  return parseLookResponse(await callClaudeVision(prompt, [refBase64], cfg));
}

const GRADE_JSON = `{"adjustments":{"exposure":0,"contrast":0,"shadows":0,"highlights":0,"colorTone":0,"warmth":0,"tint":0,"saturation":0,"shadowWarmth":0,"shadowTint":0,"highlightWarmth":0,"highlightTint":0}}`;

/**
 * Phase 2 — grade one beat toward the Look. When `refBase64` is given, Claude sees
 * BOTH the reference (image 1) and the beat's current frame (image 2) and compares
 * them directly, so the grade accounts for the beat's current colors. Without a
 * reference image it falls back to grading against the Look's text/values.
 */
export async function gradeBeatToLook(
  beatFrameBase64: string,
  look: FilmLook,
  cfg: ClaudeConfig,
  refBase64?: string,
): Promise<ColorAdjustments> {
  if (refBase64) {
    const prompt =
      `You are a colorist matching a shot to a reference film look.\n` +
      `The FIRST image is the TARGET reference — the look to match.\n` +
      `The SECOND image is ONE frame of the shot in its CURRENT, ungraded state.\n\n` +
      `Analyze the SECOND image's current colors — its exposure, white balance, contrast, ` +
      `saturation, and shadow/highlight tones — and compare them to the reference. Output the ` +
      `color-grade adjustments to apply to the SECOND image so it MATCHES the reference's look. ` +
      `Account for where the shot already sits (e.g. if it is already warm or dark, don't ` +
      `double up). ` +
      (look.description ? `Target look: ${look.description}. ` : "") +
      `Values: ${COLOR_KEYS_DOC}\n\n` +
      `Reply with ONLY this JSON, no prose:\n${GRADE_JSON}`;
    return parseGradeResponse(await callClaudeVision(prompt, [refBase64, beatFrameBase64], cfg));
  }

  const prompt =
    `You are a colorist matching a shot to a target film look.\n` +
    `TARGET LOOK: ${look.description || "the reference grade"}. ` +
    `Reference grade values: ${JSON.stringify(look.colorAdjustments)}.\n\n` +
    `The attached image is ONE frame of the shot in its CURRENT, ungraded state. Analyze its ` +
    `current colors and output the color-grade adjustments to apply to THIS frame so it matches ` +
    `the target look, accounting for how the frame already looks. Values: ${COLOR_KEYS_DOC}\n\n` +
    `Reply with ONLY this JSON, no prose:\n${GRADE_JSON}`;
  return parseGradeResponse(await callClaudeVision(prompt, [beatFrameBase64], cfg));
}
