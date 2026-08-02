import { describe, expect, it } from "vitest";
import { deliveryMetrics, timeTranscript, userVoiceCaptionWindows } from "./userVoiceTranscript";

describe("User VO transcript captions", () => {
  it("assigns continuous word timing across a recording", () => {
    const words = timeTranscript("one longer three", 6);
    expect(words).toHaveLength(3);
    expect(words[0].startSec).toBe(0);
    expect(words.at(-1)?.endSec).toBe(6);
  });
  it("creates readable caption groups", () => {
    const transcript = "one two three four five six";
    const windows = userVoiceCaptionWindows([{ id: "v", name: "Take", file: new File(["v"], "v.webm"), startTimeSec: 2, durationSec: 4, sourceDurationSec: 4, volume: 1, captionVisible: true, transcript, transcriptWords: timeTranscript(transcript, 4) }], 0, 8);
    expect(windows.map((window) => window.text)).toEqual(["one two three four five", "six"]);
    expect(windows[0].startSec).toBe(2);
  });
  it("measures pace and filler words", () => {
    expect(deliveryMetrics("Um this is actually my story", 3)).toEqual({ wordCount: 6, wordsPerMinute: 120, fillerCount: 2, fillerWords: ["um", "actually"] });
  });
});
