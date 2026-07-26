import { describe, it, expect } from "vitest";
import { projectReducer, type ProjectState } from "../state/projectReducer";
import { getTagStyle, PRESET_TAGS } from "../lib/tagPresets";

describe("Clip Tagging System", () => {
  it("dispatches SET_CLIP_TAGS and updates clip tags", () => {
    const initialState: ProjectState = {
      title: "Test",
      clips: [
        { id: "c1", file: new File([], "c1.mp4"), name: "c1.mp4", durationSec: 10, width: 1920, height: 1080 },
      ],
      direction: "",
    };

    const nextState = projectReducer(initialState, {
      type: "SET_CLIP_TAGS",
      id: "c1",
      tags: ["A-Roll", "Interview"],
    });

    expect(nextState.clips[0].tags).toEqual(["A-Roll", "Interview"]);
  });

  it("provides distinct tag colors for presets and fallback for custom tags", () => {
    const aRollStyle = getTagStyle("A-Roll");
    expect(aRollStyle.text).toBe("#57c98a");

    const customStyle = getTagStyle("MyCustomTag");
    expect(customStyle.bg).toBe("var(--panel-3)");
  });

  it("contains standard preset tag definitions", () => {
    const ids = PRESET_TAGS.map((p) => p.id);
    expect(ids).toContain("a-roll");
    expect(ids).toContain("b-roll");
    expect(ids).toContain("interview");
    expect(ids).toContain("action");
  });
});
