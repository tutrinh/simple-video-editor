import type { ClipDescription } from "../domain/types";
import type { SampledFrame } from "./frameSampler";

// AI calls go through the local dev proxy (/api/claude), which runs `claude -p`
// with the user's existing Claude Code auth — no API key (see ADR-0005). Only the
// model alias travels; the proxy maps it to Claude Code's opus/sonnet/haiku.

export interface ClaudeConfig {
  model?: string;
  /** Tone/mood phrase to steer the output (see SettingsContext.toneHint). */
  tone?: string;
}

async function runClaude(prompt: string, images: string[] | undefined, model?: string): Promise<string> {
  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt, images, model }),
  });
  const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
  if (!res.ok || data.error) throw new Error(data.error ?? `proxy HTTP ${res.status}`);
  return data.text ?? "";
}

/** Text-only call (author, refine). */
export async function callClaude(prompt: string, cfg: ClaudeConfig): Promise<string> {
  return runClaude(prompt, undefined, cfg.model);
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
  const text = await runClaude(DESCRIBE_PROMPT(frames.length, filenameHint), frames.map((f) => f.base64), cfg.model);
  return parseDescription(text, cfg.model ?? "claude");
}
