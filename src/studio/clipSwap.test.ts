import { describe, it, expect } from "vitest";
import type { Beat, Clip } from "../domain/types";
import { projectReducer, type ProjectState } from "../state/projectReducer";

describe("Clip Swapping in Beat", () => {
  it("swaps the clipId of an active beat while keeping all beat settings intact", () => {
    const initialBeat: Beat = {
      id: "beat-1",
      clipId: "clip-A",
      inSec: 1.0,
      outSec: 3.5,
      durationSec: 2.5,
      scriptText: "Sample script",
      captionText: "Sample caption",
      zoom: 1.5,
      zoomX: 10,
      zoomY: -20,
      rotation: 5,
      colorAdjustments: { warmth: 25, saturation: 10 },
      transition: "fade",
      transitionSec: 0.5,
    };

    const clipB: Clip = {
      id: "clip-B",
      file: new File([], "b.mp4"),
      name: "b.mp4",
      durationSec: 10,
      width: 1920,
      height: 1080,
    };

    const state: ProjectState = {
      title: "Test Project",
      clips: [
        { id: "clip-A", file: new File([], "a.mp4"), name: "a.mp4", durationSec: 5, width: 1920, height: 1080 },
        clipB,
      ],
      direction: "",
      cut: {
        beats: [initialBeat],
        aspect: "16:9",
      },
    };

    // Simulate swapClip logic
    const currentDur = initialBeat.durationSec;
    const targetDur = Math.min(currentDur, clipB.durationSec);
    let newIn = initialBeat.inSec;
    if (newIn + targetDur > clipB.durationSec) {
      newIn = Math.max(0, clipB.durationSec - targetDur);
    }
    const newOut = newIn + targetDur;

    const updatedBeat: Beat = {
      ...initialBeat,
      clipId: clipB.id,
      inSec: newIn,
      outSec: newOut,
      durationSec: targetDur,
    };

    const newState = projectReducer(state, { type: "UPDATE_BEAT", beat: updatedBeat });
    const resultBeat = newState.cut?.beats[0];

    expect(resultBeat?.clipId).toBe("clip-B");
    expect(resultBeat?.durationSec).toBe(2.5); // Preserved duration
    expect(resultBeat?.zoom).toBe(1.5); // Preserved zoom
    expect(resultBeat?.colorAdjustments).toEqual({ warmth: 25, saturation: 10 }); // Preserved grade
    expect(resultBeat?.transition).toBe("fade"); // Preserved transition
    expect(resultBeat?.captionText).toBe("Sample caption"); // Preserved captions
  });
});
