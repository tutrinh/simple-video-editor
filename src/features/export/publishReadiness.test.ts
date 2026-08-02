import { describe, expect, it } from "vitest";
import { publishReadiness } from "./publishReadiness";

describe("publishReadiness", () => {
  it("recognizes a complete vertical short", () => {
    expect(publishReadiness({ target: "YouTube Shorts", aspect: "9:16", durationSec: 179, hasCaptions: true, hasAudio: true }).every((check) => check.ready)).toBe(true);
  });

  it("guides feed posts toward 4:5 and catches missing accessibility", () => {
    const checks = publishReadiness({ target: "Instagram Feed", aspect: "16:9", durationSec: 20, hasCaptions: false, hasAudio: true });
    expect(checks.find((check) => check.label === "Framing")?.detail).toContain("4:5");
    expect(checks.find((check) => check.label === "Captions")?.ready).toBe(false);
  });
});
