import { describe, it, expect } from "vitest";
import { assembleCut, cutDuration } from "./assemble";
import type { Clip, Story } from "../../domain/types";

const clip = (id: string, durationSec: number): Clip => ({
  id, file: new File([], `${id}.mp4`), name: `${id}.mp4`, durationSec, width: 1920, height: 1080,
});

describe("assembleCut", () => {
  it("centers a script-length window inside the clip", () => {
    const clips = [clip("a", 10)];
    const story: Story = { logline: "x", beats: [{ clipId: "a", scriptText: "one two three four five" }] };
    // 5 words / 2.5 = 2s window, centered in a 10s clip → in 4, out 6
    const cut = assembleCut(clips, story);
    expect(cut.beats[0]).toMatchObject({ clipId: "a", durationSec: 2, inSec: 4, outSec: 6, captionText: "one two three four five" });
  });

  it("clamps the window to a clip shorter than the script duration", () => {
    const clips = [clip("a", 1)]; // 1s clip
    const story: Story = { logline: "x", beats: [{ clipId: "a", scriptText: "one two three four five six seven eight" }] };
    const cut = assembleCut(clips, story); // target 3.2s > 1s → use whole clip
    expect(cut.beats[0]).toMatchObject({ durationSec: 1, inSec: 0, outSec: 1 });
  });

  it("skips beats whose clip is missing and sums duration", () => {
    const clips = [clip("a", 10)];
    const story: Story = { logline: "x", beats: [{ clipId: "a", scriptText: "hi there" }, { clipId: "gone", scriptText: "nope" }] };
    const cut = assembleCut(clips, story);
    expect(cut.beats).toHaveLength(1);
    expect(cutDuration(cut)).toBe(cut.beats[0].durationSec);
  });
});
