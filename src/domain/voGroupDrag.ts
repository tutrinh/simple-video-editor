import type { VoSegment } from "./types";

// Moving a set of VO segments as one. The whole point is that spacing between the
// chips never changes: a single clamped delta is applied to every segment, rather than
// each one clamping itself — which would let the leading chip pile up against 0 while
// the others kept moving, silently collapsing the gaps.

/** Each dragged segment's start at the moment the drag began. */
export type DragOrigins = ReadonlyMap<string, number>;

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * The delta the group can actually take: enough that the earliest segment stays at or
 * after 0 and the latest ends at or before `totalDur`. When the group is wider than the
 * timeline the lower bound wins, pinning it to the start rather than jittering.
 */
export function clampGroupDelta(
  segments: readonly VoSegment[],
  origins: DragOrigins,
  deltaSec: number,
  totalDur: number,
): number {
  if (segments.length === 0) return 0;

  let minStart = Number.POSITIVE_INFINITY;
  let maxEnd = Number.NEGATIVE_INFINITY;
  for (const segment of segments) {
    const start = origins.get(segment.id) ?? segment.startTimeSec;
    minStart = Math.min(minStart, start);
    maxEnd = Math.max(maxEnd, start + segment.durationSec);
  }

  const lowerBound = -minStart;
  const upperBound = totalDur - maxEnd;
  if (upperBound < lowerBound) return lowerBound;
  return Math.max(lowerBound, Math.min(upperBound, deltaSec));
}

/**
 * Apply a group move, returning only the segments whose start actually changed so the
 * dispatch stays small during a drag. Relative spacing is preserved exactly.
 */
export function moveVoGroup(
  segments: readonly VoSegment[],
  origins: DragOrigins,
  deltaSec: number,
  totalDur: number,
): VoSegment[] {
  const applied = clampGroupDelta(segments, origins, deltaSec, totalDur);
  const moved: VoSegment[] = [];

  for (const segment of segments) {
    const origin = origins.get(segment.id) ?? segment.startTimeSec;
    const startTimeSec = round1(Math.max(0, origin + applied));
    if (startTimeSec !== segment.startTimeSec) {
      moved.push({ ...segment, startTimeSec });
    }
  }

  return moved;
}
