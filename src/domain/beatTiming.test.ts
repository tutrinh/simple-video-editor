import { describe, expect, it } from "vitest";
import type { Beat } from "./types";
import { PROJECT_FPS, BEAT_SPEED_STEPS, nearestBeatSpeedIndex } from "./types";
import {
  atempoChain,
  beatGapSec,
  beatTiming,
  migrateCutSpeeds,
  migrateImplicitStretch,
  sourceOffsetAt,
  speedPlan,
  visibleWindowSec,
} from "./beatTiming";

const beat = (over: Partial<Beat> = {}): Beat => ({
  id: "b1",
  clipId: "c1",
  inSec: 0,
  outSec: 3,
  durationSec: 3,
  scriptText: "",
  captionText: "",
  ...over,
});

describe("beatTiming", () => {
  it("clamps the window to what the Clip has, and sizes the Beat from it", () => {
    // Trim asks for 3s starting at 1s, but the Clip is only 3s long.
    const timing = beatTiming(beat({ inSec: 1, outSec: 4 }), 3);
    expect(timing.windowSec).toBe(2);
    // The Beat is as long as the footage it actually has (ADR-0020).
    expect(timing.timelineSec).toBe(2);
  });

  it("trusts the trim window when the Clip length is unknown", () => {
    const timing = beatTiming(beat({ inSec: 0, outSec: 3 }), undefined);
    expect(timing.windowSec).toBe(3);
  });

  it("falls back to Speed 1 for absent, zero and negative values", () => {
    for (const speed of [undefined, 0, -2, Number.NaN]) {
      expect(beatTiming(beat({ speed }), 10).speed).toBe(1);
    }
  });
});

describe("Speed sets a Beat's duration (ADR-0020)", () => {
  it("lengthens the Beat when slowed", () => {
    // The grilling's worked example, now inverted: 2s of window at 0.5x is a 4s Beat.
    const timing = beatTiming(beat({ inSec: 0, outSec: 3, speed: 0.5 }), 2);
    expect(timing.windowSec).toBe(2);
    expect(timing.timelineSec).toBe(4);
    // The whole window is seen, so nothing is left for Fill.
    expect(visibleWindowSec(timing)).toBe(2);
    expect(beatGapSec(timing)).toBe(0);
  });

  it("shortens the Beat when sped up", () => {
    const timing = beatTiming(beat({ inSec: 0, outSec: 4, speed: 2 }), 10);
    expect(timing.windowSec).toBe(4);
    expect(timing.timelineSec).toBe(2);
    expect(beatGapSec(timing)).toBe(0);
  });

  it("makes Fill unreachable — a Beat can no longer outlast its footage", () => {
    // Even with the trim asking well past the end of the Clip.
    for (const speed of BEAT_SPEED_STEPS) {
      const timing = beatTiming(beat({ inSec: 0, outSec: 20, speed }), 3);
      expect(Math.abs(beatGapSec(timing))).toBeLessThan(1 / PROJECT_FPS);
    }
  });

  it("snaps a duration that would otherwise land mid-frame", () => {
    // 2.01s of window at 1x is 60.3 frames — not a whole frame at 30fps.
    const timing = beatTiming(beat({ inSec: 0, outSec: 2.01 }), 10);
    expect(timing.timelineSec).toBe(2);
    expect(timing.timelineSec).not.toBe(2.01);
  });

  it("snaps a slowed duration that would otherwise land mid-frame", () => {
    // 1.11s at 0.5x is 2.22s = 66.6 frames, which rounds to 67.
    const timing = beatTiming(beat({ inSec: 0, outSec: 1.11, speed: 0.5 }), 10);
    expect(timing.timelineSec).toBe(67 / PROJECT_FPS);
    expect(timing.timelineSec).not.toBeCloseTo(2.22, 6);
  });

  it("puts every offered Speed on a whole frame for an awkward window", () => {
    for (const speed of BEAT_SPEED_STEPS) {
      const timing = beatTiming(beat({ inSec: 0, outSec: 2.37 }), 10);
      const frames = beatTiming(beat({ inSec: 0, outSec: 2.37, speed }), 10).timelineSec * PROJECT_FPS;
      expect(Math.abs(frames - Math.round(frames))).toBeLessThan(1e-9);
      expect(timing.timelineSec).toBeGreaterThan(0);
    }
  });

});

