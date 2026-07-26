import { describe, it, expect } from "vitest";
import { parseInspiredTemplate } from "./inspireTemplate";

const META = { durationSec: 60, width: 1920, height: 1080 };
const FILE_NAME = "tokyo_travel.mp4";

describe("parseInspiredTemplate", () => {
  it("parses clean JSON into a ProjectTemplate", () => {
    const raw = JSON.stringify({
      beatCount: 3,
      beats: [
        { description: "Wide establishing city shot", approxDurationSec: 5 },
        { description: "Close-up product detail", approxDurationSec: 8 },
        { description: "Slow cinematic outro", approxDurationSec: 7 },
      ],
      aspect: "16:9",
      toneHint: "warm cinematic energy",
      colorHint: { warmth: 30, saturation: 20, contrast: 15, shadows: -10, highlights: 5 },
    });

    const tmpl = parseInspiredTemplate(raw, META, FILE_NAME);
    expect(tmpl.beats).toHaveLength(3);
    expect(tmpl.beats[0].description).toBe("Wide establishing city shot");
    expect(tmpl.beats[0].approxDurationSec).toBe(5);
    expect(tmpl.aspect).toBe("16:9");
    expect(tmpl.toneHint).toBe("warm cinematic energy");
    expect(tmpl.colorHint?.warmth).toBe(30);
    expect(tmpl.colorHint?.saturation).toBe(20);
    expect(tmpl.name).toBe("tokyo_travel");
    expect(tmpl.description).toBe(`Extracted from "${FILE_NAME}"`);
  });

  it("strips markdown fences before parsing", () => {
    const raw = "```json\n" + JSON.stringify({
      beatCount: 2,
      beats: [
        { description: "Opening action shot" },
        { description: "Dramatic close-up" },
      ],
      aspect: "16:9",
      toneHint: "high energy",
    }) + "\n```";

    const tmpl = parseInspiredTemplate(raw, META, FILE_NAME);
    expect(tmpl.beats).toHaveLength(2);
    expect(tmpl.beats[1].description).toBe("Dramatic close-up");
  });

  it("falls back to beatCount when beats array is absent", () => {
    const raw = JSON.stringify({ beatCount: 5, aspect: "16:9" });
    const tmpl = parseInspiredTemplate(raw, META, FILE_NAME);
    expect(tmpl.beats).toHaveLength(5);
    expect(tmpl.beats[0].description).toBe("Beat 1");
  });

  it("defaults to 4 beats on completely malformed JSON", () => {
    const tmpl = parseInspiredTemplate("not json at all", META, FILE_NAME);
    expect(tmpl.beats).toHaveLength(4);
  });

  it("infers 9:16 aspect from raw string", () => {
    const raw = JSON.stringify({ beatCount: 2, beats: [{ description: "A" }, { description: "B" }], aspect: "9:16" });
    const tmpl = parseInspiredTemplate(raw, META, FILE_NAME);
    expect(tmpl.aspect).toBe("9:16");
  });

  it("infers aspect from pixel dimensions when raw aspect is unrecognized", () => {
    const raw = JSON.stringify({ beatCount: 2, beats: [{ description: "A" }, { description: "B" }], aspect: "unknown" });
    // 1080×1920 portrait
    const portrait = parseInspiredTemplate(raw, { durationSec: 30, width: 1080, height: 1920 }, FILE_NAME);
    expect(portrait.aspect).toBe("9:16");

    const square = parseInspiredTemplate(raw, { durationSec: 30, width: 1000, height: 1000 }, FILE_NAME);
    expect(square.aspect).toBe("1:1");
  });

  it("clamps colorHint values to -100..100", () => {
    const raw = JSON.stringify({
      beatCount: 2,
      beats: [{ description: "A" }, { description: "B" }],
      aspect: "16:9",
      colorHint: { warmth: 999, saturation: -999, contrast: 0, shadows: 0, highlights: 0 },
    });
    const tmpl = parseInspiredTemplate(raw, META, FILE_NAME);
    expect(tmpl.colorHint?.warmth).toBe(100);
    expect(tmpl.colorHint?.saturation).toBe(-100);
  });

  it("omits colorHint when not present", () => {
    const raw = JSON.stringify({ beatCount: 2, beats: [{ description: "A" }, { description: "B" }], aspect: "16:9" });
    const tmpl = parseInspiredTemplate(raw, META, FILE_NAME);
    expect(tmpl.colorHint).toBeUndefined();
  });

  it("caps beat count at 12 from beatCount field", () => {
    const raw = JSON.stringify({ beatCount: 99, aspect: "16:9" });
    const tmpl = parseInspiredTemplate(raw, META, FILE_NAME);
    expect(tmpl.beats.length).toBeLessThanOrEqual(12);
  });
});
