import { describe, expect, it } from "vitest";
import { applyTemplate } from "./applyTemplate";
import {
  BUILT_IN_REEL_TEMPLATES,
  isBuiltInReelTemplate,
  listAvailableTemplates,
} from "./builtInTemplates";
import type { ProjectTemplate } from "../../domain/types";

describe("built-in reel templates", () => {
  it("provides the four supported vertical reel formats", () => {
    expect(BUILT_IN_REEL_TEMPLATES.map((template) => template.id)).toEqual([
      "builtin-product-review-reel",
      "builtin-lifestyle-vlog-reel",
      "builtin-fashion-vlog-reel",
      "builtin-motivation-vlog-reel",
    ]);

    for (const template of BUILT_IN_REEL_TEMPLATES) {
      expect(template.aspect).toBe("9:16");
      expect(template.beats.length).toBeGreaterThanOrEqual(5);
      expect(template.beats.length).toBeLessThanOrEqual(12);
      expect(template.beats.every((beat) => Boolean(beat.description.trim()))).toBe(true);
      expect(template.beats.every((beat) => (beat.approxDurationSec ?? 0) > 0)).toBe(true);
      const duration = template.beats.reduce((total, beat) => total + (beat.approxDurationSec ?? 0), 0);
      expect(duration).toBeGreaterThanOrEqual(20);
      expect(duration).toBeLessThanOrEqual(45);
    }
  });

  it("marks only canonical built-ins as built in", () => {
    expect(isBuiltInReelTemplate(BUILT_IN_REEL_TEMPLATES[0])).toBe(true);
    expect(isBuiltInReelTemplate({ ...BUILT_IN_REEL_TEMPLATES[0], id: "custom" })).toBe(false);
  });

  it("lists built-ins before custom templates and rejects custom ID collisions", () => {
    const custom: ProjectTemplate = {
      id: "custom-day",
      name: "My day",
      createdAt: 2,
      updatedAt: 3,
      beats: [
        { description: "Open", approxDurationSec: 2 },
        { description: "Close", approxDurationSec: 2 },
      ],
    };
    const collision = { ...custom, id: BUILT_IN_REEL_TEMPLATES[0].id };

    const available = listAvailableTemplates([custom, collision]);

    expect(available).toHaveLength(5);
    expect(available.slice(0, 4)).toEqual(BUILT_IN_REEL_TEMPLATES);
    expect(available[4]).toBe(custom);
  });

  it("applies every reel template without footage as ordered vertical placeholders", () => {
    for (const template of BUILT_IN_REEL_TEMPLATES) {
      const result = applyTemplate(
        template,
        [],
        template.beats.map((_, beatIndex) => ({ beatIndex, clipId: "" })),
      );

      expect(result.cut.aspect).toBe("9:16");
      expect(result.cut.templateName).toBe(template.name);
      expect(result.cut.beats).toHaveLength(template.beats.length);
      expect(result.placeholderClips).toHaveLength(template.beats.length);
      expect(result.cut.beats.map((beat) => beat.templateSlotDescription)).toEqual(
        template.beats.map((beat) => beat.description),
      );
    }
  });
});
