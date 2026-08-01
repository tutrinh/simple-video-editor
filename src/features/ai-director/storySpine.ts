import { STORY_PURPOSES, type Beat, type Cut, type Story, type StoryPurpose } from "../../domain/types";
import type { CreatorBrief } from "../../domain/aiDirector";
import { callClaude, type ClaudeConfig } from "../../lib/claudeClient";

export interface SpineBeatContext {
  beatId: string;
  scriptText: string;
  subjectAction: string;
  settingMood: string;
  templateRole?: string;
  storyPurpose?: StoryPurpose;
}

export interface StorySpineInput {
  brief: CreatorBrief;
  logline: string;
  beats: SpineBeatContext[];
}

export interface StorySpineAssignment {
  beatId: string;
  purpose: StoryPurpose;
}

export interface RegionLineUpdate {
  beatId: string;
  scriptText: string;
}

export interface StorySpineIssue {
  code: "missing-hook" | "late-hook" | "multiple-hooks" | "missing-proof" | "missing-payoff" | "missing-cta" | "early-cta" | "late-proof";
  message: string;
}

export type StorySpineAuthor = (prompt: string, cfg: ClaudeConfig) => Promise<string>;

function extractJsonObject(raw: string, errorMessage: string): Record<string, unknown> {
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1] : raw;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error(errorMessage);
  try {
    const parsed = JSON.parse(body.slice(start, end + 1));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(errorMessage);
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(errorMessage);
  }
}

function isStoryPurpose(value: unknown): value is StoryPurpose {
  return typeof value === "string" && STORY_PURPOSES.includes(value as StoryPurpose);
}

export function buildStorySpinePrompt(input: StorySpineInput): string {
  return [
    "Assign one Beat Purpose to every Beat in this short social video.",
    "Allowed purposes: hook, problem, proof, payoff, cta.",
    "A purpose describes the Beat's editorial job, not merely what its Clip shows.",
    "Preserve every Beat id and the exact order. Do not add, remove, merge, rewrite, or reorder Beats.",
    "Use hook for the opening attention device, problem for tension or need, proof for evidence or demonstration, payoff for the delivered result or insight, and cta for the requested next action.",
    "Not every purpose must appear, and adjacent Beats may share a purpose when the Story needs it.",
    `Creator brief:\n${JSON.stringify(input.brief, null, 2)}`,
    `Story logline: ${JSON.stringify(input.logline)}`,
    `Beats:\n${JSON.stringify(input.beats, null, 2)}`,
    "Reply with ONLY this JSON, no prose:",
    '{"purposes":[{"beatId":"<existing id>","purpose":"hook"}]}',
  ].join("\n\n");
}

export function parseStorySpine(raw: string, beatIds: string[]): StorySpineAssignment[] {
  const parsed = extractJsonObject(raw, "Story Spine did not receive valid JSON from the Writer.");
  if (!Array.isArray(parsed.purposes)) throw new Error("Story Spine response did not contain a purposes array.");
  const allowed = new Set(beatIds);
  const seen = new Set<string>();
  const assignments: StorySpineAssignment[] = [];
  for (const rawItem of parsed.purposes) {
    if (!rawItem || typeof rawItem !== "object") continue;
    const item = rawItem as Record<string, unknown>;
    if (typeof item.beatId !== "string" || !allowed.has(item.beatId) || seen.has(item.beatId)) continue;
    if (!isStoryPurpose(item.purpose)) continue;
    seen.add(item.beatId);
    assignments.push({ beatId: item.beatId, purpose: item.purpose });
  }
  if (assignments.length !== beatIds.length) {
    throw new Error(`Story Spine assigned ${assignments.length} of ${beatIds.length} Beats.`);
  }
  const byId = new Map(assignments.map((assignment) => [assignment.beatId, assignment]));
  return beatIds.map((id) => byId.get(id)!);
}

async function generateWithRepair<T>(
  prompt: string,
  cfg: ClaudeConfig,
  author: StorySpineAuthor,
  parse: (raw: string) => T,
  label: string,
): Promise<T> {
  const first = await author(prompt, cfg);
  try {
    return parse(first);
  } catch (firstError) {
    const message = firstError instanceof Error ? firstError.message : String(firstError);
    const repairPrompt = [
      `Repair the following invalid ${label} response.`,
      `Validation error: ${message}`,
      "Return only corrected JSON using the original contract and grounding rules.",
      `Invalid output:\n${first.slice(0, 20_000)}`,
      `Original requirements:\n${prompt}`,
    ].join("\n\n");
    const repaired = await author(repairPrompt, cfg);
    try {
      return parse(repaired);
    } catch (repairError) {
      const repairMessage = repairError instanceof Error ? repairError.message : String(repairError);
      throw new Error(`${label} could not produce valid output after one repair attempt. ${repairMessage}`);
    }
  }
}

export function generateStorySpine(
  input: StorySpineInput,
  cfg: ClaudeConfig,
  author: StorySpineAuthor = callClaude,
): Promise<StorySpineAssignment[]> {
  return generateWithRepair(
    buildStorySpinePrompt(input),
    cfg,
    author,
    (raw) => parseStorySpine(raw, input.beats.map((beat) => beat.beatId)),
    "Story Spine",
  );
}

export function applyStorySpine(cut: Cut, assignments: StorySpineAssignment[]): Cut {
  const byId = new Map(assignments.map((assignment) => [assignment.beatId, assignment.purpose]));
  return {
    ...cut,
    beats: cut.beats.map((beat) => byId.has(beat.id) ? { ...beat, storyPurpose: byId.get(beat.id) } : beat),
  };
}

