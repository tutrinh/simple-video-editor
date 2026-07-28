import { describe, expect, it } from "vitest";
import type { Clip, ProjectTemplate } from "../../domain/types";
import { applyTemplate, TemplateApplicationError } from "./applyTemplate";

const clip = (id: string, durationSec = 10): Clip => ({
  id,
  file: new File([], `${id}.mp4`),
  name: `${id}.mp4`,
  durationSec,
  width: 1920,
  height: 1080,
});

const template = (overrides: Partial<ProjectTemplate> = {}): ProjectTemplate => ({
  id: "tmpl-1",
  name: "Launch",
  createdAt: 1,
  updatedAt: 1,
  aspect: "9:16",
  colorHint: { warmth: 20, contrast: 10 },
  beats: [
    { description: "Opening", approxDurationSec: 3, zoom: 1.2, transition: "fade", transitionSec: 0.4 },
    { description: "Detail", approxDurationSec: 20, transition: "wipeleft", transitionSec: 0.6 },
  ],
  ...overrides,
});

describe("applyTemplate", () => {
  it("builds a cut with fitted timing and template style", () => {
    const { cut, placeholderClips } = applyTemplate(template(), [clip("a", 8), clip("b", 5)], [
      { beatIndex: 0, clipId: "a" },
      { beatIndex: 1, clipId: "b" },
    ]);

    expect(cut.aspect).toBe("9:16");
    expect(cut.templateName).toBe("Launch");
    expect(placeholderClips).toHaveLength(0);
    expect(cut.globalFilterAdjustments).toEqual({ warmth: 20, contrast: 10 });
    expect(cut.beats[0]).toMatchObject({
      clipId: "a", durationSec: 3, inSec: 2.5, outSec: 5.5, zoom: 1.2, transition: "none", transitionSec: 0.4,
      templateSlotDescription: "Opening",
    });
    expect(cut.beats[1]).toMatchObject({
      clipId: "b", durationSec: 5, inSec: 0, outSec: 5, transition: "wipeleft", transitionSec: 0.6,
      templateSlotDescription: "Detail",
    });
  });

  it("preserves template order by creating labeled placeholders for empty assignments", () => {
    const result = applyTemplate(template(), [clip("a", 8)], [
      { beatIndex: 0, clipId: "a" },
      { beatIndex: 1, clipId: "" },
    ]);

    expect(result.cut.beats).toHaveLength(2);
    expect(result.cut.beats[0].clipId).toBe("a");
    expect(result.placeholderClips).toHaveLength(1);
    expect(result.placeholderClips[0]).toMatchObject({
      name: "Empty · Detail",
      isTemplatePlaceholder: true,
      templateSlotDescription: "Detail",
    });
    expect(result.cut.beats[1].clipId).toBe(result.placeholderClips[0].id);
  });

  it("rejects missing, duplicate, and stale clip assignments", () => {
    const clips = [clip("a"), clip("b")];
    expect(() => applyTemplate(template(), clips, [{ beatIndex: 0, clipId: "a" }])).toThrow(TemplateApplicationError);
    expect(() => applyTemplate(template(), clips, [
      { beatIndex: 0, clipId: "a" },
      { beatIndex: 1, clipId: "a" },
    ])).toThrow("different clip");
    expect(() => applyTemplate(template(), clips, [
      { beatIndex: 0, clipId: "a" },
      { beatIndex: 1, clipId: "missing" },
    ])).toThrow("no longer available");
  });

  it("rejects templates outside the supported beat-count invariant", () => {
    expect(() => applyTemplate(template({ beats: [{ description: "Only" }] }), [clip("a")], [
      { beatIndex: 0, clipId: "a" },
    ])).toThrow("between 2 and 12");
  });
});
