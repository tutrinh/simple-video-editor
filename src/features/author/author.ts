import type { Clip, Story } from "../../domain/types";
import { callClaude, type ClaudeConfig } from "../../lib/claudeClient";
import { hintFromName } from "../analyze/analyze";

// Author the Story (ADR-0001, ADR-0004): from the Clip Descriptions (+ optional
// Direction), Claude drops weak clips, orders the rest into a highlight arc, and
// writes a Script line per kept clip. Highlight footage arcs build-up → climax →
// payoff; filenames carry the beats.

interface ClipPayload {
  id: string;
  label: string;
  usability: number;
  durationSec: number;
  /** What the clip shows: subject + action. */
  subjectAction: string;
  /** Where it is and how it feels: setting + mood. */
  settingMood: string;
}

function buildPrompt(clips: ClipPayload[], direction: string, tone: string): string {
  return (
    `You are editing a short highlight reel from the clips below (JSON). Each has a filename label ` +
    `(which often names the key moment), a 1-5 usability score, duration, a subject/action description, ` +
    `and the setting/mood of the shot.\n\n` +
    `Clips:\n${JSON.stringify(clips, null, 2)}\n\n` +
    (tone ? `Tone/voice for the writing: ${tone}.\n` : "") +
    (direction ? `Creative direction from the editor: "${direction}"\n\n` : "") +
    `Build a highlight story:\n` +
    `- Arc the reel build-up → climax → payoff. Lead in, escalate, land the biggest moments last.\n` +
    `- DROP weak or redundant clips (low usability, or nothing to add) — you need not use them all.\n` +
    `- Order the kept clips for momentum.\n` +
    `- For each kept clip write ONE short Script line — a clean, present-tense line that carries the moment ` +
    `on-screen (no quotes). Let the requested tone set the voice; draw on each clip's subject and mood.\n\n` +
    `Reply with ONLY this JSON, no prose:\n` +
    `{"logline": "<one sentence>", "beats": [{"clipId": "<id>", "script": "<line>"}]}`
  );
}

function extractJson(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  return start >= 0 && end > start ? body.slice(start, end + 1) : body;
}

/** A clip as far as beat-matching cares: its real id plus the label/name Claude saw. */
export interface ClipRef {
  id: string;
  label?: string;
  name?: string;
}

/**
 * Resolve a clipId string from the model back to a real clip id. Models don't
 * always echo the exact `crypto.randomUUID()` — they truncate it, change case,
 * or return the filename/label instead — so we fall back through progressively
 * looser matches rather than silently dropping the beat.
 */
function resolveClipId(raw: string, clips: ClipRef[]): string | null {
  const r = raw.trim();
  if (!r) return null;
  const lc = r.toLowerCase();
  const exact = clips.find((c) => c.id === r);
  if (exact) return exact.id;
  const ci = clips.find((c) => c.id.toLowerCase() === lc);
  if (ci) return ci.id;
  // Truncated or extended id (only for tokens long enough to be unambiguous).
  if (r.length >= 6) {
    const pref = clips.find((c) => {
      const id = c.id.toLowerCase();
      return id.startsWith(lc) || lc.startsWith(id);
    });
    if (pref) return pref.id;
  }
  // Label or filename echoed in place of the id.
  const byName = clips.find(
    (c) => (c.label ?? "").toLowerCase() === lc || (c.name ?? "").toLowerCase() === lc,
  );
  return byName ? byName.id : null;
}

/**
 * Parse the author response into a Story, resolving each beat's clipId to a real
 * clip. `clips` may be the ClipRefs (enabling label/filename fallback) or a bare
 * Set of ids. Throws if the model returned beats but none resolve — a silent
 * empty Story looks downstream like "assemble does nothing".
 */
export function parseStory(text: string, clips: ClipRef[] | Set<string>): Story {
  const refs: ClipRef[] = clips instanceof Set ? [...clips].map((id) => ({ id })) : clips;
  const data = JSON.parse(extractJson(text)) as {
    logline?: unknown;
    beats?: unknown;
  };
  const logline = typeof data.logline === "string" ? data.logline : "";
  const rawBeats = Array.isArray(data.beats)
    ? data.beats.filter(
        (b): b is { clipId: string; script: string } =>
          !!b && typeof b === "object" &&
          typeof (b as { clipId?: unknown }).clipId === "string" &&
          typeof (b as { script?: unknown }).script === "string",
      )
    : [];
  const beats = rawBeats
    .map((b) => {
      const clipId = resolveClipId(b.clipId, refs);
      return clipId ? { clipId, scriptText: b.script.trim() } : null;
    })
    .filter((b): b is NonNullable<typeof b> => b !== null);

  if (rawBeats.length > 0 && beats.length === 0) {
    throw new Error(
      `Author response had ${rawBeats.length} beat(s) but none referenced a known clip. ` +
        `The model likely returned clip ids that don't match — try Regenerate story.`,
    );
  }
  return { logline, beats };
}

/** A clip is authorable when it's been analyzed and the editor hasn't excluded it. */
export function isAuthorable(clip: Clip): boolean {
  return !!clip.description && clip.included !== false;
}

export async function authorStory(clips: Clip[], direction: string, cfg: ClaudeConfig): Promise<Story> {
  const described = clips.filter(isAuthorable);
  if (described.length === 0) throw new Error("no selected, analyzed clips to author from");
  const payload: ClipPayload[] = described.map((c) => ({
    id: c.id,
    label: hintFromName(c.name),
    usability: c.description!.usability,
    durationSec: Math.round(c.durationSec),
    subjectAction: c.description!.subjectAction,
    settingMood: c.description!.settingMood,
  }));
  const text = await callClaude(buildPrompt(payload, direction, cfg.tone ?? ""), cfg);
  return parseStory(
    text,
    described.map((c) => ({ id: c.id, label: hintFromName(c.name), name: c.name })),
  );
}
