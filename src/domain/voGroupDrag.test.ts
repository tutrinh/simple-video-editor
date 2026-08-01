import { describe, expect, it } from "vitest";
import type { VoSegment } from "./types";
import { clampGroupDelta, moveVoGroup } from "./voGroupDrag";

function vo(id: string, startTimeSec: number, durationSec = 2): VoSegment {
  return { id, text: id, startTimeSec, durationSec, captionVisible: true };
}

function originsOf(segments: VoSegment[]) {
  return new Map(segments.map((s) => [s.id, s.startTimeSec]));
}

describe("clampGroupDelta", () => {
  const group = [vo("a", 2), vo("b", 6)]; // spans 2 → 8

  it("passes a delta through when the whole group fits", () => {
    expect(clampGroupDelta(group, originsOf(group), 1.5, 20)).toBe(1.5);
  });

  it("stops the earliest segment at zero", () => {
    expect(clampGroupDelta(group, originsOf(group), -10, 20)).toBe(-2);
  });

  it("stops the latest segment at the end of the timeline", () => {
    expect(clampGroupDelta(group, originsOf(group), 99, 10)).toBe(2);
  });

  it("pins to the start when the group is wider than the timeline", () => {
    const wide = [vo("a", 1), vo("b", 8)]; // spans 1 → 10, timeline only 5s
    expect(clampGroupDelta(wide, originsOf(wide), 3, 5)).toBe(-1);
  });

  it("returns zero for an empty group", () => {
    expect(clampGroupDelta([], new Map(), 5, 20)).toBe(0);
  });
});

describe("moveVoGroup", () => {
  it("preserves the spacing between segments", () => {
    const group = [vo("a", 1), vo("b", 4), vo("c", 9)];
    const moved = moveVoGroup(group, originsOf(group), 2, 30);
    expect(moved.map((s) => [s.id, s.startTimeSec])).toEqual([["a", 3], ["b", 6], ["c", 11]]);
  });

  it("keeps spacing intact when the move is clamped at zero", () => {
    const group = [vo("a", 1), vo("b", 4)];
    const moved = moveVoGroup(group, originsOf(group), -5, 30);
    // Not [0, 0] — the group shifts by -1 and the 3s gap survives.
    expect(moved.map((s) => [s.id, s.startTimeSec])).toEqual([["a", 0], ["b", 3]]);
  });

  it("keeps spacing intact when clamped at the end", () => {
    const group = [vo("a", 1), vo("b", 4)]; // b ends at 6
    const moved = moveVoGroup(group, originsOf(group), 20, 10);
    expect(moved.map((s) => [s.id, s.startTimeSec])).toEqual([["a", 5], ["b", 8]]);
  });

  it("returns only the segments that actually moved", () => {
    const group = [vo("a", 1), vo("b", 4)];
    // A delta under the rounding grid leaves everything where it is.
    expect(moveVoGroup(group, originsOf(group), 0.02, 30)).toEqual([]);
  });

  it("rounds each start onto the 0.1s grid", () => {
    const group = [vo("a", 1), vo("b", 4)];
    const moved = moveVoGroup(group, originsOf(group), 0.37, 30);
    expect(moved.map((s) => s.startTimeSec)).toEqual([1.4, 4.4]);
  });

  it("measures from the drag origin, not the live position", () => {
    // Mid-drag the segments already sit at their moved position; a delta is always
    // relative to where the drag started, so this must not compound.
    const live = [vo("a", 5), vo("b", 8)];
    const origins = new Map([["a", 1], ["b", 4]]);
    const moved = moveVoGroup(live, origins, 2, 30);
    expect(moved.map((s) => [s.id, s.startTimeSec])).toEqual([["a", 3], ["b", 6]]);
  });

  it("leaves durations and every other field untouched", () => {
    const group = [{ ...vo("a", 1), volume: 0.4, captionVisible: false, fitToBeat: true }];
    const [moved] = moveVoGroup(group, originsOf(group), 2, 30);
    expect(moved).toEqual({ ...group[0], startTimeSec: 3 });
  });

  it("handles a single-segment group like an ordinary move", () => {
    const group = [vo("a", 1)];
    expect(moveVoGroup(group, originsOf(group), 3, 30)[0].startTimeSec).toBe(4);
  });

  it("does nothing with an empty group", () => {
    expect(moveVoGroup([], new Map(), 5, 30)).toEqual([]);
  });
});
