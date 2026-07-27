import { describe, expect, it } from "vitest";
import {
  anchoredScrollLeft,
  clampTimelineZoom,
  timelineCanvasWidth,
} from "./timelineScale";

describe("timeline scale", () => {
  it("fits at 1x and expands one shared canvas at higher zoom", () => {
    expect(timelineCanvasWidth(900, 1)).toBe(900);
    expect(timelineCanvasWidth(900, 2.5)).toBe(2250);
    expect(timelineCanvasWidth(900, 8)).toBe(7200);
  });

  it("clamps invalid and out-of-range zoom values", () => {
    expect(clampTimelineZoom(0)).toBe(1);
    expect(clampTimelineZoom(99)).toBe(8);
    expect(clampTimelineZoom(Number.NaN)).toBe(1);
  });

  it("keeps the visible center anchored when zooming", () => {
    expect(anchoredScrollLeft(200, 400, 1600, 3200, 800)).toBe(800);
  });

  it("clamps anchored scrolling at both canvas edges", () => {
    expect(anchoredScrollLeft(0, 0, 800, 1600, 800)).toBe(0);
    expect(anchoredScrollLeft(800, 800, 1600, 2400, 800)).toBe(1600);
  });
});
