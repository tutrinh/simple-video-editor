// Script-driven pacing (ADR-0004): a Beat's duration derives from its Script
// segment's spoken length. Words are the master clock; the trim window is chosen
// within the duration the words dictate.

const WORDS_PER_SEC = 2.5; // ~150 wpm, a natural read/speak rate
const MIN_SECONDS = 1.5; // readability floor — a caption needs time to land

export function estimateSpokenSeconds(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(MIN_SECONDS, words / WORDS_PER_SEC);
}

// Per-line caption timing. When the author sets explicit per-line timers
// (Beat.captionDurations), the caption stops being one stacked block shown for
// the whole beat and instead becomes a sequence: line 1 on screen for its timer,
// then line 2, and so on. A silent lead-in precedes the first line and a silent
// tail follows the last, so the beat doesn't snap in/out of text — the footage
// (or a held last frame) plays under those buffers with no caption. The beat's
// on-screen clock is lead + sum(timers) + tail.

/** A line that shows on screen for [start, end) within the beat. */
export interface CaptionCue {
  /** Trimmed, non-empty line text. */
  text: string;
  /** This line's on-screen duration in seconds. */
  sec: number;
  /** Start within the beat (already offset by the lead-in). */
  start: number;
  /** start + sec. */
  end: number;
}

/** A timed caption sequence: buffered lead-in, the cues, and a trailing tail. */
export interface CaptionSchedule {
  /** Silent seconds before the first line. */
  leadSec: number;
  /** Silent seconds after the last line. */
  tailSec: number;
  /** The lines in order, with beat-relative [start, end) windows. */
  cues: CaptionCue[];
  /** Total on-screen length: leadSec + Σ cue.sec + tailSec. */
  total: number;
}

const MIN_LINE_SECONDS = 0.1; // avoid zero-length windows; author still sets the value
/** Default breathing room around a timed sequence so it doesn't start/end abruptly. */
export const CAPTION_LEAD_SEC = 1; // silent lead-in before the first line
export const CAPTION_TAIL_SEC = 2; // silent tail after the last line

/**
 * Zip `captionText`'s lines with the author's per-line timers into a cumulative
 * schedule, dropping empty lines, and wrap it in a lead-in / tail buffer.
 * Durations align to raw line indices (row i ↔ durations[i]); a missing or
 * non-finite timer falls back to the line's spoken estimate. `buffers` overrides
 * the default lead/tail (e.g. {leadSec:0,tailSec:0} for none). Returns null when
 * there are no timers (callers fall back to the stacked, whole-beat caption).
 */
export function captionSchedule(
  captionText: string,
  durations?: number[],
  buffers?: { leadSec?: number; tailSec?: number },
): CaptionSchedule | null {
  if (!durations || durations.length === 0) return null;
  const leadSec = Math.max(0, buffers?.leadSec ?? CAPTION_LEAD_SEC);
  const tailSec = Math.max(0, buffers?.tailSec ?? CAPTION_TAIL_SEC);
  const cues: CaptionCue[] = [];
  let cursor = leadSec;
  captionText.split("\n").forEach((raw, i) => {
    const text = raw.trim();
    if (!text) return;
    const d = durations[i];
    const sec = Math.max(MIN_LINE_SECONDS, Number.isFinite(d) ? (d as number) : estimateSpokenSeconds(text));
    cues.push({ text, sec, start: cursor, end: (cursor += sec) });
  });
  if (!cues.length) return null;
  return { leadSec, tailSec, cues, total: cursor + tailSec };
}

/** Total on-screen duration of a timed caption sequence, buffers included (0 if none). */
export function scheduleDuration(schedule: CaptionSchedule | null): number {
  return schedule ? schedule.total : 0;
}

/** The cue visible at time `t` seconds into the beat, or null (lead/gap/tail). */
export function cueAt(schedule: CaptionSchedule | null, t: number): CaptionCue | null {
  if (!schedule) return null;
  for (const c of schedule.cues) if (t >= c.start && t < c.end) return c;
  return null;
}