export function analyzeStorySpine(beats: Pick<Beat, "storyPurpose">[]): StorySpineIssue[] {
  if (beats.length === 0) return [];
  const purposes = beats.map((beat) => beat.storyPurpose);
  const issues: StorySpineIssue[] = [];
  const hookIndexes = purposes.flatMap((purpose, index) => purpose === "hook" ? [index] : []);
  const proofIndex = purposes.indexOf("proof");
  const payoffIndex = purposes.indexOf("payoff");
  const ctaIndex = purposes.indexOf("cta");

  if (hookIndexes.length === 0) issues.push({ code: "missing-hook", message: "No Beat is carrying the Hook." });
  else if (hookIndexes[0] !== 0) issues.push({ code: "late-hook", message: "The Hook starts after the first Beat." });
  if (hookIndexes.length > 1) issues.push({ code: "multiple-hooks", message: "More than one Beat is marked as the Hook." });
  if (proofIndex < 0) issues.push({ code: "missing-proof", message: "The Story makes no dedicated Proof Beat visible." });
  if (payoffIndex < 0) issues.push({ code: "missing-payoff", message: "The Story has no explicit Payoff Beat." });
  if (ctaIndex < 0) issues.push({ code: "missing-cta", message: "The Story has no CTA Beat." });
  else if (ctaIndex !== beats.length - 1) issues.push({ code: "early-cta", message: "The CTA arrives before the final Beat." });
  if (proofIndex >= 0 && payoffIndex >= 0 && proofIndex > payoffIndex) {
    issues.push({ code: "late-proof", message: "Proof arrives after the Payoff instead of supporting it." });
  }
  return issues;
}

export function buildRegionRewritePrompt(input: StorySpineInput, purpose: StoryPurpose): string {
  const targetIds = input.beats.filter((beat) => beat.storyPurpose === purpose).map((beat) => beat.beatId);
  return [
    `Rewrite only the ${purpose.toUpperCase()} region of this short social video.`,
    "Preserve every Beat id, purpose, order, and all non-target Script lines.",
    "Ground every rewritten line in the supplied Creator Brief and visible Clip description. Do not invent claims or results.",
    `Target Beat ids: ${JSON.stringify(targetIds)}`,
    `Creator brief:\n${JSON.stringify(input.brief, null, 2)}`,
    `Story logline: ${JSON.stringify(input.logline)}`,
    `Beats:\n${JSON.stringify(input.beats, null, 2)}`,
    "Reply with ONLY this JSON, no prose:",
    '{"lines":[{"beatId":"<target id>","scriptText":"<replacement line>"}]}',
  ].join("\n\n");
}

export function parseRegionRewrite(raw: string, targetIds: string[]): RegionLineUpdate[] {
  const parsed = extractJsonObject(raw, "Story region did not receive valid JSON from the Writer.");
  if (!Array.isArray(parsed.lines)) throw new Error("Story region response did not contain a lines array.");
  const targets = new Set(targetIds);
  const seen = new Set<string>();
  const updates: RegionLineUpdate[] = [];
  for (const rawItem of parsed.lines) {
    if (!rawItem || typeof rawItem !== "object") continue;
    const item = rawItem as Record<string, unknown>;
    if (typeof item.beatId !== "string" || !targets.has(item.beatId) || seen.has(item.beatId)) continue;
    if (typeof item.scriptText !== "string" || !item.scriptText.trim()) continue;
    seen.add(item.beatId);
    updates.push({ beatId: item.beatId, scriptText: item.scriptText.trim() });
  }
  if (updates.length !== targetIds.length) throw new Error(`Story region rewrote ${updates.length} of ${targetIds.length} target Beats.`);
  const byId = new Map(updates.map((update) => [update.beatId, update]));
  return targetIds.map((id) => byId.get(id)!);
}

export function generateRegionRewrite(
  input: StorySpineInput,
  purpose: StoryPurpose,
  cfg: ClaudeConfig,
  author: StorySpineAuthor = callClaude,
): Promise<RegionLineUpdate[]> {
  const targetIds = input.beats.filter((beat) => beat.storyPurpose === purpose).map((beat) => beat.beatId);
  if (targetIds.length === 0) return Promise.reject(new Error(`No Beats are assigned to ${purpose}.`));
  return generateWithRepair(
    buildRegionRewritePrompt(input, purpose),
    cfg,
    author,
    (raw) => parseRegionRewrite(raw, targetIds),
    "Story region",
  );
}

export function applyRegionRewrite(
  cut: Cut,
  story: Story | undefined,
  updates: RegionLineUpdate[],
): { cut: Cut; story: Story } {
  const byId = new Map(updates.map((update) => [update.beatId, update.scriptText]));
  let startSec = 0;
  const replacements = new Map<string, { oldText: string; newText: string; startSec: number }>();
  const beats = cut.beats.map((beat) => {
    const nextText = byId.get(beat.id);
    if (!nextText) {
      startSec += beat.durationSec;
      return beat;
    }
    replacements.set(beat.id, { oldText: beat.scriptText.trim(), newText: nextText, startSec });
    startSec += beat.durationSec;
    return { ...beat, scriptText: nextText };
  });
  const replacementList = [...replacements.values()];
  const voSegments = cut.voSegments?.map((segment) => {
    const replacement = replacementList.find((item) =>
      Math.abs(segment.startTimeSec - item.startSec) < 0.01 && segment.text.trim() === item.oldText,
    );
    return replacement ? { ...segment, text: replacement.newText } : segment;
  });
  return {
    cut: { ...cut, beats, ...(voSegments ? { voSegments } : {}) },
    story: {
      logline: story?.logline ?? "",
      beats: beats.map((beat) => ({ clipId: beat.clipId, scriptText: beat.scriptText })),
    },
  };
}
