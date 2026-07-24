import { describe, it, expect } from "vitest";
import { beatClips } from "./util";
import type { Clip, Cut, Beat } from "../domain/types";

const clip = (id: string, over: Partial<Clip> = {}): Clip => ({
  id, file: new File([], `${id}.mp4`), name: `${id}.mp4`, durationSec: 5, width: 1920, height: 1080, ...over,
});

const beat = (clipId: string): Beat => ({
  id: `beat-${clipId}`, clipId, inSec: 0, outSec: 3, durationSec: 3, scriptText: "", captionText: "",
});

const cutOf = (clipIds: string[], overlayClipIds: string[] = []): Cut => ({
  beats: clipIds.map(beat),
  aspect: "16:9",
  overlays: overlayClipIds.map((clipId, i) => ({
    id: `ov-${i}`, clipId, startTimeSec: 0, durationSec: 1, inSec: 0, outSec: 1,
    blendMode: "normal" as const, opacity: 0.8, volume: 0,
  })),
});

describe("beatClips — 'what's in the cut'", () => {
  const clips = [clip("a"), clip("b"), clip("c"), clip("d")];

  it("returns only clips that are beats, in cut order", () => {
    const result = beatClips(clips, cutOf(["c", "a"]));
    expect(result.map((c) => c.id)).toEqual(["c", "a"]);
  });

  it("excludes clips used only as overlays (not beats)", () => {
    const result = beatClips(clips, cutOf(["a"], ["b"])); // b is an overlay, not a beat
    expect(result.map((c) => c.id)).toEqual(["a"]);
  });

  it("de-dupes a clip that appears in more than one beat", () => {
    const result = beatClips(clips, cutOf(["a", "a", "b"]));
    expect(result.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("is empty when there is no cut yet", () => {
    expect(beatClips(clips, undefined)).toEqual([]);
    expect(beatClips(clips, null)).toEqual([]);
  });
});
