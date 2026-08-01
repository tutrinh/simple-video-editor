import { describe, expect, it } from "vitest";
import type { Beat } from "./types";
import {
  BEAT_DURATION_STEP_SEC,
  MIN_BEAT_DURATION_SEC,
  resizeBeat,
  stepBeatDuration,
} from "./beatDuration";

function beat(overrides: Partial<Beat> = {}): Beat {
  return {
    id: "b1",
    clipId: "c1",
    inSec: 0,
    outSec: 3,
    durationSec: 3,
    scriptText: "",
    captionText: "",
    durationPreset: "custom",
    ...overrides,
  };
}

describe("stepBeatDuration", () => {
  it("increments and decrements by the Inspector's 0.1s step", () => {
    expect(stepBeatDuration(beat(), 10, 1)?.durationSec).toBe(3.1);
    expect(stepBeatDuration(beat(), 10, -1)?.durationSec).toBe(2.9);
    expect(BEAT_DURATION_STEP_SEC).toBe(0.1);
  });

  it("moves the out-point with the duration, holding the in-point", () => {
    const grown = stepBeatDuration(beat({ inSec: 1, outSec: 4, durationSec: 3 }), 10, 1);
    expect(grown?.inSec).toBe(1);
    expect(grown?.outSec).toBe(4.1);
  });

  it("stays on the 0.1s grid instead of accumulating float error", () => {
    let current = beat({ durationSec: 0.1, outSec: 0.1 });
    for (let i = 0; i < 7; i++) {
      current = stepBeatDuration(current, 10, 1) ?? current;
    }
    expect(current.durationSec).toBe(0.8);
    expect(current.outSec).toBe(0.8);
  });

  it("clamps to the clip length and reports no change at the ceiling", () => {
    const atMax = beat({ durationSec: 5, outSec: 5 });
    expect(stepBeatDuration(atMax, 5, 1)).toBeNull();
    // Last step before the ceiling lands exactly on it rather than overshooting.
    expect(stepBeatDuration(beat({ durationSec: 4.9, outSec: 4.9 }), 5, 1)?.durationSec).toBe(5);
  });

  it("treats an off-grid duration as its nearest 0.1s value", () => {
    // 4.95 rounds to 5.0, which is already the ceiling for a 5s clip.
    expect(stepBeatDuration(beat({ durationSec: 4.95, outSec: 4.95 }), 5, 1)).toBeNull();
    expect(stepBeatDuration(beat({ durationSec: 3.04, outSec: 3.04 }), 10, 1)?.durationSec).toBe(3.1);
  });

  it("clamps to the minimum and reports no change at the floor", () => {
    const atMin = beat({ durationSec: MIN_BEAT_DURATION_SEC, outSec: MIN_BEAT_DURATION_SEC });
    expect(stepBeatDuration(atMin, 10, -1)).toBeNull();
  });

  it("slides the in-point back when the beat would run past the end of the footage", () => {
    const nearEnd = beat({ inSec: 7, outSec: 10, durationSec: 3 });
    const grown = stepBeatDuration(nearEnd, 10, 1);
    expect(grown?.durationSec).toBe(3.1);
    expect(grown?.inSec).toBe(6.9);
    expect(grown?.outSec).toBe(10);
  });

  it("marks a stepped beat as custom, since it is no longer a preset length", () => {
    const stepped = stepBeatDuration(beat({ durationSec: 5, outSec: 5, durationPreset: "5" }), 10, 1);
    expect(stepped?.durationPreset).toBe("custom");
    expect(stepped?.durationSec).toBe(5.1);
  });

  it("preserves unrelated beat fields", () => {
    const stepped = stepBeatDuration(
      beat({ scriptText: "line", captionText: "line", lockDuration: true, transition: "fade" }),
      10,
      1
    );
    expect(stepped?.scriptText).toBe("line");
    expect(stepped?.lockDuration).toBe(true);
    expect(stepped?.transition).toBe("fade");
  });
});

describe("resizeBeat", () => {
  it("clamps a requested length into [min, clip length]", () => {
    expect(resizeBeat(beat(), 8, 99, "custom")?.durationSec).toBe(8);
    expect(resizeBeat(beat(), 8, -4, "custom")?.durationSec).toBe(MIN_BEAT_DURATION_SEC);
  });

  it("returns null for non-finite input rather than corrupting the beat", () => {
    expect(resizeBeat(beat(), 8, Number.NaN, "custom")).toBeNull();
    expect(resizeBeat(beat(), Number.NaN, 3, "custom")).toBeNull();
  });

  it("returns null when nothing actually changes", () => {
    expect(resizeBeat(beat({ durationSec: 3, outSec: 3 }), 10, 3, "custom")).toBeNull();
  });

  it("still reports a change when only the preset differs", () => {
    const same = resizeBeat(beat({ durationSec: 3, outSec: 3, durationPreset: "3" }), 10, 3, "custom");
    expect(same?.durationPreset).toBe("custom");
    expect(same?.durationSec).toBe(3);
  });
});
