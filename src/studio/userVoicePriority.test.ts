import { describe, expect, it } from "vitest";
import {
  CAPTION_VO_DUCK_GAIN,
  captionVoiceDuckingFilterChain,
  captionVoiceGainAtTime,
  captionVoiceOverlapWindows,
} from "./userVoicePriority";

const userVoice = [
  { startTimeSec: 2, durationSec: 3 },
  { startTimeSec: 8, durationSec: 1 },
];

describe("User VO narration priority", () => {
  it("ducks generated caption VO only while User VO is active", () => {
    expect(captionVoiceGainAtTime(userVoice, 1.9)).toBe(1);
    expect(captionVoiceGainAtTime(userVoice, 2)).toBe(CAPTION_VO_DUCK_GAIN);
    expect(captionVoiceGainAtTime(userVoice, 4.99)).toBe(CAPTION_VO_DUCK_GAIN);
    expect(captionVoiceGainAtTime(userVoice, 5)).toBe(1);
  });

  it("converts absolute User VO overlaps into a generated segment's local clock", () => {
    expect(captionVoiceOverlapWindows(1, 5, userVoice)).toEqual([
      { startSec: 1, endSec: 4 },
    ]);
    expect(captionVoiceOverlapWindows(7.5, 2, userVoice)).toEqual([
      { startSec: 0.5, endSec: 1.5 },
    ]);
  });

  it("builds an export filter that ducks only the overlapping local window", () => {
    expect(captionVoiceDuckingFilterChain(0.8, 1, 5, userVoice)).toBe(
      "volume=0.8000,volume=0.15:enable='between(t,1.000,4.000)'",
    );
  });
});
