/**
 * inspireTemplate.ts
 *
 * Samples frames from an inspiration video, sends them to Claude, and parses
 * the response into a ProjectTemplate draft for the user to review and save.
 * The inspiration video is never stored — only the extracted template JSON
 * persists (to the IndexedDB templates store via projectStorage).
 */

import { probeVideo, sampleFrames } from "../../lib/frameSampler";
import { callClaudeVision, type ClaudeConfig } from "../../lib/claudeClient";
import type { ProjectTemplate, TemplateBeat, Aspect, ColorAdjustments } from "../../domain/types";

/** One frame per ~3 seconds, capped at 30 — enough for 10+ scene changes in 90s. */
function frameCount(durationSec: number): number {
  return Math.min(30, Math.max(6, Math.ceil(durationSec / 3)));
}

const INSPIRE_PROMPT = (
  count: number,
  durationSec: number,
  w: number,
  h: number,
) =>
  `You are a video editor analyzing ${count} frames sampled evenly across a ${Math.round(durationSec)}s reference video (${w}×${h}px).
The frames are in chronological order. Your job is to reverse-engineer the edit structure so someone can recreate a similar style with their own clips.

Identify the distinct "beats" (shots / scenes) — where the edit cuts from one visual idea to the next.
For each beat give a brief, clip-assignment-friendly description of WHAT TYPE of shot it is — not a description of the specific content (the user will fill in their own clips).

Rules:
- If consecutive frames look like the same scene/shot, they are ONE beat. Only split when you see a clear visual change.
- Beat count must be between 2 and 12.
- approxDurationSec is the estimated screen time of that beat in the reference video.
- colorHint values are integers in the range -100 to 100 (0 = neutral).
- aspect must be exactly one of: "16:9", "9:16", "1:1".

Reply with EXACTLY this JSON and nothing else (no markdown fences, no preamble):
{
  "beatCount": <number 2-12>,
  "beats": [
    { "description": "<shot type, 5-10 words>", "approxDurationSec": <number> },
    ...
  ],
  "aspect": "<16:9 | 9:16 | 1:1>",
  "toneHint": "<2-5 word mood/energy, e.g. 'fast-paced urban energy' or 'slow cinematic warmth'>",
  "colorHint": {
    "warmth": <integer -100..100>,
    "saturation": <integer -100..100>,
    "contrast": <integer -100..100>,
    "shadows": <integer -100..100>,
    "highlights": <integer -100..100>
  }
}`;

function clamp(v: unknown, min = -100, max = 100): number {
  const n = Number(v);
  return isNaN(n) ? 0 : Math.max(min, Math.min(max, Math.round(n)));
}

function inferAspect(raw: string, w: number, h: number): Aspect {
  if (raw === "9:16") return "9:16";
  if (raw === "1:1") return "1:1";
  if (raw === "16:9") return "16:9";
  // Fall back to pixel dimensions
  if (w > 0 && h > 0) {
    const ratio = w / h;
    if (ratio < 0.8) return "9:16";
    if (ratio < 1.2) return "1:1";
  }
  return "16:9";
}

export function parseInspiredTemplate(
  raw: string,
  meta: { durationSec: number; width: number; height: number },
  fileName: string,
): ProjectTemplate {
  const id = typeof crypto !== "undefined" && crypto.randomUUID
    ? `tmpl-${crypto.randomUUID()}`
    : `tmpl-${Date.now()}`;

  let parsed: Record<string, unknown> = {};
  try {
    // Strip any markdown fences Claude may add despite instructions
    const cleaned = raw.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
    parsed = JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    // Partial / empty template — still usable with defaults
  }

  const rawBeats = Array.isArray(parsed.beats) ? parsed.beats as unknown[] : [];
  const beats: TemplateBeat[] = rawBeats.length > 0
    ? rawBeats.map((b) => {
        const beat = b as Record<string, unknown>;
        return {
          description: typeof beat.description === "string" && beat.description.trim()
            ? beat.description.trim()
            : "Shot",
          approxDurationSec: typeof beat.approxDurationSec === "number"
            ? beat.approxDurationSec
            : undefined,
        };
      })
    : Array.from(
        { length: typeof parsed.beatCount === "number" ? Math.min(12, Math.max(2, parsed.beatCount)) : 4 },
        (_, i) => ({ description: `Beat ${i + 1}` }),
      );

  const rawColor = parsed.colorHint && typeof parsed.colorHint === "object"
    ? (parsed.colorHint as Record<string, unknown>)
    : null;

  const colorHint: ColorAdjustments | undefined = rawColor
    ? {
        warmth:     clamp(rawColor.warmth),
        saturation: clamp(rawColor.saturation),
        contrast:   clamp(rawColor.contrast),
        shadows:    clamp(rawColor.shadows),
        highlights: clamp(rawColor.highlights),
      }
    : undefined;

  return {
    id,
    name: fileName.replace(/\.[^.]+$/, ""),
    description: `Extracted from "${fileName}"`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    beats,
    aspect: inferAspect(String(parsed.aspect ?? ""), meta.width, meta.height),
    toneHint: typeof parsed.toneHint === "string" && parsed.toneHint.trim()
      ? parsed.toneHint.trim()
      : undefined,
    colorHint,
    extractionRaw: raw,
  };
}

export async function analyzeInspirationVideo(
  file: File,
  cfg: ClaudeConfig,
  onProgress?: (step: string) => void,
): Promise<ProjectTemplate> {
  onProgress?.("Reading video metadata…");
  const meta = await probeVideo(file);

  const count = frameCount(meta.durationSec);
  onProgress?.(`Sampling ${count} frames…`);
  const frames = await sampleFrames(file, count);

  onProgress?.("Asking Claude to analyze the edit structure…");
  const raw = await callClaudeVision(
    INSPIRE_PROMPT(count, meta.durationSec, meta.width, meta.height),
    frames.map((f) => f.base64),
    cfg,
  );

  onProgress?.("Parsing template…");
  return parseInspiredTemplate(raw, meta, file.name);
}
