import { describe, it, expect } from "vitest";
import { assembleCut, cutDuration, computeWindow, makeBeat } from "./assemble";
import { EDITOR_DEFAULTS } from "../../config/editorDefaults";
import type { Clip, Story } from "../../domain/types";

const clip = (id: string, durationSec: number): Clip => ({
  id, file: new File([], `${id}.mp4`), name: `${id}.mp4`, durationSec, width: 1920, height: 1080,
});

const still = (id: string, durationSec = EDITOR_DEFAULTS.STILL_CLIP_DURATION_SEC): Clip => ({
  id, file: new File([], `${id}.jpg`), name: `${id}.jpg`, durationSec, width: 4000, height: 3000, kind: "still",
});

describe("assembleCut", () => {
  it("centers a script-length window inside the clip", () => {
    const clips = [clip("a", 10)];
    const story: Story = { logline: "x", beats: [{ clipId: "a", scriptText: "one two three four five" }] };
    // 5 words / 2.5 = 2s window, centered in a 10s clip → in 4, out 6
    const cut = assembleCut(clips, story);
    expect(cut.beats[0]).toMatchObject({ clipId: "a", durationSec: 2, inSec: 4, outSec: 6, captionText: "" });
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

const STILL = EDITOR_DEFAULTS.STILL_CLIP_DURATION_SEC;

describe("computeWindow — Stills (ADR-0012)", () => {
  it("gives a Still its whole source window, whatever the script says", () => {
    // The three cases that would each land differently under script pacing:
    // no script (default 5s), a short script, and one long enough to exceed 10s.
    const long = Array(60).fill("word").join(" "); // 60 / 2.5 = 24s target
    for (const script of ["", "two words", long]) {
      expect(computeWindow(STILL, script, EDITOR_DEFAULTS.DEFAULT_BEAT_DURATION_SEC, "still"))
        .toEqual({ inSec: 0, outSec: STILL, durationSec: STILL });
    }
  });

  it("starts a Still at 0 rather than centering it", () => {
    expect(computeWindow(STILL, "", undefined, "still").inSec).toBe(0);
  });

  it("falls back to the synthetic duration if the Still somehow has none", () => {
    expect(computeWindow(0, "", undefined, "still"))
      .toEqual({ inSec: 0, outSec: STILL, durationSec: STILL });
  });

  it("leaves video behaviour untouched", () => {
    // Same three inputs as the Still case, asserted against ADR-0004 pacing.
    expect(computeWindow(10, "one two three four five")).toEqual({ inSec: 4, outSec: 6, durationSec: 2 });
    expect(computeWindow(10, "")).toEqual({ inSec: 2.5, outSec: 7.5, durationSec: 5 });
    expect(computeWindow(1, "one two three four five six seven eight")).toEqual({ inSec: 0, outSec: 1, durationSec: 1 });
    // An explicit "video" kind is the same as an absent one.
    expect(computeWindow(10, "one two three four five", undefined, "video"))
      .toEqual(computeWindow(10, "one two three four five"));
  });
});

describe("makeBeat", () => {
  it("makes a 10s Beat from a Still", () => {
    const b = makeBeat(still("s"), "");
    expect(b).toMatchObject({ clipId: "s", inSec: 0, outSec: STILL, durationSec: STILL });
  });

  it("still paces a video Beat by its script", () => {
    expect(makeBeat(clip("a", 10), "one two three four five")).toMatchObject({ durationSec: 2, inSec: 4, outSec: 6 });
  });

  it("assembles a Story mixing a Still and footage", () => {
    const story: Story = {
      logline: "x",
      beats: [{ clipId: "s", scriptText: "one two three four five" }, { clipId: "a", scriptText: "one two three four five" }],
    };
    const cut = assembleCut([still("s"), clip("a", 10)], story);
    expect(cut.beats[0].durationSec).toBe(STILL);
    expect(cut.beats[1].durationSec).toBe(2);
    expect(cutDuration(cut)).toBe(STILL + 2);
  });
});
