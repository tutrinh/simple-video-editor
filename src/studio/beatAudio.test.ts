import { describe, expect, it } from "vitest";
import { beatBoundaryGain, effectiveBeatVolume, effectiveSplitScreenSlotVolume } from "./beatAudio";

describe("Beat audio boundary envelope", () => {
  it("ramps through zero over 15ms at both Beat edges", () => {
    expect(beatBoundaryGain(0, 4)).toBe(0);
    expect(beatBoundaryGain(0.0075, 4)).toBeCloseTo(0.5);
    expect(beatBoundaryGain(0.015, 4)).toBe(1);
    expect(beatBoundaryGain(2, 4)).toBe(1);
    expect(beatBoundaryGain(3.9925, 4)).toBeCloseTo(0.5);
    expect(beatBoundaryGain(4, 4)).toBe(0);
  });

  it("scales the ramps to fit very short Beats", () => {
    expect(beatBoundaryGain(0, 0.01)).toBe(0);
    expect(beatBoundaryGain(0.005, 0.01)).toBe(1);
    expect(beatBoundaryGain(0.01, 0.01)).toBe(0);
  });

  it("supports a wider browser-preview envelope", () => {
    expect(beatBoundaryGain(0.025, 4, 0.05)).toBeCloseTo(0.5);
    expect(beatBoundaryGain(3.975, 4, 0.05)).toBeCloseTo(0.5);
  });
});

describe("Beat audio master", () => {
  it("multiplies per-Beat volume by the Cut master", () => {
    expect(effectiveBeatVolume({ volume: 0.8 }, { beatAudioMasterVolume: 0.5 })).toBe(0.4);
  });

  it("supports independent Beat mute and master mute without losing volume", () => {
    expect(effectiveBeatVolume({ volume: 0.8, muted: true }, { beatAudioMasterVolume: 0.5 })).toBe(0);
    expect(effectiveBeatVolume({ volume: 0.8 }, { beatAudioMasterVolume: 0.5, beatAudioMuted: true })).toBe(0);
    expect(effectiveBeatVolume({ volume: 0.8 }, { beatAudioMasterVolume: 0.5, beatAudioMuted: false })).toBe(0.4);
  });

  it("applies the same master and mutes to split-screen Beat audio", () => {
    expect(effectiveSplitScreenSlotVolume({ volume: 0.6 }, 1, {}, { beatAudioMasterVolume: 0.5 })).toBe(0.3);
    expect(effectiveSplitScreenSlotVolume({ volume: 0.6 }, 1, { volume: 0.5 }, { beatAudioMasterVolume: 0.5 })).toBe(0.15);
    expect(effectiveSplitScreenSlotVolume({}, 0, { volume: 0.8 }, { beatAudioMuted: true })).toBe(0);
  });
});
