import { describe, expect, it } from "vitest";
import type { Beat, Cut } from "../../domain/types";
import {
  COVER_MAX_EDGE,
  capturedLabel,
  fitCoverFrame,
  framingAt,
  seedCapturedCover,
  seedUploadedCover,
} from "./coverSource";
import { COVER_FILE_ACCEPT, CLIP_FILE_ACCEPT, isStillFile } from "../ingest/ingest";

const frame = () => new File([new Uint8Array([1, 2, 3])], "cover-frame.jpg", { type: "image/jpeg" });

function beat(over: Partial<Beat> = {}): Beat {
  return {
    id: "b1", clipId: "c1", inSec: 0, outSec: 4, durationSec: 4,
    scriptText: "", captionText: "", ...over,
  };
}

function cut(over: Partial<Cut> = {}): Cut {
  return { beats: [], aspect: "16:9", ...over };
}

describe("fitCoverFrame", () => {
  it("caps the long edge and preserves the aspect ratio", () => {
    expect(fitCoverFrame(6000, 4000)).toEqual({ width: 3840, height: 2560 });
  });

  it("caps on height when the picture is portrait", () => {
    expect(fitCoverFrame(4000, 6000)).toEqual({ width: 2560, height: 3840 });
  });

  it("leaves anything already under the cap untouched", () => {
    expect(fitCoverFrame(1920, 1080)).toEqual({ width: 1920, height: 1080 });
    expect(fitCoverFrame(COVER_MAX_EDGE, 2160)).toEqual({ width: 3840, height: 2160 });
  });

  it("never rounds a dimension to zero", () => {
    // A 1×20000 sliver scales by 0.192 — naive rounding would give width 0 and a
    // canvas that throws on construction.
    expect(fitCoverFrame(1, 20000)).toEqual({ width: 1, height: 3840 });
    expect(fitCoverFrame(1, 1)).toEqual({ width: 1, height: 1 });
  });

  it("survives a source that never probed", () => {
    expect(fitCoverFrame(0, 0)).toEqual({ width: 1, height: 1 });
    expect(fitCoverFrame(NaN, 1080)).toEqual({ width: 1, height: 1080 });
  });
});

describe("capturedLabel", () => {
  it("is one-based and one-decimal", () => {
    expect(capturedLabel(0, 0)).toBe("Beat 1 @ 0.0s");
    expect(capturedLabel(1, 1.44)).toBe("Beat 2 @ 1.4s");
    expect(capturedLabel(11, 10.06)).toBe("Beat 12 @ 10.1s");
  });
});

describe("framingAt", () => {
  it("copies a static Zoom straight across", () => {
    expect(framingAt(beat({ zoom: 1.8, zoomX: 20, zoomY: -10 }), 2)).toEqual({
      zoom: 1.8, zoomX: 20, zoomY: -10, rotation: 0,
    });
  });

  it("defaults an untouched Beat to full frame", () => {
    expect(framingAt(beat(), 2)).toEqual({ zoom: 1, zoomX: 0, zoomY: 0, rotation: 0 });
  });

  it("evaluates a Ken Burns move at the captured instant, not its start", () => {
    const kb = beat({
      framing: "kenBurns",
      inSec: 0, outSec: 10,
      kenBurns: { fromScale: 1, toScale: 2, fromX: 0, toX: 40, fromY: 0, toY: -20 },
    });
    expect(framingAt(kb, 0)).toEqual({ zoom: 1, zoomX: 0, zoomY: 0, rotation: 0 });
    expect(framingAt(kb, 5)).toEqual({ zoom: 1.5, zoomX: 20, zoomY: -10, rotation: 0 });
    expect(framingAt(kb, 10)).toEqual({ zoom: 2, zoomX: 40, zoomY: -20, rotation: 0 });
  });

  it("uses the Beat's own window, not absolute Cut time", () => {
    const kb = beat({
      framing: "kenBurns",
      inSec: 4, outSec: 8,
      kenBurns: { fromScale: 1, toScale: 3, fromX: 0, toX: 0, fromY: 0, toY: 0 },
    });
    expect(framingAt(kb, 6).zoom).toBe(2);
  });

  it("ignores a Ken Burns move on a Beat whose framing is Zoom", () => {
    // The two are a mode, not a stack (ADR-0015) — a stale kenBurns must not leak.
    const b = beat({
      framing: "zoom", zoom: 1.2,
      kenBurns: { fromScale: 3, toScale: 3, fromX: 0, toX: 0, fromY: 0, toY: 0 },
    });
    expect(framingAt(b, 2).zoom).toBe(1.2);
  });

  it("carries the Beat's straightening rotation across", () => {
    expect(framingAt(beat({ rotation: 3.5 }), 2).rotation).toBe(3.5);
    expect(framingAt(beat(), 2).rotation).toBe(0);
  });

  it("carries rotation on a Ken Burns Beat too, since the move does not rotate", () => {
    const kb = beat({
      framing: "kenBurns", rotation: -4, inSec: 0, outSec: 10,
      kenBurns: { fromScale: 1, toScale: 2, fromX: 0, toX: 0, fromY: 0, toY: 0 },
    });
    expect(framingAt(kb, 5).rotation).toBe(-4);
  });

  it("does not divide by zero on a degenerate window", () => {
    const kb = beat({
      framing: "kenBurns", inSec: 2, outSec: 2,
      kenBurns: { fromScale: 1, toScale: 2, fromX: 0, toX: 0, fromY: 0, toY: 0 },
    });
    expect(framingAt(kb, 2).zoom).toBe(1);
  });
});

