import { describe, it, expect } from "vitest";
import { needsNormalize } from "./ingest";

describe("needsNormalize", () => {
  it("flags clips whose long edge exceeds 1080p", () => {
    expect(needsNormalize({ width: 3840, height: 2160 })).toBe(true); // 4K landscape
    expect(needsNormalize({ width: 2160, height: 3840 })).toBe(true); // 4K portrait
  });
  it("passes clips at or under 1080p", () => {
    expect(needsNormalize({ width: 1920, height: 1080 })).toBe(false);
    expect(needsNormalize({ width: 1080, height: 1920 })).toBe(false); // 1080p portrait
    expect(needsNormalize({ width: 1280, height: 720 })).toBe(false);
  });
});