describe("fast motion (Speeds above 1)", () => {
  it("compresses presentation stamps rather than stretching them", () => {
    expect(speedPlan(beatTiming(beat({ speed: 2 }), 10)).ptsFactor).toBe(0.5);
    expect(speedPlan(beatTiming(beat({ speed: 1.5 }), 10)).ptsFactor).toBeCloseTo(0.6667, 4);
  });

  it("plays the whole window inside the shorter Beat", () => {
    const timing = beatTiming(beat({ inSec: 0, outSec: 4, speed: 2 }), 10);
    expect(sourceOffsetAt(timing, 1).offsetSec).toBe(2);
    // The Beat ends exactly as the window runs out.
    expect(sourceOffsetAt(timing, timing.timelineSec)).toEqual({ offsetSec: 4, holding: true });
  });

  it("keeps every offered Speed's audio inside atempo's range", () => {
    for (const step of BEAT_SPEED_STEPS) {
      const factors = atempoChain(step);
      for (const factor of factors) {
        expect(factor).toBeGreaterThanOrEqual(0.5);
        expect(factor).toBeLessThanOrEqual(2);
      }
      expect(factors.reduce((a, b) => a * b, 1)).toBeCloseTo(step, 6);
    }
  });
});

describe("the offered Speed steps", () => {
  it("offers exactly the requested ratios, slowest first", () => {
    expect([...BEAT_SPEED_STEPS]).toEqual([0.5, 0.75, 1, 1.5, 2]);
  });

  it("snaps an arbitrary Speed to the nearest offered step", () => {
    expect(nearestBeatSpeedIndex(1)).toBe(2);
    expect(nearestBeatSpeedIndex(0.5)).toBe(0);
    expect(nearestBeatSpeedIndex(2)).toBe(4);
    // A migrated Beat can carry any ratio; the slider still has to show something.
    expect(BEAT_SPEED_STEPS[nearestBeatSpeedIndex(0.62)]).toBe(0.5);
    expect(BEAT_SPEED_STEPS[nearestBeatSpeedIndex(0.7)]).toBe(0.75);
    expect(BEAT_SPEED_STEPS[nearestBeatSpeedIndex(0.2)]).toBe(0.5);
    expect(BEAT_SPEED_STEPS[nearestBeatSpeedIndex(99)]).toBe(2);
  });

  it("does not clamp the stored Speed — the steps are a UI range only", () => {
    // A migration can produce 0.31x; the model must still honour it exactly.
    expect(beatTiming(beat({ speed: 0.31 }), 10).speed).toBe(0.31);
  });
});

describe("sourceOffsetAt", () => {
  it("consumes source at the Speed and never past the window", () => {
    const timing = beatTiming(beat({ inSec: 0, outSec: 4, speed: 0.5 }), 4);
    expect(sourceOffsetAt(timing, 0).offsetSec).toBe(0);
    expect(sourceOffsetAt(timing, 2).offsetSec).toBe(1);
    expect(sourceOffsetAt(timing, 4).offsetSec).toBe(2);
  });

  it("holds the last frame once the footage is spent", () => {
    const timing = beatTiming(beat({ inSec: 0, outSec: 4, fill: "hold" }), 3);
    expect(sourceOffsetAt(timing, 2.9)).toEqual({ offsetSec: 2.9, holding: false });
    expect(sourceOffsetAt(timing, 3.5)).toEqual({ offsetSec: 3, holding: true });
    expect(sourceOffsetAt(timing, 99)).toEqual({ offsetSec: 3, holding: true });
  });

  it("wraps the window when Fill loops, and never reports holding", () => {
    const timing = beatTiming(beat({ inSec: 0, outSec: 8, fill: "loop" }), 3);
    expect(sourceOffsetAt(timing, 3.5)).toEqual({ offsetSec: 0.5, holding: false });
    expect(sourceOffsetAt(timing, 6.25)).toEqual({ offsetSec: 0.25, holding: false });
  });

  it("degrades safely on a zero-length window", () => {
    const timing = beatTiming(beat({ inSec: 2, outSec: 2 }), 10);
    expect(sourceOffsetAt(timing, 1)).toEqual({ offsetSec: 0, holding: true });
  });
});

