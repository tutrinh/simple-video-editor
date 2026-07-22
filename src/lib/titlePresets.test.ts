import { describe, expect, it, beforeEach } from "vitest";
import { BUILT_IN_PRESETS, loadSavedPresets, savePreset, exportPresetsToJson, parsePresetsJson } from "./titlePresets";
import type { TitleLayerSettings } from "../state/ExportSettingsContext";

describe("titlePresets", () => {
  beforeEach(() => {
    if (typeof localStorage !== "undefined" && typeof localStorage.clear === "function") {
      localStorage.clear();
    }
  });

  it("has built-in presets loaded", () => {
    expect(BUILT_IN_PRESETS.length).toBeGreaterThanOrEqual(4);
    expect(BUILT_IN_PRESETS[0].name).toContain("Cinematic Gold");
  });

  it("saves and loads custom presets from localStorage", () => {
    const dummyStore: Record<string, string> = {};
    const mockStorage = {
      getItem: (k: string) => dummyStore[k] ?? null,
      setItem: (k: string, v: string) => { dummyStore[k] = v; },
    };
    Object.defineProperty(globalThis, "window", { value: { localStorage: mockStorage }, writable: true });
    Object.defineProperty(globalThis, "localStorage", { value: mockStorage, writable: true });

    const dummyLayers: TitleLayerSettings[] = [
      { id: "layer-1", enabled: true, text: "TEST", fontId: "outfit", fontFile: null, weight: 700, sizePx: 100, letterSpacing: 4, arcDeg: 0, shadow: true, color: "#fff", posX: 0, posY: 0, scope: "intro", introSec: 3 },
    ];
    savePreset("My Custom Preset", dummyLayers);

    const saved = loadSavedPresets();
    expect(saved).toHaveLength(1);
    expect(saved[0].name).toBe("My Custom Preset");
    expect(saved[0].layers[0].text).toBe("TEST");
  });

  it("exports and parses JSON presets correctly", () => {
    const presets = BUILT_IN_PRESETS;
    const jsonStr = exportPresetsToJson(presets);
    const parsed = parsePresetsJson(jsonStr);

    expect(parsed.length).toBe(presets.length);
    expect(parsed[0].name).toBe(presets[0].name);
  });
});
