import { describe, expect, test } from "vitest";
import { assignSubLanes } from "./subLanes";

describe("assignSubLanes", () => {
  test("returns empty array for empty items", () => {
    expect(assignSubLanes([])).toEqual([]);
  });

  test("assigns single lane to non-overlapping items", () => {
    const items = [
      { id: "a", startTimeSec: 0, durationSec: 5 },
      { id: "b", startTimeSec: 6, durationSec: 4 },
      { id: "c", startTimeSec: 11, durationSec: 2 },
    ];
    const res = assignSubLanes(items);
    expect(res.map((r) => r.lane)).toEqual([0, 0, 0]);
  });

  test("assigns distinct sub-lanes to overlapping items", () => {
    const items = [
      { id: "a", startTimeSec: 19.1, durationSec: 2.0 }, // 19.1s–21.1s
      { id: "b", startTimeSec: 20.0, durationSec: 4.0 }, // 20.0s–24.0s (overlaps with a)
    ];
    const res = assignSubLanes(items);
    expect(res[0].lane).toBe(0);
    expect(res[1].lane).toBe(1);
  });

  test("handles 3+ overlapping items and reuses lanes when free", () => {
    const items = [
      { id: "a", startTimeSec: 10, durationSec: 5 }, // 10s–15s -> lane 0
      { id: "b", startTimeSec: 12, durationSec: 6 }, // 12s–18s -> lane 1
      { id: "c", startTimeSec: 14, durationSec: 6 }, // 14s–20s -> lane 2
      { id: "d", startTimeSec: 16, durationSec: 5 }, // 16s–21s -> lane 0 (re-used since a ended at 15s)
    ];
    const res = assignSubLanes(items);
    expect(res.map((r) => r.lane)).toEqual([0, 1, 2, 0]);
  });

  test("preserves original array ordering in output", () => {
    const items = [
      { id: "late", startTimeSec: 20, durationSec: 5 },
      { id: "early", startTimeSec: 5, durationSec: 5 },
    ];
    const res = assignSubLanes(items);
    expect(res[0].id).toBe("late");
    expect(res[1].id).toBe("early");
    expect(res[0].lane).toBe(0);
    expect(res[1].lane).toBe(0);
  });
});