describe("speedPlan", () => {
  it("does nothing to an untouched Beat, so its filter graph is unchanged", () => {
    const plan = speedPlan(beatTiming(beat(), 3));
    expect(plan).toEqual({ ptsFactor: 1, retimed: false, holdSec: 0, loops: false });
  });

  it("stretches presentation stamps by the inverse of Speed", () => {
    expect(speedPlan(beatTiming(beat({ speed: 0.5 }), 3)).ptsFactor).toBe(2);
    expect(speedPlan(beatTiming(beat({ speed: 0.25 }), 3)).ptsFactor).toBe(4);
  });

  it("emits no Fill work, because a Beat is now sized to its footage", () => {
    // Under ADR-0019 this Beat had a 1s shortfall; under ADR-0020 it is simply 3s.
    const hold = speedPlan(beatTiming(beat({ inSec: 0, outSec: 4, fill: "hold" }), 3));
    expect(hold.holdSec).toBe(0);
    expect(hold.loops).toBe(false);

    const loop = speedPlan(beatTiming(beat({ inSec: 0, outSec: 4, fill: "loop" }), 3));
    expect(loop.holdSec).toBe(0);
    expect(loop.loops).toBe(false);
  });

  it("still honours Fill if a gap is ever constructed directly", () => {
    // The code path is retained as a guard even though beatTiming cannot
    // produce a gap — a hand-built timing must still behave.
    expect(speedPlan({ timelineSec: 4, windowSec: 3, speed: 1, fill: "hold" }).holdSec).toBe(1);
    expect(speedPlan({ timelineSec: 4, windowSec: 3, speed: 1, fill: "loop" }).loops).toBe(true);
  });
});

describe("60fps sources slow smoothly to the project frame rate", () => {
  // The requirement: slowing a 60fps clip at a 30fps timeline must use the
  // source's own extra frames rather than duplicating 30fps ones. That holds iff
  // `setpts` runs before frame-rate conformance, so the unique-frame count the
  // slowdown makes available is what matters here.
  const uniqueSourceFramesPerOutputFrame = (sourceFps: number, speed: number) => {
    const timing = beatTiming(beat({ inSec: 0, outSec: 2, speed }), 2);
    const outputFrames = timing.timelineSec * PROJECT_FPS;
    const sourceFramesShown = visibleWindowSec(timing) * sourceFps;
    return sourceFramesShown / outputFrames;
  };

  it("gives a distinct source frame for every output frame at 0.5x", () => {
    expect(uniqueSourceFramesPerOutputFrame(60, 0.5)).toBe(1);
  });

  it("still has frames to spare at 0.5x from 120fps", () => {
    expect(uniqueSourceFramesPerOutputFrame(120, 0.5)).toBe(2);
  });

  it("must duplicate frames when a 30fps source is slowed, which is unavoidable", () => {
    expect(uniqueSourceFramesPerOutputFrame(30, 0.5)).toBe(0.5);
  });

  it("reaches the 0.25x floor cleanly from 120fps", () => {
    expect(uniqueSourceFramesPerOutputFrame(120, 0.25)).toBe(1);
  });
});

