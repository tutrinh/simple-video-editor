import { describe, expect, it } from "vitest";
import { SEGMENT_DURATION_STEP_SEC, stepSegmentDuration } from "./segmentDuration";

const wide = { minSec: 0.1, maxSec: 100 };

describe("stepSegmentDuration", () => {
  it("steps by 0.1s in both directions", () => {
    expect(stepSegmentDuration(3, wide, 1)).toBe(3.1);
    expect(stepSegmentDuration(3, wide, -1)).toBe(2.9);
    expect(SEGMENT_DURATION_STEP_SEC).toBe(0.1);
  });

  it("stays on the 0.1s grid instead of accumulating float error", () => {
    let current = 0.1;
    for (let i = 0; i < 7; i++) {
      current = stepSegmentDuration(current, wide, 1) ?? current;
    }
    expect(current).toBe(0.8);
  });

  it("snaps an off-grid length onto the grid", () => {
    expect(stepSegmentDuration(3.04, wide, 1)).toBe(3.1);
  });

  it("clamps to the ceiling and reports no change once there", () => {
    expect(stepSegmentDuration(4.9, { minSec: 0.1, maxSec: 5 }, 1)).toBe(5);
    expect(stepSegmentDuration(5, { minSec: 0.1, maxSec: 5 }, 1)).toBeNull();
  });

  it("clamps to the floor and reports no change once there", () => {
    // VO and overlays bottom out at 0.5s, unlike the 0.1s tracks.
    expect(stepSegmentDuration(0.6, { minSec: 0.5, maxSec: 100 }, -1)).toBe(0.5);
    expect(stepSegmentDuration(0.5, { minSec: 0.5, maxSec: 100 }, -1)).toBeNull();
  });

  it("pulls an over-long segment down to the ceiling on the first step", () => {
    // A sound effect can sit longer than its source after the cut shortens.
    expect(stepSegmentDuration(9, { minSec: 0.1, maxSec: 4 }, 1)).toBe(4);
    expect(stepSegmentDuration(9, { minSec: 0.1, maxSec: 4 }, -1)).toBe(4);
  });

  it("survives an inverted range rather than returning a negative length", () => {
    // A segment starting past the end of a shortened cut gives maxSec < minSec.
    expect(stepSegmentDuration(2, { minSec: 0.5, maxSec: -3 }, 1)).toBe(0.5);
    expect(stepSegmentDuration(0.5, { minSec: 0.5, maxSec: -3 }, -1)).toBeNull();
  });

  it("never returns a negative minimum", () => {
    expect(stepSegmentDuration(0.2, { minSec: -5, maxSec: 100 }, -1)).toBe(0.1);
  });

  it("returns null for non-finite input", () => {
    expect(stepSegmentDuration(Number.NaN, wide, 1)).toBeNull();
    expect(stepSegmentDuration(3, { minSec: Number.NaN, maxSec: 10 }, 1)).toBeNull();
    expect(stepSegmentDuration(3, { minSec: 0.1, maxSec: Number.NaN }, 1)).toBeNull();
  });
});
