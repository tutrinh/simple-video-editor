import { describe, it, expect } from "vitest";
import { canvasDims, buildScriptText, buildSrt, wrapCaption, sourceName, beatInputArgs, beatAudioStrategy } from "./export";
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

// --- Stills (ADR-0012) ------------------------------------------------------

const stillClip = (name = "beach.jpg", normalized?: Blob) => ({ name, kind: "still" as const, normalized });
const videoClip = (name = "surf.mov", normalized?: Blob) => ({ name, kind: undefined, normalized });

describe("sourceName", () => {
  it("keeps a Still's real extension", () => {
    expect(sourceName(stillClip("beach.jpg"))).toBe("in.jpg");
    expect(sourceName(stillClip("SHOT.PNG"))).toBe("in.png");
    expect(sourceName(stillClip("a.webp"))).toBe("in.webp");
  });

  it("reads kind BEFORE normalized", () => {
    // Importing a .vidstr used to set `normalized` on every clip; a Still under
    // an .mp4 name gives ffmpeg an mp4 demuxer for a JPEG.
    expect(sourceName(stillClip("beach.jpg", new Blob([])))).toBe("in.jpg");
  });

  it("is unchanged for footage", () => {
    expect(sourceName(videoClip("surf.mov"))).toBe("in.mov");
    expect(sourceName(videoClip("surf.mov", new Blob([])))).toBe("in.mp4");
    expect(sourceName(videoClip("noext"))).toBe("in.mp4");
  });
});

describe("beatInputArgs", () => {
  it("loops a Still for the segment's length instead of seeking into it", () => {
    const args = beatInputArgs(stillClip("beach.jpg"), 0, 10);
    expect(args).toEqual(["-loop", "1", "-t", "10", "-r", "30", "-i", "in.jpg"]);
    expect(args).not.toContain("-ss");
  });

  it("passes a trimmed Still's length through to -t", () => {
    expect(beatInputArgs(stillClip(), 0, 4.5)).toContain("4.5");
    expect(beatInputArgs(stillClip(), 0, 4.5)[3]).toBe("4.5");
  });

  it("ignores inSec for a Still — every frame is the same frame", () => {
    expect(beatInputArgs(stillClip(), 0, 10)).toEqual(beatInputArgs(stillClip(), 3.7, 10));
  });

  it("seeks and trims footage exactly as before", () => {
    const args = beatInputArgs(videoClip("surf.mov"), 2.5, 3);
    expect(args).toEqual(["-ss", "2.5", "-t", "3", "-i", "in.mov"]);
    expect(args).not.toContain("-loop");
  });

  it("emits exactly one input either way, so downstream indices are unchanged", () => {
    // The caption/title/overlay/sticker index arithmetic counts inputs from 1.
    for (const clip of [stillClip(), videoClip()]) {
      const args = beatInputArgs(clip, 1, 5);
      expect(args.filter((a) => a === "-i")).toHaveLength(1);
      expect(args[args.length - 2]).toBe("-i"); // the source is always last
    }
  });
});

describe("beatAudioStrategy", () => {
  it("forces a Still silent however loud the Beat is set", () => {
    // There is no [0:a] to map; mapping it fails the whole segment.
    expect(beatAudioStrategy({ kind: "still" }, 1)).toBe("silent");
    expect(beatAudioStrategy({ kind: "still" }, 0.5)).toBe("silent");
    expect(beatAudioStrategy({ kind: "still" }, 0)).toBe("silent");
  });

  it("leaves footage on its volume switch", () => {
    expect(beatAudioStrategy({ kind: "video" }, 1)).toBe("source");
    expect(beatAudioStrategy({ kind: undefined }, 1)).toBe("source");
    expect(beatAudioStrategy({ kind: undefined }, 0)).toBe("silent");
  });
});

describe("TitleAnimation typewriter support", () => {
  it("supports typewriter in TitleAnimation union", () => {
    const validAnim: import("./export").TitleAnimation = "typewriter";
    expect(validAnim).toBe("typewriter");
  });
});
