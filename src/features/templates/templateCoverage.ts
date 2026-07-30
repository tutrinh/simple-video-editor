import type { Clip, ProjectTemplate } from "../../domain/types";

export interface TemplateCoverageInput {
  template: ProjectTemplate;
  clips: Clip[];
}

export interface TemplateCoverageRecommendation {
  beatIndex: number;
  role: string;
  clipId?: string;
  confidence: number;
  reason: string;
  missing: boolean;
  missingShot?: string;
}

export interface TemplateCoveragePlan {
  recommendations: TemplateCoverageRecommendation[];
  matchedCount: number;
  missingCount: number;
}

export type TemplateCoverageAuthor = (prompt: string) => Promise<string>;

const CONFIDENCE_THRESHOLD = 0.55;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function confidence(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round(Math.max(0, Math.min(1, number)) * 100) / 100;
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const cleaned = raw.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI coverage output did not contain a JSON object.");
  const parsed = JSON.parse(cleaned.slice(start, end + 1)) as unknown;
  const value = record(parsed);
  if (!value) throw new Error("AI coverage output was not a JSON object.");
  return value;
}

export function buildTemplateCoveragePrompt(input: TemplateCoverageInput): string {
  const beats = input.template.beats.map((beat, beatIndex) => ({
    beatIndex,
    role: beat.description,
    targetDurationSec: beat.approxDurationSec ?? 5,
  }));
  const clips = input.clips.map((clip) => ({
    clipId: clip.id,
    name: clip.name,
    durationSec: clip.durationSec,
    subjectAction: clip.description?.subjectAction ?? "",
    settingMood: clip.description?.settingMood ?? "",
    usability: clip.description?.usability ?? 0,
    tags: clip.tags ?? [],
  }));

  return [
    "You are a short-form video editor matching analyzed source Clips to a reusable Reel template.",
    `Template: ${input.template.name}`,
    input.template.toneHint ? `Template tone: ${input.template.toneHint}` : "",
    "",
    "Rules:",
    "- Match a Clip only when its neutral description visibly fulfills the template role.",
    "- Do not pretend a Clip contains a product, action, person, result, or setting absent from its description.",
    "- Use each Clip at most once.",
    "- Prefer leaving a Beat unmatched over making a weak match.",
    `- A match below ${CONFIDENCE_THRESHOLD} confidence will be treated as missing.`,
    "- Include one recommendation for every Beat index.",
    "- missingShot must be a concise, phone-filmable instruction when no confident Clip fits.",
    "",
    `Template Beats:\n${JSON.stringify(beats, null, 2)}`,
    `Analyzed Clips:\n${JSON.stringify(clips, null, 2)}`,
    "",
    "Return only this JSON shape:",
    '{"recommendations":[{"beatIndex":0,"clipId":"clip-id or empty string","confidence":0.0,"reason":"brief evidence-based reason","missingShot":"what to film if unmatched"}]}',
  ].filter(Boolean).join("\n");
}

export async function recommendTemplateCoverage(
  input: TemplateCoverageInput,
  author: TemplateCoverageAuthor,
): Promise<TemplateCoveragePlan> {
  if (input.template.beats.length < 2 || input.template.beats.length > 12) {
    throw new Error("Template coverage requires between 2 and 12 Beats.");
  }
  if (input.clips.length === 0 || input.clips.some((clip) => !clip.description)) {
    throw new Error("Every available Clip must have an analyzed Clip Description before matching.");
  }

  const parsed = parseJsonObject(await author(buildTemplateCoveragePrompt(input)));
  const rawRecommendations = Array.isArray(parsed.recommendations)
    ? parsed.recommendations
    : [];
  const clipIds = new Set(input.clips.map((clip) => clip.id));
  const byBeat = new Map<number, Record<string, unknown>>();

  for (const candidate of rawRecommendations) {
    const item = record(candidate);
    if (!item) continue;
    const beatIndex = Number(item.beatIndex);
    if (!Number.isInteger(beatIndex) || beatIndex < 0 || beatIndex >= input.template.beats.length) continue;
    const previous = byBeat.get(beatIndex);
    if (!previous || confidence(item.confidence) > confidence(previous.confidence)) {
      byBeat.set(beatIndex, item);
    }
  }

  const usedClipIds = new Set<string>();
  const recommendations = input.template.beats.map((beat, beatIndex): TemplateCoverageRecommendation => {
    const item = byBeat.get(beatIndex);
    const proposedClipId = text(item?.clipId);
    const score = confidence(item?.confidence);
    const validClip = clipIds.has(proposedClipId);
    const uniqueClip = validClip && !usedClipIds.has(proposedClipId);
    const matched = uniqueClip && score >= CONFIDENCE_THRESHOLD;
    if (matched) usedClipIds.add(proposedClipId);

    const reason = text(item?.reason) || (matched
      ? "The Clip description visibly matches this template role."
      : "No confident unique Clip match was found.");
    const missingShot = text(item?.missingShot) || `Capture footage for: ${beat.description}`;

    return {
      beatIndex,
      role: beat.description,
      ...(matched ? { clipId: proposedClipId } : {}),
      confidence: score,
      reason,
      missing: !matched,
      ...(!matched ? { missingShot } : {}),
    };
  });

  const matchedCount = recommendations.filter((recommendation) => !recommendation.missing).length;
  return {
    recommendations,
    matchedCount,
    missingCount: recommendations.length - matchedCount,
  };
}
