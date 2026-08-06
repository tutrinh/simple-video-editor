import { describe, expect, it } from "vitest";
import type { Veil } from "../../domain/types";
import { DEFAULT_VEIL, drawVeil, veilEndpoints, veilRgba } from "./veil";

describe("veilEndpoints", () => {
  it("runs top to bottom for 'down', so the from-stop is the top edge", () => {
    expect(veilEndpoints("down", 1080, 1920)).toEqual([0, 0, 0, 1920]);
  });

  it("makes 'up' the exact reverse of 'down'", () => {
    const [x0, y0, x1, y1] = veilEndpoints("down", 1080, 1920);
    expect(veilEndpoints("up", 1080, 1920)).toEqual([x1, y1, x0, y0]);
  });

  it("makes 'left' the exact reverse of 'right'", () => {
    const [x0, y0, x1, y1] = veilEndpoints("right", 1920, 1080);
    expect(veilEndpoints("left", 1920, 1080)).toEqual([x1, y1, x0, y0]);
  });

  it("spans the full edge in every aspect", () => {
    for (const [w, h] of [[1920, 1080], [1080, 1920], [1080, 1080], [1080, 1350]]) {
      expect(veilEndpoints("down", w, h)).toEqual([0, 0, 0, h]);
      expect(veilEndpoints("right", w, h)).toEqual([0, 0, w, 0]);
    }
  });

  it("keeps a vertical gradient vertical and a horizontal one horizontal", () => {
    // A gradient that drifts diagonally is the classic sign of swapped
    // coordinates, and it reads as a mistake rather than a style.
    const [, y0v, , y1v] = veilEndpoints("down", 1080, 1920);
    const [x0v, , x1v] = veilEndpoints("down", 1080, 1920);
    expect(x0v).toBe(x1v);
    expect(y0v).not.toBe(y1v);

    const [, y0h, , y1h] = veilEndpoints("right", 1920, 1080);
    expect(y0h).toBe(y1h);
  });
});

describe("veilRgba", () => {
  it("converts a six-digit hex", () => {
    expect(veilRgba("#ff8800", 1)).toBe("rgba(255, 136, 0, 1)");
    expect(veilRgba("#000000", 0.5)).toBe("rgba(0, 0, 0, 0.5)");
  });

  it("expands a three-digit hex", () => {
    expect(veilRgba("#f80", 1)).toBe(veilRgba("#ff8800", 1));
    expect(veilRgba("#fff", 1)).toBe("rgba(255, 255, 255, 1)");
  });

  it("tolerates a missing leading hash", () => {
    expect(veilRgba("ff8800", 1)).toBe("rgba(255, 136, 0, 1)");
  });

  it("clamps opacity into 0..1", () => {
    expect(veilRgba("#000000", 5)).toBe("rgba(0, 0, 0, 1)");
    expect(veilRgba("#000000", -2)).toBe("rgba(0, 0, 0, 0)");
    expect(veilRgba("#000000", NaN)).toBe("rgba(0, 0, 0, 0)");
  });

  it("falls back to black on junk rather than producing an invalid fill", () => {
    // An invalid fillStyle is silently ignored by canvas, which would show as
    // "the Veil did nothing" — worse to debug than a wrong colour.
    expect(veilRgba("", 0.5)).toBe("rgba(0, 0, 0, 0.5)");
    expect(veilRgba("not-a-colour", 0.5)).toBe("rgba(0, 0, 0, 0.5)");
  });
});

// A recording stub, so drawVeil's behaviour is assertable without a canvas.
interface Recorded {
  calls: string[];
  fillStyle: unknown;
  stops: [number, string][];
  rects: number[][];
}

function fakeCtx(): { ctx: CanvasRenderingContext2D; rec: Recorded } {
  const rec: Recorded = { calls: [], fillStyle: null, stops: [], rects: [] };
  const gradient = {
    addColorStop: (o: number, c: string) => { rec.stops.push([o, c]); },
  };
  const ctx = {
    save: () => rec.calls.push("save"),
    restore: () => rec.calls.push("restore"),
    createLinearGradient: (...args: number[]) => {
      rec.calls.push(`gradient(${args.join(",")})`);
      return gradient;
    },
    fillRect: (...args: number[]) => { rec.calls.push("fillRect"); rec.rects.push(args); },
    set fillStyle(v: unknown) { rec.fillStyle = v; rec.calls.push("fillStyle"); },
    get fillStyle() { return rec.fillStyle; },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, rec };
}

const solid: Veil = { mode: "solid", color: "#ff0000", opacity: 0.4, toColor: "#000000", toOpacity: 1, direction: "down" };

describe("drawVeil", () => {
  it("does nothing when there is no Veil", () => {
    const { ctx, rec } = fakeCtx();
    drawVeil(ctx, undefined, 1080, 1920);
    expect(rec.calls).toEqual([]);
  });

  it("fills the whole frame in solid mode, with no gradient", () => {
    const { ctx, rec } = fakeCtx();
    drawVeil(ctx, solid, 1080, 1920);
    expect(rec.fillStyle).toBe("rgba(255, 0, 0, 0.4)");
    expect(rec.rects).toEqual([[0, 0, 1080, 1920]]);
    expect(rec.calls.some((c) => c.startsWith("gradient"))).toBe(false);
  });

  it("ignores the to-stop in solid mode but does not lose it", () => {
    const { ctx, rec } = fakeCtx();
    drawVeil(ctx, { ...solid, toColor: "#00ff00", toOpacity: 0.9 }, 100, 100);
    expect(rec.stops).toEqual([]);
    expect(rec.fillStyle).toBe("rgba(255, 0, 0, 0.4)");
  });

  it("builds a two-stop gradient on the direction's endpoints in linear mode", () => {
    const { ctx, rec } = fakeCtx();
    drawVeil(ctx, DEFAULT_VEIL, 1080, 1920);
    expect(rec.calls).toContain("gradient(0,0,0,1920)");
    expect(rec.stops).toEqual([
      [0, "rgba(0, 0, 0, 0)"],
      [1, "rgba(0, 0, 0, 0.8)"],
    ]);
    expect(rec.rects).toEqual([[0, 0, 1080, 1920]]);
  });

  it("puts the from-stop at offset 0 and the to-stop at 1, never reversed", () => {
    const { ctx, rec } = fakeCtx();
    drawVeil(ctx, { mode: "linear", color: "#ffffff", opacity: 1, toColor: "#000000", toOpacity: 0, direction: "up" }, 100, 200);
    expect(rec.stops[0]).toEqual([0, "rgba(255, 255, 255, 1)"]);
    expect(rec.stops[1]).toEqual([1, "rgba(0, 0, 0, 0)"]);
    // "up" reverses the endpoints, not the stops.
    expect(rec.calls).toContain("gradient(0,200,0,0)");
  });

  it("brackets its work in save/restore so it cannot leak fillStyle", () => {
    // The Stickers and Titles drawn next would otherwise inherit the Veil's fill.
    const { ctx, rec } = fakeCtx();
    drawVeil(ctx, DEFAULT_VEIL, 100, 100);
    expect(rec.calls[0]).toBe("save");
    expect(rec.calls[rec.calls.length - 1]).toBe("restore");
  });
});

describe("DEFAULT_VEIL", () => {
  it("is a bottom-darkening transparent-to-black fade", () => {
    expect(DEFAULT_VEIL.mode).toBe("linear");
    expect(DEFAULT_VEIL.direction).toBe("down");
    expect(DEFAULT_VEIL.opacity).toBe(0);
    expect(DEFAULT_VEIL.toOpacity).toBeGreaterThan(0);
  });
});
