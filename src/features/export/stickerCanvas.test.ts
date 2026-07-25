import { describe, it, expect } from "vitest";
import type { Sticker } from "../../domain/types";
import { stickerRect, activeStickers, stickerWindowInSegment, beatSpans, resolveSticker, resolveStickers, stickerTint, stickerRenderKey, maxStickerStart } from "./stickerCanvas";

const W16 = 1920, H16 = 1080;
const W9 = 1080, H9 = 1920;

const place = (over: Partial<Sticker> = {}): Sticker => ({
  id: "s1", fileName: "star.png", startTimeSec: 0, durationSec: 2,
  x: 0.5, y: 0.5, scale: 0.25, rotation: 0, opacity: 1, ...over,
});

describe("stickerRect", () => {
  it("centres a 0.5/0.5 placement", () => {
    const r = stickerRect(place(), W16, H16, 100, 100);
    expect(r.cx).toBe(W16 / 2);
    expect(r.cy).toBe(H16 / 2);
  });

  it("maps fractional position to the frame's own pixels", () => {
    const r = stickerRect(place({ x: 0.25, y: 0.75 }), W16, H16, 100, 100);
    expect(r.cx).toBe(480);
    expect(r.cy).toBe(810);
  });

  it("sizes by a fraction of frame WIDTH", () => {
    expect(stickerRect(place({ scale: 0.25 }), W16, H16, 100, 100).width).toBe(480);
    expect(stickerRect(place({ scale: 0.5 }), W16, H16, 100, 100).width).toBe(960);
  });

  it("takes height from the asset's aspect, never the frame's", () => {
    // A 2:1 asset stays 2:1 whatever the frame is.
    const wide = stickerRect(place({ scale: 0.5 }), W16, H16, 200, 100);
    expect(wide.height).toBeCloseTo(wide.width / 2, 6);
    const tall = stickerRect(place({ scale: 0.5 }), W16, H16, 100, 300);
    expect(tall.height).toBeCloseTo(tall.width * 3, 6);
  });

  it("keeps apparent size when the Cut is re-aimed to another aspect", () => {
    // Fractions, not pixels — the sticker stays a quarter of the frame's width.
    const a = stickerRect(place({ scale: 0.25 }), W16, H16, 100, 100);
    const b = stickerRect(place({ scale: 0.25 }), W9, H9, 100, 100);
    expect(a.width / W16).toBeCloseTo(b.width / W9, 9);
  });

  it("passes rotation through as clockwise degrees", () => {
    expect(stickerRect(place({ rotation: -30 }), W16, H16, 100, 100).rotationDeg).toBe(-30);
    expect(stickerRect(place({ rotation: 145 }), W16, H16, 100, 100).rotationDeg).toBe(145);
  });

  it("clamps position, scale and rotation to their ranges", () => {
    const r = stickerRect(place({ x: 5, y: -3, scale: 99, rotation: 900 }), W16, H16, 100, 100);
    expect(r.cx).toBe(W16);
    expect(r.cy).toBe(0);
    expect(r.width).toBe(W16 * 2);
    expect(r.rotationDeg).toBe(180);
  });

  it("treats a zero-sized asset as square rather than dividing by zero", () => {
    const r = stickerRect(place(), W16, H16, 0, 0);
    expect(r.height).toBe(r.width);
    expect(Number.isFinite(r.height)).toBe(true);
  });
});

describe("activeStickers", () => {
  const a = place({ id: "a", startTimeSec: 0, durationSec: 2 });
  const b = place({ id: "b", startTimeSec: 2, durationSec: 2 });

  it("returns nothing for an empty or missing list", () => {
    expect(activeStickers(undefined, 1)).toEqual([]);
    expect(activeStickers([], 1)).toEqual([]);
  });

  it("includes a sticker inside its window", () => {
    expect(activeStickers([a, b], 1).map((s) => s.id)).toEqual(["a"]);
  });

  it("is half-open, so adjacent stickers never both show on the seam", () => {
    expect(activeStickers([a, b], 2).map((s) => s.id)).toEqual(["b"]);
  });

  it("includes the exact start frame", () => {
    expect(activeStickers([a, b], 0).map((s) => s.id)).toEqual(["a"]);
  });

  it("returns several when they overlap", () => {
    const c = place({ id: "c", startTimeSec: 0, durationSec: 5 });
    expect(activeStickers([a, c], 1).map((s) => s.id)).toEqual(["a", "c"]);
  });
});

