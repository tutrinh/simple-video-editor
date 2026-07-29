import { describe, expect, it } from "vitest";
import { effectiveBeatVolume, effectiveSplitScreenSlotVolume } from "./beatAudio";

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
