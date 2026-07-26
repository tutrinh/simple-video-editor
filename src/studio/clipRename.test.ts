import { describe, it, expect } from "vitest";
import { projectReducer, type ProjectState } from "../state/projectReducer";

describe("Clip Renaming System", () => {
  it("dispatches RENAME_CLIP and updates clip title name", () => {
    const initialState: ProjectState = {
      title: "Test",
      clips: [
        { id: "c1", file: new File([], "IMG_7212.MOV"), name: "IMG_7212.MOV", durationSec: 10, width: 1920, height: 1080 },
      ],
      direction: "",
    };

    const nextState = projectReducer(initialState, {
      type: "RENAME_CLIP",
      id: "c1",
      name: "Monkey Mural Close-up",
    });

    expect(nextState.clips[0].name).toBe("Monkey Mural Close-up");
  });
});
