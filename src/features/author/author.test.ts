import { describe, it, expect } from "vitest";
import { parseStory, isAuthorable } from "./author";
import type { Clip } from "../../domain/types";

const ids = new Set(["a", "b", "c"]);

const clip = (over: Partial<Clip>): Clip => ({
  id: "x", file: new File([], "x.mp4"), name: "x.mp4", durationSec: 10, width: 1920, height: 1080, ...over,
});
const desc = { subjectAction: "s", settingMood: "m", usability: 4, model: "m", raw: "r" };

describe("isAuthorable", () => {
  it("requires a description", () => {
    expect(isAuthorable(clip({}))).toBe(false);
    expect(isAuthorable(clip({ description: desc }))).toBe(true);
  });
  it("treats undefined included as included, but excludes when false", () => {
    expect(isAuthorable(clip({ description: desc, included: undefined }))).toBe(true);
    expect(isAuthorable(clip({ description: desc, included: true }))).toBe(true);
    expect(isAuthorable(clip({ description: desc, included: false }))).toBe(false);
  });
});

describe("parseStory", () => {
  it("parses clean JSON into a Story", () => {
    const s = parseStory('{"logline":"A comeback","beats":[{"clipId":"b","script":"Serve"},{"clipId":"a","script":"Kill"}]}', ids);
    expect(s.logline).toBe("A comeback");
    expect(s.beats).toEqual([
      { clipId: "b", scriptText: "Serve" },
      { clipId: "a", scriptText: "Kill" },
    ]);
  });

  it("tolerates code fences and surrounding prose", () => {
    const s = parseStory('Here you go:\n```json\n{"logline":"x","beats":[{"clipId":"c","script":"y"}]}\n```', ids);
    expect(s.beats).toEqual([{ clipId: "c", scriptText: "y" }]);
  });

  it("drops beats referencing unknown clips", () => {
    const s = parseStory('{"logline":"x","beats":[{"clipId":"a","script":"ok"},{"clipId":"zzz","script":"nope"}]}', ids);
    expect(s.beats).toEqual([{ clipId: "a", scriptText: "ok" }]);
  });

  it("resolves a truncated/altered id back to the real clip", () => {
    const clips = [{ id: "6f1c2a90-1111-2222-3333-444455556666" }];
    const s = parseStory('{"logline":"x","beats":[{"clipId":"6f1c2a90-1111","script":"y"}]}', clips);
    expect(s.beats).toEqual([{ clipId: "6f1c2a90-1111-2222-3333-444455556666", scriptText: "y" }]);
  });

  it("resolves an id echoed as the clip's label or filename", () => {
    const clips = [{ id: "u1", label: "match point", name: "match-point.mp4" }];
    const s = parseStory('{"logline":"x","beats":[{"clipId":"match-point.mp4","script":"y"}]}', clips);
    expect(s.beats).toEqual([{ clipId: "u1", scriptText: "y" }]);
  });

  it("throws when beats came back but none resolve (instead of a silent empty story)", () => {
    expect(() =>
      parseStory('{"logline":"x","beats":[{"clipId":"zzz","script":"nope"}]}', ids),
    ).toThrow(/none referenced a known clip/);
  });

  it("returns an empty story without throwing when the model returned no beats", () => {
    const s = parseStory('{"logline":"x","beats":[]}', ids);
    expect(s.beats).toEqual([]);
  });
});
