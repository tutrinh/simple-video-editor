import type { Clip } from "../../domain/types";
import { callClaude, type ClaudeConfig } from "../../lib/claudeClient";

// Per-Beat AI nudge (propose-then-refine): rewrite a single caption without
// touching the rest of the Cut. Manual reorder/trim/swap/remove live in the view;
// this is the one targeted AI action in Phase 5.
export async function rewriteCaption(
  clip: Clip,
  currentCaption: string,
  logline: string,
  cfg: ClaudeConfig,
): Promise<string> {
  const prompt =
    `Rewrite this on-screen caption for a highlight reel: punchier and fresh, but same beat. ` +
    `Short, present-tense, no quotes or emoji. Return ONLY the new line.\n\n` +
    (cfg.tone ? `Tone/voice: ${cfg.tone}.\n` : "") +
    `Reel logline: ${logline}\n` +
    `Clip: ${clip.description?.subjectAction ?? clip.name}\n` +
    `Current caption: ${currentCaption}`;
  const text = await callClaude(prompt, cfg);
  return text.trim().replace(/^["']|["']$/g, "").split("\n")[0];
}

/** Strip list bullets/numbering and wrapping quotes from a model reply, then
 *  keep up to `count` non-empty lines. Pure — the network call lives elsewhere. */
export function parseAlternatives(text: string, count: number): string[] {
  return text
    .split("\n")
    .map((s) => s.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").replace(/^["']|["']$/g, "").trim())
    .filter(Boolean)
    .slice(0, count);
}

/** Alternative captions for ONE line — a few fresh takes on the same beat. */
export async function suggestLineAlternatives(
  clip: Clip | undefined,
  line: string,
  logline: string,
  cfg: ClaudeConfig,
  count = 3,
): Promise<string[]> {
  const prompt =
    `Suggest ${count} alternative on-screen captions for one beat of a highlight reel. ` +
    `Each must be punchy, present-tense, short (max ~8 words), no quotes/emoji/numbering, ` +
    `and keep the same meaning as the current line. Return EXACTLY ${count} lines — one caption ` +
    `per line, nothing else.\n\n` +
    (cfg.tone ? `Tone/voice: ${cfg.tone}.\n` : "") +
    `Reel logline: ${logline}\n` +
    `Clip: ${clip?.description?.subjectAction ?? clip?.name ?? "unknown"}\n` +
    `Current caption: ${line}`;
  const text = await callClaude(prompt, cfg);
  return parseAlternatives(text, count);
}

/**
 * Alternative captions for every caption line in a beat, generated line by line.
 * Returns an array aligned to `lines` (row i → its alternatives); blank lines
 * yield no alternatives. Lines are requested in parallel.
 */
export async function suggestCaptionAlternatives(
  clip: Clip | undefined,
  lines: string[],
  logline: string,
  cfg: ClaudeConfig,
  count = 3,
): Promise<string[][]> {
  return Promise.all(
    lines.map((line) => (line.trim() ? suggestLineAlternatives(clip, line, logline, cfg, count) : Promise.resolve<string[]>([]))),
  );
}
