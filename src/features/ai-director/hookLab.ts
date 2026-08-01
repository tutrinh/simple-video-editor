import type { Cut, Story } from "../../domain/types";
import type { CreatorBrief, HookMechanism, HookVariant } from "../../domain/aiDirector";
import { callClaude, type ClaudeConfig } from "../../lib/claudeClient";

export interface HookBeatContext {
  label: string;
  subjectAction: string;
  settingMood: string;
  currentLine: string;
}

export interface HookGenerationInput {
  brief: CreatorBrief;
  logline: string;
  beats: HookBeatContext[];
}

export type HookAuthorAdapter = (prompt: string, cfg: ClaudeConfig) => Promise<string>;

const HOOK_MECHANISMS: HookMechanism[] = [
  "result-first",
  "question",
  "contradiction",
  "tension",
  "visual-reveal",
];

export function buildHookPrompt(input: HookGenerationInput): string {
  return (
    `You are the Hook Director for a short social video. Create five materially different openings for the SAME video. ` +
    `The body, proof, and call to action will remain unchanged. Ground every hook in the supplied footage and evidence. ` +
    `Do not invent results, claims, people, products, or events.\n\n` +
    `Creator brief:\n${JSON.stringify(input.brief, null, 2)}\n\n` +
    `Current story logline: ${JSON.stringify(input.logline)}\n\n` +
    `Available beats in timeline order:\n${JSON.stringify(input.beats, null, 2)}\n\n` +
    `Return exactly one hook for each mechanism: result-first, question, contradiction, tension, visual-reveal.\n` +
    `Each spokenLine must be one concise sentence that can be delivered in roughly three seconds. ` +
    `onScreenText must be shorter than spokenLine. visualDirection must reference footage that is actually available. ` +
    `rationale must explain how the hook supports the selected goal without promising virality.\n\n` +
    `Reply with ONLY this JSON, no prose:\n` +
    `{"hooks":[{"mechanism":"result-first","spokenLine":"...","onScreenText":"...","visualDirection":"...","rationale":"..."}]}`
  );
}

function extractJson(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  return start >= 0 && end > start ? body.slice(start, end + 1) : body;
}

function isHookMechanism(value: unknown): value is HookMechanism {
  return typeof value === "string" && HOOK_MECHANISMS.includes(value as HookMechanism);
}

export function parseHookVariants(text: string): HookVariant[] {
  let parsed: { hooks?: unknown };
  try {
    parsed = JSON.parse(extractJson(text)) as { hooks?: unknown };
  } catch {
    throw new Error("Hook Lab did not receive valid JSON from the Writer.");
  }
  if (!Array.isArray(parsed.hooks)) throw new Error("Hook response did not contain a hooks array.");

  const seen = new Set<HookMechanism>();
  const hooks: HookVariant[] = [];
  for (const raw of parsed.hooks) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    if (!isHookMechanism(item.mechanism) || seen.has(item.mechanism)) continue;
    if (typeof item.spokenLine !== "string" || !item.spokenLine.trim()) continue;
    seen.add(item.mechanism);
    hooks.push({
      id: `hook-${item.mechanism}`,
      mechanism: item.mechanism,
      spokenLine: item.spokenLine.trim(),
      onScreenText: typeof item.onScreenText === "string" ? item.onScreenText.trim() : "",
      visualDirection: typeof item.visualDirection === "string" ? item.visualDirection.trim() : "",
      rationale: typeof item.rationale === "string" ? item.rationale.trim() : "",
    });
  }
  if (hooks.length < 3) throw new Error("Hook response needs at least three distinct, usable approaches.");
  return hooks;
}

export async function generateHookVariants(
  input: HookGenerationInput,
  cfg: ClaudeConfig,
  author: HookAuthorAdapter = callClaude,
): Promise<HookVariant[]> {
  const prompt = buildHookPrompt(input);
  const first = await author(prompt, cfg);
  try {
    return parseHookVariants(first);
  } catch (firstError) {
    const message = firstError instanceof Error ? firstError.message : String(firstError);
    const repairPrompt = [
      "Repair the following invalid Hook Lab response.",
      `Validation error: ${message}`,
      "Return only corrected JSON using the original hook contract and grounding rules.",
      `Invalid output:\n${first.slice(0, 20_000)}`,
      `Original requirements:\n${prompt}`,
    ].join("\n\n");
    const repaired = await author(repairPrompt, cfg);
    try {
      return parseHookVariants(repaired);
    } catch (repairError) {
      const repairMessage = repairError instanceof Error ? repairError.message : String(repairError);
      throw new Error(`Hook Lab could not generate valid hooks after one repair attempt. ${repairMessage}`);
    }
  }
}

/** Apply only the opening line. The remaining cut and story body stay byte-for-byte unchanged. */
export function applyHookVariant(
  cut: Cut,
  story: Story | undefined,
  hook: HookVariant,
): { cut: Cut; story: Story } {
  const previousOpening = cut.beats[0]?.scriptText.trim() ?? "";
  const beats = cut.beats.map((beat, index) => index === 0
    ? { ...beat, scriptText: hook.spokenLine, storyPurpose: "hook" as const }
    : beat,
  );
  const voSegments = cut.voSegments?.map((segment) =>
    Math.abs(segment.startTimeSec) < 0.01 && segment.text.trim() === previousOpening
      ? { ...segment, text: hook.spokenLine }
      : segment,
  );
  return {
    cut: { ...cut, beats, ...(voSegments ? { voSegments } : {}) },
    story: {
      logline: story?.logline ?? hook.spokenLine,
      beats: beats.map((beat) => ({ clipId: beat.clipId, scriptText: beat.scriptText })),
    },
  };
}
