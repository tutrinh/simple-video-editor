import type { Beat } from "./types";

// Beat resizing, shared by the Inspector's custom-duration number input and the
// timeline's Up/Down arrow shortcut so both step identically. The Inspector control
// is <input type="number" min={0.1} max={clip.durationSec} step={0.1}>, and these
// constants are what that input's native arrow-key behaviour is spelled out from.

export const BEAT_DURATION_STEP_SEC = 0.1;
export const MIN_BEAT_DURATION_SEC = 0.1;

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Resize a beat to `seconds`, holding the in-point where the clip allows and sliding
 * it earlier only when the beat would otherwise run past the end of the footage.
 * Returns null when the request is not a change (already clamped, or identical), so
 * callers can skip a no-op dispatch.
 */
export function resizeBeat(
  beat: Beat,
  clipDurationSec: number,
  seconds: number,
  preset: Beat["durationPreset"],
): Beat | null {
  if (!Number.isFinite(seconds) || !Number.isFinite(clipDurationSec)) return null;

  const durationSec = round1(Math.max(MIN_BEAT_DURATION_SEC, Math.min(seconds, clipDurationSec)));
  const inSec = round1(Math.max(0, Math.min(beat.inSec, clipDurationSec - durationSec)));
  const outSec = round1(inSec + durationSec);

  const unchanged =
    durationSec === round1(beat.durationSec)
    && inSec === round1(beat.inSec)
    && outSec === round1(beat.outSec)
    && preset === beat.durationPreset;
  if (unchanged) return null;

  return { ...beat, inSec, outSec, durationSec, durationPreset: preset };
}

/**
 * Step a beat's duration one increment, matching what the Inspector's number input
 * does on Up/Down. Always lands on a 0.1s grid and marks the beat "custom", since a
 * stepped length is by definition no longer one of the presets.
 */
export function stepBeatDuration(
  beat: Beat,
  clipDurationSec: number,
  direction: 1 | -1,
): Beat | null {
  const current = round1(beat.durationSec);
  const next = round1(current + direction * BEAT_DURATION_STEP_SEC);
  return resizeBeat(beat, clipDurationSec, next, "custom");
}
