import { describe, expect, test, vi } from "vitest";
import { beatPosterBg, getBeatPosterUrl } from "./beatPosterCache";
import type { Beat, Clip } from "../domain/types";

vi.mock("./frameSampler", () => ({
  sampleFrameAt: vi.fn().mockResolvedValue({ dataUrl: "data:image/jpeg;base64,mockTrimFrame", base64: "mockTrimFrame" }),
}));

describe("beatPosterCache", () => {
  const mockClip: Clip = {
    id: "c1",
    name: "test.mov",
    file: new File([""], "test.mov", { type: "video/mp4" }),
    durationSec: 10,
    width: 1920,
    height: 1080,
    poster: "data:image/jpeg;base64,mockClipPoster",
  };

  const mockBeat: Beat = {
    id: "b1",
    clipId: "c1",
    inSec: 3.5,
    outSec: 6.5,
    durationSec: 3.0,
    scriptText: "",
    captionText: "",
  };

  test("returns undefined for missing clip or beat", () => {
    expect(getBeatPosterUrl(undefined, mockClip)).toBeUndefined();
    expect(getBeatPosterUrl(mockBeat, undefined)).toBeUndefined();
  });

  test("returns clip.poster for still clips", () => {
    const stillClip: Clip = { ...mockClip, kind: "still" };
    expect(getBeatPosterUrl(mockBeat, stillClip)).toBe("data:image/jpeg;base64,mockClipPoster");
  });

  test("returns clip.poster initially and triggers async extraction", async () => {
    const onUpdate = vi.fn();
    const initialUrl = getBeatPosterUrl(mockBeat, mockClip, onUpdate);
    expect(initialUrl).toBe("data:image/jpeg;base64,mockClipPoster");

    // Wait for microtasks
    await new Promise((r) => setTimeout(r, 10));

    expect(onUpdate).toHaveBeenCalled();
    const updatedBg = beatPosterBg(mockBeat, mockClip);
    expect(updatedBg).toContain("mockTrimFrame");
  });
});
