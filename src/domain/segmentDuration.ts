// Stepping a track segment's length by keyboard, the counterpart to beatDuration for
// everything that isn't a beat. Each track clamps differently — a sound effect can't
// outlast its source file, a sticker has no source at all — so the bounds are supplied
// by the caller and this only owns the step, the grid, and the "nothing changed" answer.

export const SEGMENT_DURATION_STEP_SEC = 0.1;

export interface DurationBounds {
  /** Shortest the segment may be. Tracks disagree: 0.5s for VO and overlays, 0.1s elsewhere. */
  minSec: number;
  /** Longest it may be — usually the room left to the end of the cut, capped by any source length. */
  maxSec: number;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * The segment's next length one step up or down, on the 0.1s grid and inside `bounds`.
 * Returns null when the step changes nothing — already at a limit, or the bounds leave
 * no room — so callers can skip a pointless dispatch.
 */
export function stepSegmentDuration(
  currentSec: number,
  bounds: DurationBounds,
  direction: 1 | -1,
): number | null {
  if (!Number.isFinite(currentSec) || !Number.isFinite(bounds.minSec) || !Number.isFinite(bounds.maxSec)) {
    return null;
  }

  const minSec = round1(Math.max(0, bounds.minSec));
  // A segment sitting past the end of a shortened cut would otherwise get an inverted
  // range; collapsing max up to min keeps the clamp meaningful rather than negative.
  const maxSec = round1(Math.max(minSec, bounds.maxSec));

  const current = round1(currentSec);
  const stepped = current + direction * SEGMENT_DURATION_STEP_SEC;
  const next = round1(Math.max(minSec, Math.min(maxSec, stepped)));

  return next === current ? null : next;
}
