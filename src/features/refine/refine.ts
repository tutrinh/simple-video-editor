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

/** Strip list bullets/numbering, preamble intros, and wrapping quotes from a model reply, then
 *  keep up to `count` non-empty lines. Pure — the network call lives elsewhere. */
export function parseAlternatives(text: string, count: number): string[] {
  const PREAMBLE_RE = /^(?:here (?:are|is)|certainly|sure|options|alternatives|captions?:|below|```)/i;
  return text
    .split("\n")
    .map((s) => s.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").replace(/^["']|["']$/g, "").trim())
    .filter((s) => Boolean(s) && !PREAMBLE_RE.test(s))
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
    `Suggest EXACTLY ${count} alternative on-screen captions for one beat of a highlight reel. ` +
    `Each must be punchy, present-tense, short (max ~8 words), no quotes, no emoji, no numbering, no preamble. ` +
    `Output ONLY the ${count} caption lines (one per line). Nothing else.\n\n` +
    (cfg.tone ? `Tone/voice: ${cfg.tone}.\n` : "") +
    `Reel logline: ${logline || "Highlight reel"}\n` +
    `Clip: ${clip?.description?.subjectAction ?? clip?.name ?? "raw footage"}\n` +
    `Current caption: ${line.trim() || "(blank line - generate a fresh caption line for this footage)"}`;
  const text = await callClaude(prompt, cfg);
  return parseAlternatives(text, count);
}

/**
 * Alternative captions for every caption line in a beat, generated line by line.
 * Returns an array aligned to `lines` (row i → its alternatives).
 * Lines are requested in parallel.
 */
export async function suggestCaptionAlternatives(
  clip: Clip | undefined,
  lines: string[],
  logline: string,
  cfg: ClaudeConfig,
  count = 3,
): Promise<string[][]> {
  const targetLines = lines.length > 0 ? lines : [""];
  return Promise.all(
    targetLines.map((line) => suggestLineAlternatives(clip, line, logline, cfg, count)),
  );
}
