import { describe, expect, it } from "vitest";
import {
  analyzeUserVoiceChannels,
  analyzeUserVoiceWindow,
  estimatedUserVoicePeakDbfs,
  recommendedUserVoiceLevelDb,
  waveformPeaksForChannels,
} from "./userVoiceLevel";

describe("userVoiceLevel", () => {
  it("measures RMS and peak across decoded channels", () => {
    const result = analyzeUserVoiceChannels([
      new Float32Array([0.5, -0.5]),
      new Float32Array([0.25, -0.25]),
    ]);
    expect(result.peakDbfs).toBeCloseTo(-6.02, 1);
    expect(result.rmsDbfs).toBeCloseTo(-8.06, 1);
  });

  it("analyzes only the retained non-destructive trim window", () => {
    const result = analyzeUserVoiceWindow(
      [new Float32Array([1, 1, 0.25, -0.25])],
      2,
      1,
      1,
    );
    expect(result.peakDbfs).toBeCloseTo(-12.04, 1);
    expect(result.rmsDbfs).toBeCloseTo(-12.04, 1);
  });

  it("targets speech loudness without crossing the peak ceiling", () => {
    expect(recommendedUserVoiceLevelDb({ rmsDbfs: -26, peakDbfs: -8 })).toBe(7);
    expect(recommendedUserVoiceLevelDb({ rmsDbfs: -30, peakDbfs: -20 })).toBe(12);
    expect(recommendedUserVoiceLevelDb({ rmsDbfs: -10, peakDbfs: -1 })).toBe(-8);
  });

  it("estimates the post-level peak including the mix volume", () => {
    expect(estimatedUserVoicePeakDbfs({ rmsDbfs: -20, peakDbfs: -6 }, 4, 1)).toBe(-2);
    expect(estimatedUserVoicePeakDbfs({ rmsDbfs: -20, peakDbfs: -6 }, 4, 0.5)).toBeCloseTo(-8.02, 1);
    expect(estimatedUserVoicePeakDbfs({ rmsDbfs: -20, peakDbfs: -6 }, 0, 1.5)).toBeCloseTo(-2.48, 1);
  });

  it("extracts cached-display peak bins from decoded samples", () => {
    expect(waveformPeaksForChannels([
      new Float32Array([0.1, -0.8, 0.3, -0.6]),
    ], 2)).toEqual([expect.closeTo(0.8), expect.closeTo(0.6)]);
  });
});
