import { describe, expect, it } from "vitest";
import { downsampleWaveform, waveformPeakTone } from "./UserVoiceWaveform";

describe("UserVoiceWaveform", () => {
  it("keeps the strongest peak in each display bin", () => {
    expect(downsampleWaveform([0.1, 0.8, 0.2, 0.6], 2)).toEqual([0.8, 0.6]);
  });

  it("uses headroom colors at the expected thresholds", () => {
    expect(waveformPeakTone(0.5)).toBe("safe");
    expect(waveformPeakTone(0.8)).toBe("warning");
    expect(waveformPeakTone(1)).toBe("danger");
  });
});
