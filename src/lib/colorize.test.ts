import { describe, expect, it } from "vitest";
import { COLORIZE_PRESETS, normalizeColorize } from "./colorize";

describe("Colorize presets", () => {
  it("provides unique, valid palettes", () => {
    expect(new Set(COLORIZE_PRESETS.map((preset) => preset.name)).size).toBe(COLORIZE_PRESETS.length);
    for (const preset of COLORIZE_PRESETS) {
      expect(normalizeColorize(preset.value)).toEqual(preset.value);
      expect(preset.value.intensity).toBeGreaterThan(0);
      expect(preset.value.intensity).toBeLessThanOrEqual(100);
    }
  });
});
