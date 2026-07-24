import { describe, it, expect } from "vitest";
import { scriptTypeHint, SCRIPT_TYPE_OPTIONS } from "./SettingsContext";

describe("scriptTypeHint", () => {
  it("returns an empty hint for 'auto' (no steer)", () => {
    expect(scriptTypeHint("auto")).toBe("");
  });

  it("returns a genre-structure hint for a real type", () => {
    expect(scriptTypeHint("sports")).toMatch(/sports highlight/i);
    expect(scriptTypeHint("product-review")).toMatch(/product review/i);
  });

  it("returns an empty string for an unknown id", () => {
    expect(scriptTypeHint("does-not-exist")).toBe("");
  });

  it("exposes every option with an id and label", () => {
    for (const opt of SCRIPT_TYPE_OPTIONS) {
      expect(opt.id).toBeTruthy();
      expect(opt.label).toBeTruthy();
    }
  });
});
