import { describe, expect, it } from "vitest";
import { importedUserVoiceName, isSupportedUserVoiceFile, makeImportedUserVoiceSegment } from "./importUserVoice";

describe("importUserVoice", () => {
  it("accepts browser audio MIME types and common audio extensions", () => {
    expect(isSupportedUserVoiceFile(new File([], "take.bin", { type: "audio/mpeg" }))).toBe(true);
    expect(isSupportedUserVoiceFile(new File([], "take.M4A"))).toBe(true);
    expect(isSupportedUserVoiceFile(new File([], "notes.txt", { type: "text/plain" }))).toBe(false);
  });

  it("uses the file name as an editable recording label", () => {
    expect(importedUserVoiceName("final-voice.take.wav")).toBe("final-voice.take");
  });

  it("places the file at the selected Beat and tail-trims it to the Cut", () => {
    const file = new File([], "narration.mp3", { type: "audio/mpeg" });
    const segment = makeImportedUserVoiceSegment(file, 8, 7, 10, "uvo-import");
    expect(segment).toMatchObject({
      id: "uvo-import",
      name: "narration",
      file,
      startTimeSec: 7,
      durationSec: 3,
      sourceDurationSec: 8,
      sourceStartSec: 0,
      volume: 1,
      levelDb: 0,
      bassDb: 0,
      trebleDb: 0,
    });
  });
});