describe("stickerWindowInSegment", () => {
  // Segment covering cut time 10..14s.
  const seg = { start: 10, dur: 4 };
  const win = (s: Sticker) => stickerWindowInSegment(s, seg.start, seg.dur);

  it("maps a sticker fully inside to segment-local seconds", () => {
    expect(win(place({ startTimeSec: 11, durationSec: 2 }))).toEqual({ startSec: 1, endSec: 3 });
  });

  it("clips one straddling the segment start", () => {
    expect(win(place({ startTimeSec: 8, durationSec: 4 }))).toEqual({ startSec: 0, endSec: 2 });
  });

  it("clips one straddling the segment end", () => {
    expect(win(place({ startTimeSec: 13, durationSec: 4 }))).toEqual({ startSec: 3, endSec: 4 });
  });

  it("spans the whole segment when it encloses it", () => {
    expect(win(place({ startTimeSec: 0, durationSec: 100 }))).toEqual({ startSec: 0, endSec: 4 });
  });

  it("is null when entirely before or after", () => {
    expect(win(place({ startTimeSec: 0, durationSec: 5 }))).toBeNull();
    expect(win(place({ startTimeSec: 20, durationSec: 5 }))).toBeNull();
  });

  it("is null when it merely touches a boundary", () => {
    // Ends exactly at the segment start, or starts exactly at its end.
    expect(win(place({ startTimeSec: 6, durationSec: 4 }))).toBeNull();
    expect(win(place({ startTimeSec: 14, durationSec: 2 }))).toBeNull();
  });
});

describe("beatSpans", () => {
  it("walks beats cumulatively in cut time", () => {
    expect(beatSpans([{ durationSec: 2 }, { durationSec: 3 }, { durationSec: 1 }])).toEqual([
      { startSec: 0, durationSec: 2 },
      { startSec: 2, durationSec: 3 },
      { startSec: 5, durationSec: 1 },
    ]);
  });

  it("is empty for no beats", () => {
    expect(beatSpans([])).toEqual([]);
  });

  it("treats a missing duration as zero rather than NaN", () => {
    const spans = beatSpans([{ durationSec: 0 }, { durationSec: 2 }]);
    expect(spans[1].startSec).toBe(0);
    expect(spans.every((s) => Number.isFinite(s.startSec))).toBe(true);
  });
});

describe("resolveSticker (fit to beat)", () => {
  const spans = beatSpans([{ durationSec: 2 }, { durationSec: 3 }, { durationSec: 1 }]);

  it("leaves a free sticker exactly as it is", () => {
    const st = place({ startTimeSec: 2.5, durationSec: 0.4 });
    expect(resolveSticker(st, spans)).toBe(st);
  });

  it("expands a fitToBeat sticker to the beat it starts in", () => {
    const st = place({ startTimeSec: 2.5, durationSec: 0.4, fitToBeat: true });
    const r = resolveSticker(st, spans);
    expect(r.startTimeSec).toBe(2);
    expect(r.durationSec).toBe(3);
  });

  it("uses the FIRST beat when the sticker starts at zero", () => {
    const r = resolveSticker(place({ startTimeSec: 0, fitToBeat: true }), spans);
    expect(r.startTimeSec).toBe(0);
    expect(r.durationSec).toBe(2);
  });

  it("picks by start time, so a long sticker still anchors to one beat", () => {
    const r = resolveSticker(place({ startTimeSec: 0.5, durationSec: 100, fitToBeat: true }), spans);
    expect(r.durationSec).toBe(2);
  });

  it("falls back to the last beat when the start is past the cut", () => {
    const r = resolveSticker(place({ startTimeSec: 99, fitToBeat: true }), spans);
    expect(r.startTimeSec).toBe(5);
    expect(r.durationSec).toBe(1);
  });

  it("is inert with no beats at all", () => {
    const st = place({ startTimeSec: 1, fitToBeat: true });
    expect(resolveSticker(st, [])).toBe(st);
  });

  it("does not mutate the sticker it resolves", () => {
    const st = place({ startTimeSec: 2.5, durationSec: 0.4, fitToBeat: true });
    resolveSticker(st, spans);
    expect(st.startTimeSec).toBe(2.5);
    expect(st.durationSec).toBe(0.4);
  });

  it("follows a retrimmed beat instead of going stale", () => {
    // The reason this is derived and not written back: the same sticker resolves
    // differently once its beat changes length.
    const st = place({ startTimeSec: 2.5, fitToBeat: true });
    const retrimmed = beatSpans([{ durationSec: 2 }, { durationSec: 8 }, { durationSec: 1 }]);
    expect(resolveSticker(st, retrimmed).durationSec).toBe(8);
  });

  it("makes a fitToBeat sticker active across its whole beat", () => {
    const st = place({ startTimeSec: 2.5, durationSec: 0.2, fitToBeat: true });
    const resolved = resolveStickers([st], spans);
    expect(activeStickers(resolved, 2.0)).toHaveLength(1);
    expect(activeStickers(resolved, 4.9)).toHaveLength(1);
    expect(activeStickers(resolved, 5.0)).toHaveLength(0);
  });
});

