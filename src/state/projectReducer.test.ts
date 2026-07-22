import { describe, it, expect } from "vitest";
import { projectReducer, initialState } from "./projectReducer";
import type { Clip, Beat, Cut } from "../domain/types";

const clip = (id: string): Clip => ({
  id, file: new File([], `${id}.mp4`), name: `${id}.mp4`, durationSec: 10, width: 1920, height: 1080,
});
const beat = (id: string, clipId: string): Beat => ({
  id, clipId, inSec: 0, outSec: 3, durationSec: 3, scriptText: "", captionText: "",
});

describe("projectReducer", () => {
  it("adds and removes clips", () => {
    let s = projectReducer(initialState, { type: "ADD_CLIPS", clips: [clip("a"), clip("b")] });
    expect(s.clips.map((c) => c.id)).toEqual(["a", "b"]);
    s = projectReducer(s, { type: "REMOVE_CLIP", id: "a" });
    expect(s.clips.map((c) => c.id)).toEqual(["b"]);
  });

  it("patches a clip's description without touching others", () => {
    let s = projectReducer(initialState, { type: "ADD_CLIPS", clips: [clip("a"), clip("b")] });
    s = projectReducer(s, {
      type: "SET_DESCRIPTION",
      id: "b",
      description: { subjectAction: "x", settingMood: "y", usability: 4, model: "m", raw: "r" },
    });
    expect(s.clips.find((c) => c.id === "a")?.description).toBeUndefined();
    expect(s.clips.find((c) => c.id === "b")?.description?.usability).toBe(4);
  });

  it("toggles a clip's included flag", () => {
    let s = projectReducer(initialState, { type: "ADD_CLIPS", clips: [clip("a"), clip("b")] });
    expect(s.clips.find((c) => c.id === "a")?.included).toBeUndefined(); // undefined = included
    s = projectReducer(s, { type: "SET_INCLUDED", id: "a", included: false });
    expect(s.clips.find((c) => c.id === "a")?.included).toBe(false);
    expect(s.clips.find((c) => c.id === "b")?.included).toBeUndefined();
  });

  it("reorders beats by id, dropping unknown ids", () => {
    const cut: Cut = { beats: [beat("1", "a"), beat("2", "b"), beat("3", "c")], aspect: "16:9" };
    let s = projectReducer({ ...initialState, clips: [] }, { type: "SET_CUT", cut });
    s = projectReducer(s, { type: "REORDER_BEATS", order: ["3", "1", "zzz", "2"] });
    expect(s.cut?.beats.map((b) => b.id)).toEqual(["3", "1", "2"]);
  });

  it("adds, duplicates (as separate clip and beat instances), and removes beats on the cut", () => {
    const cut: Cut = { beats: [beat("1", "a")], aspect: "16:9" };
    let s = projectReducer({ ...initialState, clips: [clip("a")] }, { type: "SET_CUT", cut });
    s = projectReducer(s, { type: "ADD_BEAT", beat: beat("2", "b") });
    expect(s.cut?.beats.map((b) => b.id)).toEqual(["1", "2"]);
    s = projectReducer(s, { type: "DUPLICATE_BEAT", id: "1", newBeatId: "1-dup", newClipId: "a-dup" });
    expect(s.cut?.beats.map((b) => b.id)).toEqual(["1", "1-dup", "2"]);
    expect(s.cut?.beats[1].clipId).toBe("a-dup");
    expect(s.clips.map((c) => c.id)).toContain("a-dup");
    s = projectReducer(s, { type: "REMOVE_BEAT", id: "1" });
    expect(s.cut?.beats.map((b) => b.id)).toEqual(["1-dup", "2"]);
  });

  it("adds, updates, and removes overlays on the cut", () => {
    const cut: Cut = { beats: [beat("1", "a")], aspect: "16:9" };
    let s = projectReducer({ ...initialState, clips: [clip("a")] }, { type: "SET_CUT", cut });
    const ov = {
      id: "ov1",
      clipId: "a",
      startTimeSec: 1,
      durationSec: 3,
      inSec: 0,
      outSec: 3,
      blendMode: "normal" as const,
      opacity: 0.8,
      volume: 0.5,
    };
    s = projectReducer(s, { type: "ADD_OVERLAY", overlay: ov });
    expect(s.cut?.overlays).toHaveLength(1);
    expect(s.cut?.overlays?.[0].blendMode).toBe("normal");

    s = projectReducer(s, { type: "UPDATE_OVERLAY", overlay: { ...ov, blendMode: "screen", opacity: 0.9 } });
    expect(s.cut?.overlays?.[0].blendMode).toBe("screen");
    expect(s.cut?.overlays?.[0].opacity).toBe(0.9);

    s = projectReducer(s, { type: "REMOVE_OVERLAY", id: "ov1" });
    expect(s.cut?.overlays).toHaveLength(0);
  });

  it("resets to initial", () => {
    let s = projectReducer(initialState, { type: "ADD_CLIPS", clips: [clip("a")] });
    s = projectReducer(s, { type: "SET_DIRECTION", direction: "funnier" });
    s = projectReducer(s, { type: "RESET" });
    expect(s).toEqual(initialState);
  });
});

