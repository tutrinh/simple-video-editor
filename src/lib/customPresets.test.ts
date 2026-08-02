// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { deleteCustomPreset, getAllFilterPresets, loadCustomPresets, saveCustomPreset } from "./customPresets";

beforeEach(() => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  };
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
  Object.defineProperty(window, "localStorage", { value: storage, configurable: true });
});

describe("app-wide custom color filter presets", () => {
  it("round-trips a complete Beat grade through the shared preset library", () => {
    const colorAdjustments = {
      exposure: 12,
      saturation: 32,
      shadows: -28,
      highlightWarmth: 9,
      colorize: {
        shadowColor: "#75c9ff",
        highlightColor: "#ffa8d8",
        intensity: 3,
      },
    };

    const saved = saveCustomPreset("Soft split tone", colorAdjustments, "Saved from Beat 1");

    expect(loadCustomPresets()).toEqual([saved]);
    expect(getAllFilterPresets()[0]).toMatchObject({
      id: saved.id,
      name: "Soft split tone",
      isCustom: true,
      colorAdjustments,
    });

    deleteCustomPreset(saved.id);
    expect(loadCustomPresets()).toEqual([]);
  });
});
