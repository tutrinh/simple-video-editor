import { describe, it, expect } from "vitest";
import { canvasDims, buildScriptText, buildSrt, wrapCaption } from "./export";
import type { Cut } from "../../domain/types";

const cut: Cut = {
  aspect: "16:9",
  beats: [
    { id: "1", clipId: "a", inSec: 0, outSec: 2, durationSec: 2, scriptText: "Serve", captionText: "Serve" },
    { id: "2", clipId: "b", inSec: 1, outSec: 4, durationSec: 3, scriptText: "The kill", captionText: "The kill" },
  ],
};

describe("canvasDims", () => {
  it("maps each aspect to 1080p canvas dims", () => {
    expect(canvasDims("16:9")).toEqual([1920, 1080]);
    expect(canvasDims("9:16")).toEqual([1080, 1920]);
    expect(canvasDims("1:1")).toEqual([1080, 1080]);
  });
});

describe("wrapCaption", () => {
  it("keeps a short caption on one line", () => {
    expect(wrapCaption("Match point", 1080, 86)).toBe("Match point");
  });
  it("wraps a long caption to multiple lines that each fit", () => {
    const long = "the sun rises in the light and the day gives way to the night again";
    const out = wrapCaption(long, 1080, 86); // 9:16 → ~22 chars/line
    const lines = out.split("\n");
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(22);
    expect(out.replace(/\n/g, " ")).toBe(long); // no words lost or reordered
  });
  it("collapses whitespace and drops empty tokens", () => {
    expect(wrapCaption("  hello   world  ", 1920, 49)).toBe("hello world");
  });
});

describe("script export", () => {
  it("joins script lines", () => {
    expect(buildScriptText(cut)).toBe("Serve\n\nThe kill");
  });
  it("builds sequential SRT timings from beat durations", () => {
    const srt = buildSrt(cut);
    expect(srt).toContain("1\n00:00:00,000 --> 00:00:02,000\nServe");
    expect(srt).toContain("2\n00:00:02,000 --> 00:00:05,000\nThe kill");
  });
  it("emits one SRT cue per line for a timed beat, offset by earlier beats and its lead-in", () => {
    // Beat 2 is timed: 1s lead + 2s + 3s + 2s tail = 8s total (its durationSec).
    const timedCut: Cut = {
      aspect: "16:9",
      beats: [
        { id: "1", clipId: "a", inSec: 0, outSec: 2, durationSec: 2, scriptText: "Serve", captionText: "Serve" },
        { id: "2", clipId: "b", inSec: 0, outSec: 8, durationSec: 8, scriptText: "Set\nSpike", captionText: "Set\nSpike", captionDurations: [2, 3] },
      ],
    };
    const srt = buildSrt(timedCut);
    // Beat 1 (untimed) → one cue ending at 2s. Beat 2 starts at 2s; its lines begin
    // after the 1s lead-in (3s), run in sequence, and the 2s tail carries no cue.
    expect(srt).toContain("1\n00:00:00,000 --> 00:00:02,000\nServe");
    expect(srt).toContain("2\n00:00:03,000 --> 00:00:05,000\nSet");
    expect(srt).toContain("3\n00:00:05,000 --> 00:00:08,000\nSpike");
  });
});
