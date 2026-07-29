import { describe, expect, it } from "vitest";
import { titleVisibilityAt, titleWindow } from "./titleTiming";

describe("title timing", () => {
  it("keeps intro titles anchored at the beginning", () => {
    expect(titleWindow({ scope: "intro", introSec: 2.5 }, 10)).toEqual({
      startSec: 0,
      endSec: 2.5,
    });
  });

  it("resolves and clamps a timed range", () => {
    expect(titleWindow(
      { scope: "range", startSec: 2, durationSec: 3 },
      4,
    )).toEqual({
      startSec: 2,
      endSec: 4,
    });
  });

  it("uses range-local time for title animations", () => {
    expect(titleVisibilityAt(
      { scope: "range", startSec: 2, durationSec: 2 },
      1.9,
    )).toMatchObject({ visible: false });

    expect(titleVisibilityAt(
      { scope: "range", startSec: 2, durationSec: 2 },
      2.25,
    )).toEqual({
      visible: true,
      opacity: 1,
      localElapsedSec: 0.25,
    });

    expect(titleVisibilityAt(
      { scope: "range", startSec: 2, durationSec: 2 },
      4,
    )).toMatchObject({ visible: false });
  });

  it("cuts cleanly at the end when fade out is disabled", () => {
    expect(titleVisibilityAt(
      { scope: "range", startSec: 2, durationSec: 2, fadeOut: false },
      3.9,
    )).toEqual({
      visible: true,
      opacity: 1,
      localElapsedSec: 1.9,
    });
  });
});