describe("atempoChain", () => {
  it("leaves untouched audio alone", () => {
    expect(atempoChain(1)).toEqual([]);
    expect(atempoChain(0)).toEqual([]);
  });

  it("uses one instance where atempo can do it alone", () => {
    expect(atempoChain(0.5)).toEqual([0.5]);
  });

  it("chains below the 0.5 floor and multiplies back to the Speed", () => {
    const factors = atempoChain(0.25);
    expect(factors).toEqual([0.5, 0.5]);
    expect(factors.reduce((a, b) => a * b, 1)).toBeCloseTo(0.25, 6);
  });

  it("keeps every factor inside atempo's accepted range", () => {
    for (const speed of [0.25, 0.3, 0.4, 0.5, 0.75, 0.9]) {
      const factors = atempoChain(speed);
      for (const factor of factors) {
        expect(factor).toBeGreaterThanOrEqual(0.5);
        expect(factor).toBeLessThanOrEqual(2);
      }
      expect(factors.reduce((a, b) => a * b, 1)).toBeCloseTo(speed, 6);
    }
  });
});

describe("migrating the old implicit stretch", () => {
  it("reproduces the slow branch exactly", () => {
    // Old: speedRatio = 4/2 = 2, emitted setpts=2*PTS.
    const migrated = migrateImplicitStretch(beat({ inSec: 0, outSec: 4 }), 2);
    expect(migrated.speed).toBe(0.5);
    expect(migrated.fill).toBe("hold");
    expect(speedPlan(beatTiming(migrated, 2)).ptsFactor).toBe(2);
    // The stretch exactly fills the Beat, so nothing is left to pad.
    expect(speedPlan(beatTiming(migrated, 2)).holdSec).toBeCloseTo(0, 6);
  });

  it("preserves the Beat's length past the old 2.5x ceiling, slowing instead of looping", () => {
    // The old export looped here; looping cannot survive ADR-0020, so length is
    // what is preserved and the picture slows instead.
    const migrated = migrateImplicitStretch(beat({ inSec: 0, outSec: 9 }), 3);
    expect(migrated.speed).toBeCloseTo(1 / 3, 6);
    expect(beatTiming(migrated, 3).timelineSec).toBe(9);
  });

  it("preserves the Beat's length on every shortfall it can encounter", () => {
    for (const [requested, clipSec] of [[4, 2], [9, 3], [3.5, 3], [12, 1]] as const) {
      const migrated = migrateImplicitStretch(beat({ inSec: 0, outSec: requested }), clipSec);
      expect(beatTiming(migrated, clipSec).timelineSec).toBeCloseTo(requested, 5);
    }
  });

  it("leaves a Beat whose footage already fits untouched", () => {
    const original = beat({ inSec: 0, outSec: 3 });
    expect(migrateImplicitStretch(original, 5)).toBe(original);
  });

  it("is idempotent — an authored Beat is never rewritten", () => {
    const authored = beat({ inSec: 0, outSec: 4, speed: 0.8 });
    expect(migrateImplicitStretch(authored, 2)).toBe(authored);
    const filled = beat({ inSec: 0, outSec: 4, fill: "loop" });
    expect(migrateImplicitStretch(filled, 2)).toBe(filled);
  });

  it("migrates a Cut against each Beat's own Clip and keeps identity when unchanged", () => {
    const cut = { beats: [beat({ id: "a", clipId: "c1", inSec: 0, outSec: 4 })] };
    const migrated = migrateCutSpeeds(cut, [{ id: "c1", durationSec: 2 }]);
    expect(migrated.beats[0].speed).toBe(0.5);

    const fits = { beats: [beat({ id: "a", clipId: "c1", inSec: 0, outSec: 2 })] };
    expect(migrateCutSpeeds(fits, [{ id: "c1", durationSec: 10 }])).toBe(fits);
  });

  it("handles a Project with no Cut", () => {
    expect(migrateCutSpeeds(undefined, [])).toBeUndefined();
  });
});