describe("stickerTint", () => {
  it("is off by default, so an untouched sticker keeps its own colours", () => {
    expect(stickerTint(place())).toEqual({ color: "#ffffff", strength: 0 });
  });

  it("passes a chosen colour and strength through", () => {
    expect(stickerTint(place({ tintColor: "#ff3b30", tintStrength: 0.6 })))
      .toEqual({ color: "#ff3b30", strength: 0.6 });
  });

  it("clamps strength to 0..1", () => {
    expect(stickerTint(place({ tintStrength: 5 })).strength).toBe(1);
    expect(stickerTint(place({ tintStrength: -2 })).strength).toBe(0);
  });

  it("falls back to white for an empty or missing colour", () => {
    expect(stickerTint(place({ tintColor: "" })).color).toBe("#ffffff");
    expect(stickerTint(place({ tintStrength: 1 })).color).toBe("#ffffff");
  });
});

describe("stickerRenderKey", () => {
  // The regression this guards: the preview memoised its bitmap on a hand-listed
  // set of fields, tint was added without updating it, and changing the colour
  // silently did nothing.
  const base = place();

  it("is stable for an unchanged sticker", () => {
    expect(stickerRenderKey(base)).toBe(stickerRenderKey(place()));
  });

  it("changes when ANY field the renderer reads changes", () => {
    const variants: [string, Partial<Sticker>][] = [
      ["fileName", { fileName: "other.png" }],
      ["x", { x: 0.4 }],
      ["y", { y: 0.4 }],
      ["scale", { scale: 0.3 }],
      ["rotation", { rotation: 12 }],
      ["opacity", { opacity: 0.5 }],
      ["tintColor", { tintColor: "#ff3b30" }],
      ["tintStrength", { tintStrength: 0.7 }],
    ];
    for (const [field, over] of variants) {
      expect(stickerRenderKey(place(over)), `${field} must change the key`)
        .not.toBe(stickerRenderKey(base));
    }
  });

  it("ignores what does not change the bitmap", () => {
    // Timing does not affect pixels, and fitToBeat only shifts the window.
    expect(stickerRenderKey(place({ startTimeSec: 9, durationSec: 9 }))).toBe(stickerRenderKey(base));
    expect(stickerRenderKey(place({ fitToBeat: true }))).toBe(stickerRenderKey(base));
  });

  it("distinguishes two stickers of the same asset", () => {
    expect(stickerRenderKey(place({ id: "a" }))).not.toBe(stickerRenderKey(place({ id: "b" })));
  });
});

describe("maxStickerStart", () => {
  it("bounds a free sticker by its own length", () => {
    expect(maxStickerStart(place({ durationSec: 2 }), 10)).toBe(8);
  });

  it("bounds a fitToBeat sticker only by the end of the cut", () => {
    // Bounding it by its stored duration pinned it inside its current beat and
    // made it undraggable — which defeated the point of dragging it.
    expect(maxStickerStart(place({ durationSec: 2, fitToBeat: true }), 10)).toBeCloseTo(9.95, 6);
  });

  it("lets a pinned sticker reach beats past its stored length", () => {
    const spans = beatSpans([{ durationSec: 3 }, { durationSec: 3 }, { durationSec: 4 }]);
    const st = place({ startTimeSec: 0.5, durationSec: 1, fitToBeat: true });
    // Dragging to 7s is allowed, and lands it in the third beat.
    expect(maxStickerStart(st, 10)).toBeGreaterThan(7);
    expect(resolveSticker({ ...st, startTimeSec: 7 }, spans)).toMatchObject({ startTimeSec: 6, durationSec: 4 });
  });

  it("never returns a negative bound on a degenerate cut", () => {
    expect(maxStickerStart(place({ durationSec: 5 }), 1)).toBe(0);
    expect(maxStickerStart(place({ fitToBeat: true }), 0)).toBe(0);
  });
});
