import type { ClipDescription } from "../domain/types";
import type { SampledFrame } from "./frameSampler";

// AI calls go through a local CLI proxy: Claude Code (`claude -p`) or Codex
// (`codex exec`). Both use the user's existing CLI login, with no browser key.
// Claude receives its model alias; Codex uses the model configured by its CLI.

export interface ClaudeConfig {
  provider?: "claude" | "codex";
  model?: string;
  /** Tone/mood phrase to steer the output (see SettingsContext.toneHint). */
  tone?: string;
  /** Genre/format phrase to steer story structure (see SettingsContext.scriptTypeHint). */
  scriptType?: string;
}

export function aiEndpoint(provider?: ClaudeConfig["provider"]): string {
  return provider === "codex" ? "/api/codex" : "/api/claude";
}

async function runClaude(prompt: string, images: string[] | undefined, cfg?: ClaudeConfig): Promise<string> {
  const endpoint = aiEndpoint(cfg?.provider);
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    // Claude's proxy maps these ids to its CLI aliases. Codex intentionally
    // uses its own configured default model instead of receiving a Claude id.
    body: JSON.stringify({ prompt, images, model: cfg?.provider === "codex" ? undefined : cfg?.model }),
  });
  const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
  if (!res.ok || data.error) throw new Error(data.error ?? `proxy HTTP ${res.status}`);
  return data.text ?? "";
}

/** Text-only call (author, refine). */
export async function callClaude(prompt: string, cfg: ClaudeConfig): Promise<string> {
  return runClaude(prompt, undefined, cfg);
}

/** Vision call with a custom prompt + base64 images (film-look analysis/grading). */
export async function callClaudeVision(prompt: string, images: string[], cfg: ClaudeConfig): Promise<string> {
  return runClaude(prompt, images, cfg);
}

// A neutral description of the footage — the signal the Story is built from, not
// coaching for the creator (ADR-0007). Deliberately tone-neutral: a factual read
// has no casual/cinematic register; Tone belongs to the Script, not here (ADR-0007,
// domain glossary "Tone").
const DESCRIBE_PROMPT = (frameCount: number, hint: string) =>
  `You are a video editor describing a creator's raw footage — ${frameCount} frames sampled across ONE short clip.` +
  (hint
    ? ` The creator named this clip "${hint}" — treat that as a hint to the moment, but go off what you actually see.`
    : "") +
  `\n\nJudge only from what you see (the clip may have no audio). Describe the clip plainly and briefly — this is the signal a story gets built from, not advice for the creator. Reply with EXACTLY:\n` +
  `SUBJECT: <ONE short line — who/what is in frame and what happens. Max ~14 words, no fluff.>\n` +
  `SETTING: <2-6 words — where it is and how it feels (e.g. "cold alpine dawn, still").>\n` +
  `USABILITY: <1-5> <6-word reason>\n` +
  `No preamble.`;

/** Lenient parse — the raw text is always retained regardless. */
function parseDescription(text: string, model: string): ClipDescription {
  const section = (label: string) => {
    const m = text.match(new RegExp(`${label}:\\s*([\\s\\S]*?)(?:\\n[A-Z][A-Z &]+:|$)`, "i"));
    return m ? m[1].trim() : "";
  };
  const usabilityMatch = text.match(/USABILITY:?\s*(\d)/i);
  return {
    subjectAction: section("SUBJECT") || text.trim(),
    settingMood: section("SETTING"),
    usability: usabilityMatch ? Number(usabilityMatch[1]) : 0,
    model,
    raw: text,
  };
}

/** Analyze one clip: frames + filename hint → ClipDescription (ADR-0001). */
export async function describeClip(
  frames: SampledFrame[],
  filenameHint: string,
  cfg: ClaudeConfig,
): Promise<ClipDescription> {
  const text = await runClaude(DESCRIBE_PROMPT(frames.length, filenameHint), frames.map((f) => f.base64), cfg);
  return parseDescription(text, cfg.model ?? "claude");
}