describe("seedCapturedCover", () => {
  it("flattens the Beat's Grade with the Cut's Look rather than taking either alone", () => {
    const c = seedCapturedCover({
      beat: beat({ colorAdjustments: { exposure: 20 } }),
      cut: cut({ globalFilterAdjustments: { exposure: 15, saturation: 30 }, globalFilterIntensity: 1 }),
      beatIndex: 0, atSec: 1, frame: frame(),
    });
    expect(c.grade.exposure).toBe(35);
    expect(c.grade.saturation).toBe(30);
  });

  it("inherits the Look on a Beat that has no Grade of its own", () => {
    const c = seedCapturedCover({
      beat: beat(),
      cut: cut({ globalFilterAdjustments: { warmth: 40 }, globalFilterIntensity: 1 }),
      beatIndex: 0, atSec: 0, frame: frame(),
    });
    expect(c.grade.warmth).toBe(40);
  });

  it("honours the Look's intensity", () => {
    const c = seedCapturedCover({
      beat: beat(),
      cut: cut({ globalFilterAdjustments: { warmth: 40 }, globalFilterIntensity: 0.5 }),
      beatIndex: 0, atSec: 0, frame: frame(),
    });
    expect(c.grade.warmth).toBe(20);
  });

  it("inherits the Beat's rotation so the Cover opens looking like the video", () => {
    expect(seedCapturedCover({
      beat: beat({ rotation: 2.5 }), cut: cut(), beatIndex: 0, atSec: 0, frame: frame(),
    }).rotation).toBe(2.5);
  });

  it("takes the aspect from the Cut", () => {
    expect(seedCapturedCover({
      beat: beat(), cut: cut({ aspect: "9:16" }), beatIndex: 0, atSec: 0, frame: frame(),
    }).aspect).toBe("9:16");
  });

  it("starts with no Veil, no Stickers, and three empty Title layers", () => {
    // Empty layers rather than an empty array: the shared title editor renders
    // nothing at all without a layer to show.
    const c = seedCapturedCover({ beat: beat(), cut: cut(), beatIndex: 0, atSec: 0, frame: frame() });
    expect(c.veil).toBeUndefined();
    expect(c.stickers).toEqual([]);
    expect(c.titles).toHaveLength(3);
    expect(c.titles.every((t) => !t.enabled && t.text === "")).toBe(true);
  });
});

describe("seedUploadedCover", () => {
  it("starts neutral even under a strong Look", () => {
    const c = seedUploadedCover({
      frame: frame(), fileName: "sunset.jpg",
      cut: cut({ globalFilterAdjustments: { warmth: 80, saturation: -40 }, globalFilterIntensity: 1 }),
    });
    expect(c.grade).toEqual({});
  });

  it("labels itself with the filename", () => {
    expect(seedUploadedCover({ frame: frame(), fileName: "sunset.jpg", cut: cut() }).sourceLabel)
      .toBe("sunset.jpg");
  });

  it("takes the aspect from the Cut, not from the image", () => {
    // A 16:9 photo dropped into a 9:16 project is still a 9:16 Cover — aspect is
    // what the platform wants, not what the file happens to be.
    expect(seedUploadedCover({ frame: frame(), fileName: "wide.jpg", cut: cut({ aspect: "9:16" }) }).aspect)
      .toBe("9:16");
  });

  it("starts at full frame and unrotated", () => {
    const c = seedUploadedCover({ frame: frame(), fileName: "a.png", cut: cut() });
    expect([c.zoom, c.zoomX, c.zoomY, c.rotation]).toEqual([1, 0, 0, 0]);
  });
});

describe("COVER_FILE_ACCEPT", () => {
  it("admits every extension a Still can be", () => {
    for (const ext of ["jpg", "jpeg", "png", "webp", "avif", "bmp", "gif"]) {
      expect(COVER_FILE_ACCEPT).toContain(`.${ext}`);
      expect(isStillFile({ name: `x.${ext}`, type: "" })).toBe(true);
    }
  });

  it("keeps SVG and video out", () => {
    expect(COVER_FILE_ACCEPT).not.toContain("svg");
    expect(COVER_FILE_ACCEPT).not.toContain("video");
    expect(isStillFile({ name: "x.svg", type: "" })).toBe(false);
    expect(isStillFile({ name: "x.mp4", type: "video/mp4" })).toBe(false);
    expect(isStillFile({ name: "x.mov", type: "" })).toBe(false);
  });

  it("is the same list the Clip input uses, so the two cannot drift", () => {
    expect(CLIP_FILE_ACCEPT).toBe(`video/*,${COVER_FILE_ACCEPT}`);
  });
});
