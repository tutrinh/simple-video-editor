import { describe, expect, it, vi } from "vitest";
import type { Clip, ProjectTemplate } from "../../domain/types";
import {
  buildTemplateCoveragePrompt,
  recommendTemplateCoverage,
} from "./templateCoverage";

const template: ProjectTemplate = {
  id: "product",
  name: "Product Review Reel",
  createdAt: 0,
  updatedAt: 0,
  aspect: "9:16",
  toneHint: "credible",
  beats: [
    { description: "Opening product hook", approxDurationSec: 3 },
    { description: "Demonstrate the main feature", approxDurationSec: 5 },
    { description: "Show the result", approxDurationSec: 4 },
  ],
};

function clip(id: string, subjectAction: string, usability = 4): Clip {
  return {
    id,
    file: new File([], `${id}.mp4`),
    name: `${id}.mp4`,
    durationSec: 10,
    width: 1080,
    height: 1920,
    description: {
      subjectAction,
      settingMood: "bright desk",
      usability,
      model: "test",
      raw: subjectAction,
    },
  };
}

describe("template coverage recommendations", () => {
  it("grounds matching in neutral Clip descriptions and every template role", () => {
    const prompt = buildTemplateCoveragePrompt({
      template,
      clips: [
        clip("hero", "Creator holds the product toward camera"),
        clip("demo", "Hands operate the main control"),
      ],
    });

    expect(prompt).toContain("Product Review Reel");
    expect(prompt).toContain("Opening product hook");
    expect(prompt).toContain("Creator holds the product toward camera");
    expect(prompt).toContain("Use each Clip at most once");
    expect(prompt).toContain("Do not pretend a Clip contains");
  });

  it("keeps only valid, unique, confident matches and fills every coverage gap", async () => {
    const author = vi.fn().mockResolvedValue(JSON.stringify({
      recommendations: [
        { beatIndex: 0, clipId: "hero", confidence: 0.92, reason: "Product is visible immediately." },
        { beatIndex: 1, clipId: "hero", confidence: 0.88, reason: "Duplicate should be rejected." },
        { beatIndex: 2, clipId: "unknown", confidence: 0.99, reason: "Unknown Clip." },
      ],
    }));

    const result = await recommendTemplateCoverage({
      template,
      clips: [clip("hero", "Creator holds the product"), clip("demo", "Hands use product")],
    }, author);

    expect(result.recommendations[0]).toEqual(
      expect.objectContaining({ beatIndex: 0, clipId: "hero", confidence: 0.92 }),
    );
    expect(result.recommendations[1]).toEqual(
      expect.objectContaining({ beatIndex: 1, missing: true }),
    );
    expect(result.recommendations[2]).toEqual(
      expect.objectContaining({ beatIndex: 2, missing: true }),
    );
    expect(result.recommendations[1]).not.toHaveProperty("clipId");
    expect(result.recommendations[2]).not.toHaveProperty("clipId");
    expect(result.matchedCount).toBe(1);
    expect(result.missingCount).toBe(2);
    expect(author).toHaveBeenCalledOnce();
  });

  it("treats low-confidence matches as missing and rejects malformed AI output", async () => {
    const lowConfidence = JSON.stringify({
      recommendations: [
        { beatIndex: 0, clipId: "hero", confidence: 0.3, reason: "Weak visual fit." },
      ],
    });
    const result = await recommendTemplateCoverage({
      template: { ...template, beats: template.beats.slice(0, 2) },
      clips: [clip("hero", "Unrelated landscape")],
    }, async () => lowConfidence);
    expect(result.matchedCount).toBe(0);
    expect(result.missingCount).toBe(2);

    await expect(recommendTemplateCoverage({
      template,
      clips: [clip("hero", "Product")],
    }, async () => "not json")).rejects.toThrow("JSON object");
  });

  it("requires analyzed Clips before asking AI to match them", async () => {
    const unanalyzed = { ...clip("raw", "unused"), description: undefined };
    await expect(recommendTemplateCoverage({
      template,
      clips: [unanalyzed],
    }, async () => "{}")).rejects.toThrow("analyzed Clip");
  });

  it("prepares and validates a large Clip library without blocking the editor", async () => {
    const stressTemplate: ProjectTemplate = {
      ...template,
      beats: Array.from({ length: 12 }, (_, index) => ({
        description: `Coverage role ${index + 1}`,
        approxDurationSec: 3,
      })),
    };
    const clips = Array.from({ length: 500 }, (_, index) =>
      clip(`clip-${index}`, `Visible source action ${index}`)
    );
    const response = JSON.stringify({
      recommendations: stressTemplate.beats.map((_, beatIndex) => ({
        beatIndex,
        clipId: `clip-${beatIndex}`,
        confidence: 0.9,
        reason: "Visible action matches the requested role.",
      })),
    });

    const start = performance.now();
    const result = await recommendTemplateCoverage(
      { template: stressTemplate, clips },
      async () => response,
    );
    const elapsed = performance.now() - start;

    expect(result.matchedCount).toBe(12);
    expect(elapsed).toBeLessThan(100);
  });
});
