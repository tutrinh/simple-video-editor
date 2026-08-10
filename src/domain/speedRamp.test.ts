import { describe, expect, it } from "vitest";
import { beatTiming, sourceOffsetAt, speedAtElapsed } from "./beatTiming";
import type { Beat, SpeedRamp } from "./types";
import {
  averageRampSpeed,
  integratedRampSpeed,
  normalizeSpeedRamp,
  rampDurationSec,
  SPEED_RAMP_DEFAULT,
  SPEED_RAMP_PRESETS,
  speedAtRampProgress,
  speedRampEase,
  integratedSpeedRampEase,
  speedRampSetpts,
  speedRampSlices,
} from "./speedRamp";

const beat = (over: Partial<Beat> = {}): Beat => ({
  id: "b1", clipId: "c1", inSec: 0, outSec: 6, durationSec: 6,
  scriptText: "", captionText: "", ...over,
});

describe("speed ramp", () => {
  it("normalizes safe speeds and ordered transition points", () => {
    expect(normalizeSpeedRamp({ enabled: false })).toBeNull();
    expect(normalizeSpeedRamp({ startSpeed: 0, middleSpeed: 9, firstPoint: 0.9, secondPoint: 0.2 })).toMatchObject({
      startSpeed: 0.25,
      middleSpeed: 4,
      firstPoint: 0.8,
      secondPoint: 0.9,
    });
    expect(normalizeSpeedRamp({ curve: "custom", curveOut: 9 })?.curveOut).toBe(2);
  });

  it("offers the three first-version presets", () => {
    expect(SPEED_RAMP_PRESETS.map((preset) => preset.value)).toEqual(["montage", "impact", "slow-reveal"]);
  });

  it("moves smoothly through start, middle, and end speeds", () => {
    const ramp = { ...SPEED_RAMP_DEFAULT, startSpeed: 1, middleSpeed: 3, endSpeed: 0.5, firstPoint: 0.25, secondPoint: 0.75 };
    expect(speedAtRampProgress(ramp, 0)).toBe(1);
    expect(speedAtRampProgress(ramp, 0.125)).toBe(2);
    expect(speedAtRampProgress(ramp, 0.5)).toBe(3);
    expect(speedAtRampProgress(ramp, 1)).toBe(0.5);
  });

  it("supports linear, eased, smooth, and custom curve shapes", () => {
    const base = { ...SPEED_RAMP_DEFAULT, curveStrength: 1 };
    expect(speedRampEase({ ...base, curve: "linear" }, 0.5)).toBe(0.5);
    expect(speedRampEase({ ...base, curve: "ease-in" }, 0.5)).toBe(0.125);
    expect(speedRampEase({ ...base, curve: "ease-out" }, 0.5)).toBe(0.875);
    expect(speedRampEase({ ...base, curve: "smooth" }, 0.5)).toBe(0.5);
    expect(speedRampEase({ ...base, curve: "custom", curveIn: 0, curveOut: 0 }, 0.5)).toBeCloseTo(0.125, 5);
  });

  it("allows a custom Bézier to stay flat until a genuinely sharp shoulder", () => {
    const sharp = {
      ...SPEED_RAMP_DEFAULT,
      curve: "custom" as const,
      curveIn: 0,
      curveOut: 0,
      // True Bézier X controls: both pulled toward the transition end.
      curveInX: 0.85,
      curveOutX: 0.98,
    } as Required<SpeedRamp> & { curveInX: number; curveOutX: number };
    expect(speedRampEase(sharp, 0.9)).toBeLessThan(0.25);
    expect(speedRampEase(sharp, 1)).toBe(1);
  });

  it("can tighten a custom shoulder beyond the cubic Bézier limit", () => {
    const snap = {
      ...SPEED_RAMP_DEFAULT,
      curve: "custom" as const,
      curveIn: 0,
      curveOut: 0,
      curveInX: 0.9,
      curveOutX: 0.99,
      curveSharpness: 1,
    } as Required<SpeedRamp> & { curveSharpness: number };
    expect(speedRampEase(snap, 0.9)).toBeLessThan(0.01);
    expect(speedRampEase(snap, 1)).toBe(1);
  });

  it("allows a custom curve to overshoot its target and settle", () => {
    const overshoot = normalizeSpeedRamp({
      curve: "custom",
      curveIn: 0.2,
      curveOut: 1.45,
      curveInX: 0.25,
      curveOutX: 0.75,
    })!;
    const peak = Math.max(...Array.from({ length: 101 }, (_, index) => speedRampEase(overshoot, index / 100)));
    expect(overshoot.curveOut).toBe(1.45);
    expect(peak).toBeGreaterThan(1.05);
    expect(speedRampEase(overshoot, 1)).toBe(1);
  });

  it("changes speed instantly on the authored boundary frames", () => {
    const instant = normalizeSpeedRamp({
      curve: "instant",
      startSpeed: 1,
      middleSpeed: 0.5,
      endSpeed: 2,
      firstPoint: 0.25,
      secondPoint: 0.75,
    })!;
    expect(speedAtRampProgress(instant, 0.249999)).toBe(1);
    expect(speedAtRampProgress(instant, 0.25)).toBe(0.5);
    expect(speedAtRampProgress(instant, 0.749999)).toBe(0.5);
    expect(speedAtRampProgress(instant, 0.75)).toBe(2);
    expect(integratedRampSpeed(instant, 1)).toBe(1);
  });

  it("creates export slice edges exactly at instant speed boundaries", () => {
    const instant = normalizeSpeedRamp({ curve: "instant", firstPoint: 0.23, secondPoint: 0.71 })!;
    const slices = speedRampSlices(6, instant, 12);
    const duration = rampDurationSec(6, instant);
    expect(slices.some((slice) => Math.abs(slice.timelineEndSec - duration * 0.23) < 1e-9)).toBe(true);
    expect(slices.some((slice) => Math.abs(slice.timelineEndSec - duration * 0.71) < 1e-9)).toBe(true);
  });

  it("integrates overshoot using the same safe speed limits as playback", () => {
    const overshoot = normalizeSpeedRamp({
      startSpeed: 4,
      middleSpeed: 0.5,
      endSpeed: 4,
      curve: "custom",
      curveOut: 1.6,
    })!;
    const steps = 20_000;
    let numerical = 0;
    for (let i = 0; i < steps; i++) numerical += speedAtRampProgress(overshoot, (i + 0.5) / steps) / steps;
    expect(integratedRampSpeed(overshoot, 1)).toBeCloseTo(numerical, 2);
  });

  it("integrates eased curves consistently with numerical sampling", () => {
    const ramp = { ...SPEED_RAMP_DEFAULT, curve: "custom" as const, curveIn: 0.1, curveOut: 0.9 };
    const steps = 10_000;
    let numerical = 0;
    for (let i = 0; i < steps; i++) {
      numerical += speedRampEase(ramp, (i + 0.5) / steps) / steps;
    }
    expect(integratedSpeedRampEase(ramp, 1)).toBeCloseTo(numerical, 5);
  });

  it("keeps snap-sharp duration integration aligned with its sampled curve", () => {
    const ramp = {
      ...SPEED_RAMP_DEFAULT,
      curve: "custom" as const,
      curveIn: 0,
      curveOut: 0,
      curveInX: 0.9,
      curveOutX: 0.99,
      curveSharpness: 1,
    };
    const steps = 50_000;
    let numerical = 0;
    for (let i = 0; i < steps; i++) numerical += speedRampEase(ramp, (i + 0.5) / steps) / steps;
    expect(integratedSpeedRampEase(ramp, 1)).toBeCloseTo(numerical, 3);
  });

  it("integrates the curve to derive Beat duration and source position", () => {
    const ramp = { ...SPEED_RAMP_DEFAULT, startSpeed: 1, middleSpeed: 2, endSpeed: 1, firstPoint: 0.25, secondPoint: 0.75 };
    expect(averageRampSpeed(ramp)).toBe(1.75);
    expect(integratedRampSpeed(ramp, 1)).toBe(1.75);
    const timing = beatTiming(beat({ speedRamp: ramp }), 10);
    expect(timing.timelineSec).toBeCloseTo(3.433, 3);
    expect(sourceOffsetAt(timing, timing.timelineSec).offsetSec).toBe(6);
    expect(speedAtElapsed(timing, 0)).toBeCloseTo(1, 2);
    expect(speedAtElapsed(timing, timing.timelineSec / 2)).toBeCloseTo(2, 2);
  });

  it("lands exactly on the out-point after frame-snapping a slow ramp", () => {
    const slowReveal = SPEED_RAMP_PRESETS.find((preset) => preset.value === "slow-reveal")!.ramp;
    const timing = beatTiming(beat({ speedRamp: slowReveal }), 10);
    expect(sourceOffsetAt(timing, timing.timelineSec).offsetSec).toBeCloseTo(timing.windowSec, 10);
  });

  it("builds contiguous export slices that consume the whole trim", () => {
    const slices = speedRampSlices(6, SPEED_RAMP_DEFAULT, 12);
    expect(slices).toHaveLength(12);
    expect(slices[0].sourceStartSec).toBe(0);
    expect(slices.at(-1)?.sourceEndSec).toBe(6);
    expect(slices.at(-1)?.timelineEndSec).toBeCloseTo(beatTiming(beat({ speedRamp: SPEED_RAMP_DEFAULT }), 10).timelineSec, 6);
    for (let i = 1; i < slices.length; i++) {
      expect(slices[i].sourceStartSec).toBeCloseTo(slices[i - 1].sourceEndSec, 6);
      expect(slices[i].timelineStartSec).toBeCloseTo(slices[i - 1].timelineEndSec, 6);
    }
  });

  it("emits a cumulative piecewise setpts expression", () => {
    const filter = speedRampSetpts(SPEED_RAMP_DEFAULT, 6);
    expect(filter).toContain("setpts='(");
    expect(filter).toContain("if(lt(T,");
    expect(filter).toContain(")/TB'");
  });
});
