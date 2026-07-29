import { describe, expect, it } from "vitest";
import type { ProjectState } from "../state/projectReducer";
import { collectUserVoiceFiles, reinjectUserVoiceFiles, stripUserVoiceFiles, userVoiceKeys } from "./userVoicePersist";

const file = new File([new Uint8Array([1, 2, 3])], "take.webm", { type: "audio/webm" });

function stateWithRecording(): ProjectState {
  return {
    title: "Voice test",
    clips: [],
    direction: "",
    cut: {
      aspect: "16:9",
      beats: [],
      userVoiceSegments: [{
        id: "uvo-1",
        name: "Beat 1 voice",
        file,
        startTimeSec: 1,
        durationSec: 2,
        sourceDurationSec: 2.2,
        sourceStartSec: 0.15,
        volume: 0.8,
        levelDb: 2.5,
        bassDb: 3,
        trebleDb: -1,
      }],
    },
  };
}

describe("userVoicePersist", () => {
  it("collects microphone Files by stable segment id", () => {
    expect(collectUserVoiceFiles(stateWithRecording())).toEqual([{ key: "uvo-1", file }]);
    expect(userVoiceKeys(stateWithRecording())).toEqual(["uvo-1"]);
  });

  it("strips audio data from JSON metadata without mutating the source", () => {
    const state = stateWithRecording();
    const stripped = stripUserVoiceFiles(state);
    expect("file" in stripped.cut!.userVoiceSegments![0]).toBe(false);
    expect(stripped.cut!.userVoiceSegments![0].name).toBe("Beat 1 voice");
    expect(state.cut!.userVoiceSegments![0].file).toBe(file);
  });

  it("round-trips recording metadata and restores the File", () => {
    const state = stateWithRecording();
    const parsed = JSON.parse(JSON.stringify(stripUserVoiceFiles(state))) as ProjectState;
    const restored = reinjectUserVoiceFiles(parsed, new Map([["uvo-1", file]]));
    expect(restored.cut!.userVoiceSegments![0].file).toBe(file);
    expect(restored.cut!.userVoiceSegments![0].startTimeSec).toBe(1);
    expect(restored.cut!.userVoiceSegments![0]).toMatchObject({ sourceStartSec: 0.15, levelDb: 2.5, bassDb: 3, trebleDb: -1 });
  });

  it("drops metadata whose out-of-band audio is missing", () => {
    const parsed = JSON.parse(JSON.stringify(stripUserVoiceFiles(stateWithRecording()))) as ProjectState;
    expect(reinjectUserVoiceFiles(parsed, new Map()).cut!.userVoiceSegments).toEqual([]);
  });
});
