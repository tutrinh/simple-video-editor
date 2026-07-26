import { describe, it, expect } from "vitest";
import { kenBurnsAt, coverScale, fillMove, kenBurnsPreScale, kenBurnsChain, kenBurnsVisibleCenter, kenBurnsTransform, kenBurnsStyleAt, kenBurnsKeyframes, KEN_BURNS_PRESETS, KEN_BURNS_DEFAULT } from "./util";
import type { KenBurns } from "../domain/types";

// kenBurnsAt is THE contract (ADR-0015): it generates the preview's keyframes,
// is sampled while scrubbing, and the export emits zoompan from the same move.
// If these drift, preview and export drift.

const move: KenBurns = { fromScale: 1.0, fromX: -10, fromY: 20, toScale: 1.5, toX: 30, toY: -40 };

describe("kenBurnsAt", () => {
  it("is the start state at t=0 and the end state at t=1", () => {
    expect(kenBurnsAt(move, 0)).toEqual({ scale: 1.0, x: -10, y: 20 });
    expect(kenBurnsAt(move, 1)).toEqual({ scale: 1.5, x: 30, y: -40 });
  });

  it("is exactly halfway at the midpoint", () => {
    const m = kenBurnsAt(move, 0.5);
    expect(m.scale).toBeCloseTo(1.25, 10);
    expect(m.x).toBeCloseTo(10, 10);
    expect(m.y).toBeCloseTo(-10, 10);
  });

  it("is linear — equal steps of t give equal steps of value", () => {
    // The property that lets CSS `linear` and zoompan's frame arithmetic agree
    // by construction instead of by sampling a curve.
    const d1 = kenBurnsAt(move, 0.25).scale - kenBurnsAt(move, 0.0).scale;
    const d2 = kenBurnsAt(move, 0.50).scale - kenBurnsAt(move, 0.25).scale;
    const d3 = kenBurnsAt(move, 0.75).scale - kenBurnsAt(move, 0.50).scale;
    const d4 = kenBurnsAt(move, 1.00).scale - kenBurnsAt(move, 0.75).scale;
    for (const d of [d2, d3, d4]) expect(d).toBeCloseTo(d1, 10);
  });

  it("clamps outside 0..1 rather than extrapolating", () => {
    // A rAF clock can overshoot by a frame; the move must not fly past its end.
    expect(kenBurnsAt(move, 1.4)).toEqual(kenBurnsAt(move, 1));
    expect(kenBurnsAt(move, -0.3)).toEqual(kenBurnsAt(move, 0));
  });

  it("survives a non-finite t instead of producing NaN geometry", () => {
    expect(kenBurnsAt(move, NaN)).toEqual(kenBurnsAt(move, 0));
    expect(kenBurnsAt(move, Infinity)).toEqual(kenBurnsAt(move, 0));
  });

  it("holds still for a degenerate move", () => {
    const still: KenBurns = { fromScale: 1.2, fromX: 5, fromY: 5, toScale: 1.2, toX: 5, toY: 5 };
    for (const t of [0, 0.3, 0.7, 1]) {
      expect(kenBurnsAt(still, t)).toEqual({ scale: 1.2, x: 5, y: 5 });
    }
  });

  it("interpolates focus independently of scale", () => {
    // A pure drift holds its scale; a pure push holds its focus.
    const drift: KenBurns = { fromScale: 1.2, fromX: -20, fromY: 0, toScale: 1.2, toX: 20, toY: 0 };
    expect(kenBurnsAt(drift, 0.5)).toEqual({ scale: 1.2, x: 0, y: 0 });
    const push: KenBurns = { fromScale: 1.0, fromX: 7, fromY: -3, toScale: 2.0, toX: 7, toY: -3 };
    expect(kenBurnsAt(push, 0.5)).toEqual({ scale: 1.5, x: 7, y: -3 });
  });
});

describe("coverScale", () => {
  it("is 1 when the aspects already match", () => {
    expect(coverScale(1920, 1080, 1920, 1080)).toBe(1);
    expect(coverScale(3840, 2160, 1920, 1080)).toBe(1); // same aspect, different size
    expect(coverScale(1080, 1080, 720, 720)).toBe(1);
  });

  it("gives ~2.37 for a 3:4 portrait in a 16:9 canvas", () => {
    // The figure ADR-0015 cites as the reason the zoom ceiling cannot be a flat 2x.
    expect(coverScale(3, 4, 16, 9)).toBeCloseTo(2.370, 3);
    expect(coverScale(3000, 4000, 1920, 1080)).toBeCloseTo(2.370, 3);
  });

  it("handles landscape in portrait", () => {
    // 16:9 source into a 9:16 canvas needs the same factor by symmetry.
    expect(coverScale(16, 9, 9, 16)).toBeCloseTo(coverScale(9, 16, 16, 9), 10);
    expect(coverScale(1920, 1080, 1080, 1920)).toBeCloseTo(3.160, 3);
  });

  it("handles square in both orientations", () => {
    expect(coverScale(1000, 1000, 1920, 1080)).toBeCloseTo(16 / 9, 6);
    expect(coverScale(1000, 1000, 1080, 1920)).toBeCloseTo(16 / 9, 6);
  });

  it("is never below 1 — covering only ever needs scaling up", () => {
    for (const [w, h] of [[100, 1], [1, 100], [1234, 5678], [4000, 3000]]) {
      expect(coverScale(w, h, 1920, 1080), `${w}x${h}`).toBeGreaterThanOrEqual(1);
    }
  });

  it("degrades to 1 on degenerate dimensions rather than dividing by zero", () => {
    for (const args of [[0, 100], [100, 0], [-5, 10]] as [number, number][]) {
      expect(coverScale(args[0], args[1], 1920, 1080)).toBe(1);
    }
    expect(coverScale(100, 100, 0, 0)).toBe(1);
  });
});

describe("fillMove", () => {
  it("holds at the cover scale, centred — a framing, not a journey", () => {
    const m = fillMove(3000, 4000, 1920, 1080);
    expect(m.fromScale).toBeCloseTo(2.370, 3);
    expect(m.toScale).toBe(m.fromScale);
    expect([m.fromX, m.fromY, m.toX, m.toY]).toEqual([0, 0, 0, 0]);
  });

  it("is a no-op move when the aspects match", () => {
    expect(fillMove(1920, 1080, 1920, 1080)).toEqual({ fromScale: 1, fromX: 0, fromY: 0, toScale: 1, toX: 0, toY: 0 });
  });
});

describe("the preset table", () => {
  it("every preset starts and ends at a sane scale", () => {
    for (const p of KEN_BURNS_PRESETS) {
      for (const s of [p.move.fromScale, p.move.toScale]) {
        expect(s, p.id).toBeGreaterThanOrEqual(1);
        expect(s, p.id).toBeLessThanOrEqual(2);
      }
    }
  });

  it("every preset actually moves", () => {
    // A preset that holds still is a Zoom wearing the wrong name.
    for (const p of KEN_BURNS_PRESETS) {
      const start = kenBurnsAt(p.move, 0);
      const end = kenBurnsAt(p.move, 1);
      expect(start, p.id).not.toEqual(end);
    }
  });

  it("a drift stays within the frame it has punched into", () => {
    // Focus is -50..50; drifting to the edge at only 1.15x would show background.
    for (const p of KEN_BURNS_PRESETS) {
      for (const v of [p.move.fromX, p.move.fromY, p.move.toX, p.move.toY]) {
        expect(Math.abs(v), p.id).toBeLessThanOrEqual(50);
      }
    }
  });

  it("has unique ids and defaults to Push In", () => {
    expect(new Set(KEN_BURNS_PRESETS.map((p) => p.id)).size).toBe(KEN_BURNS_PRESETS.length);
    expect(KEN_BURNS_DEFAULT).toEqual({ fromScale: 1.0, fromX: 0, fromY: 0, toScale: 1.15, toX: 0, toY: 0 });
  });
});

// --- Export chain (ADR-0015, corrected by the Task 1 spike) -----------------

describe("kenBurnsPreScale", () => {
  it("targets 2x canvas width when the source has the pixels", () => {
    const p = kenBurnsPreScale(1920, 1080, 6000, 3375);
    expect(p.scale).toBe(2);
    expect(p).toMatchObject({ w: 3840, h: 2160 });
  });

  it("never upscales past the source's own pixels", () => {
    // A 1000px-wide source contained in 1920 is already being upscaled at 1.0;
    // asking for 2x would invent detail and cost time for nothing.
    const p = kenBurnsPreScale(1920, 1080, 1000, 563);
    expect(p.scale).toBeLessThan(2);
    expect(p.w).toBeLessThan(3840);
  });

  it("is at least 1x — never smaller than the canvas", () => {
    for (const [sw, sh] of [[100, 100], [10, 4000], [1, 1]]) {
      const p = kenBurnsPreScale(1920, 1080, sw, sh);
      expect(p.scale, `${sw}x${sh}`).toBeGreaterThanOrEqual(1);
      expect(p.w).toBeGreaterThanOrEqual(1920);
    }
  });

  it("keeps the canvas aspect, not the source's", () => {
    // The pre-render contains and pads, so zoompan can output canvas dims direct.
    const p = kenBurnsPreScale(1080, 1920, 6000, 3375);
    expect(p.w / p.h).toBeCloseTo(1080 / 1920, 6);
  });

  it("degrades to canvas size on degenerate input", () => {
    expect(kenBurnsPreScale(1920, 1080, 0, 0)).toEqual({ w: 1920, h: 1080, scale: 1 });
  });
});

describe("kenBurnsChain", () => {
  const m: KenBurns = { fromScale: 1, fromX: 0, fromY: 0, toScale: 1.5, toX: 20, toY: -10 };

  it("emits exactly one zoompan and NO scale", () => {
    // The regression guard for Task 1's finding: a `scale` here runs once per
    // frame and made the whole thing slower than doing nothing.
    const chain = kenBurnsChain(1920, 1080, m, 10);
    expect(chain).toHaveLength(1);
    expect(chain[0]).toContain("zoompan=");
    expect(chain.join(",")).not.toContain("scale=");
  });

  it("outputs canvas dimensions directly", () => {
    expect(kenBurnsChain(1920, 1080, m, 10)[0]).toContain("s=1920x1080");
    expect(kenBurnsChain(1080, 1920, m, 10)[0]).toContain("s=1080x1920");
  });

  it("runs the zoom expression over the right number of frames", () => {
    // 10s @ 30fps = 300 frames, so the last index is 299.
    expect(kenBurnsChain(1920, 1080, m, 10)[0]).toContain("on/299");
    expect(kenBurnsChain(1920, 1080, m, 4)[0]).toContain("on/119");
  });

  it("starts at fromScale and ends at toScale", () => {
    // Evaluate the emitted expression the way ffmpeg would.
    const chain = kenBurnsChain(1920, 1080, m, 10)[0];
    const zExpr = /z='([^']+)'/.exec(chain)![1];
    const evalAt = (on: number) => Function("on", `return ${zExpr}`)(on);
    expect(evalAt(0)).toBeCloseTo(1.0, 10);
    expect(evalAt(299)).toBeCloseTo(1.5, 10);
    expect(evalAt(149.5)).toBeCloseTo(1.25, 10);
  });

  it("agrees with kenBurnsAt — the whole point of one contract", () => {
    // Preview and export must not interpolate separately (ADR-0015).
    const chain = kenBurnsChain(1920, 1080, m, 10)[0];
    const zExpr = /z='([^']+)'/.exec(chain)![1];
    const evalAt = (on: number) => Function("on", `return ${zExpr}`)(on);
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      expect(evalAt(t * 299)).toBeCloseTo(kenBurnsAt(m, t).scale, 9);
    }
  });

  it("tracks focus, converting -50..50 into a crop origin", () => {
    // Evaluate x the way ffmpeg would, binding its iw/zoom variables.
    const chain = kenBurnsChain(1920, 1080, m, 10)[0];
    const xExpr = /x='([^']+)'/.exec(chain)![1];
    const xAt = (on: number, iw: number, zoom: number) =>
      Function("on", "iw", "zoom", `return ${xExpr}`)(on, iw, zoom);

    // Centred at the start (fromX = 0): half the leftover space either side.
    expect(xAt(0, 3840, 1)).toBeCloseTo(0, 9);
    expect(xAt(0, 3840, 2)).toBeCloseTo((3840 - 1920) * 0.5, 9);
    // At the end, toX = 20 maps to 0.7 of the leftover space.
    expect(xAt(299, 3840, 1.5)).toBeCloseTo((3840 - 3840 / 1.5) * 0.7, 9);

    // ...and y is the same shape on the vertical axis.
    const yExpr = /y='([^']+)'/.exec(chain)![1];
    const yAt = (on: number, ih: number, zoom: number) =>
      Function("on", "ih", "zoom", `return ${yExpr}`)(on, ih, zoom);
    // toY = -10 maps to 0.4 — above centre.
    expect(yAt(299, 2160, 1.5)).toBeCloseTo((2160 - 2160 / 1.5) * 0.4, 9);
  });

  it("keeps the crop inside the frame at every point of the move", () => {
    // x + iw/zoom must never exceed iw, or zoompan samples off the edge.
    for (const p of KEN_BURNS_PRESETS) {
      const chain = kenBurnsChain(1920, 1080, p.move, 10)[0];
      const xExpr = /x='([^']+)'/.exec(chain)![1];
      const zExpr = /z='([^']+)'/.exec(chain)![1];
      for (const on of [0, 75, 150, 225, 299]) {
        const zoom = Function("on", `return ${zExpr}`)(on);
        const x = Function("on", "iw", "zoom", `return ${xExpr}`)(on, 3840, zoom);
        expect(x, `${p.id} @${on}`).toBeGreaterThanOrEqual(-1e-9);
        expect(x + 3840 / zoom, `${p.id} @${on}`).toBeLessThanOrEqual(3840 + 1e-9);
      }
    }
  });

  it("collapses a constant axis to a literal instead of a lerp", () => {
    // fromX === toX === 0 should not emit `(0+(0-0)*on/299)`.
    const chain = kenBurnsChain(1920, 1080, { fromScale: 1, fromX: 0, fromY: 0, toScale: 1.2, toX: 0, toY: 0 }, 10)[0];
    expect(chain).toContain("x='(iw-iw/zoom)*(0.5+0/100)'");
  });

  it("never divides by zero on a degenerate duration", () => {
    for (const dur of [0, -5, 0.001]) {
      const chain = kenBurnsChain(1920, 1080, m, dur)[0];
      expect(chain, String(dur)).not.toContain("on/0");
      expect(chain).not.toContain("NaN");
    }
  });
});

// --- Preview/export agreement (the whole point of ADR-0015) -----------------

describe("kenBurnsVisibleCenter", () => {
  it("is the frame centre at 1x, whatever the focus", () => {
    // At 1x there is no slack to pan into, so focus cannot move anything.
    for (const f of [-50, -10, 0, 25, 50]) {
      expect(kenBurnsVisibleCenter(1, f), String(f)).toBeCloseTo(0.5, 10);
    }
  });

  it("puts a full-right focus flush against the right edge, not past it", () => {
    // zoompan's x is the crop's LEFT edge in the leftover space: focus 50 at 2x
    // spans 0.5..1.0, so its CENTRE is 0.75. Centring on 1.0 would show a
    // different picture -- this is the CSS/ffmpeg disagreement the fn prevents.
    expect(kenBurnsVisibleCenter(2, 50)).toBeCloseTo(0.75, 10);
    expect(kenBurnsVisibleCenter(2, -50)).toBeCloseTo(0.25, 10);
  });

  it("keeps the visible region inside the frame at any scale and focus", () => {
    for (const z of [1, 1.15, 1.5, 2, 2.4]) {
      for (const f of [-50, -20, 0, 20, 50]) {
        const c = kenBurnsVisibleCenter(z, f);
        expect(c - 1 / (2 * z), `${z}/${f}`).toBeGreaterThanOrEqual(-1e-9);
        expect(c + 1 / (2 * z), `${z}/${f}`).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });

  it("AGREES WITH THE EXPORT — same visible centre as the emitted zoompan crop", () => {
    // The regression guard for the bug class that shipped rotation inverted.
    const m: KenBurns = { fromScale: 1, fromX: -30, fromY: 10, toScale: 2, toX: 40, toY: -25 };
    const chain = kenBurnsChain(1920, 1080, m, 10)[0];
    const zExpr = /z='([^']+)'/.exec(chain)![1];
    const xExpr = /x='([^']+)'/.exec(chain)![1];
    const IW = 3840;

    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const on = t * 299;
      const zoom = Function("on", `return ${zExpr}`)(on);
      const cropX = Function("on", "iw", "zoom", `return ${xExpr}`)(on, IW, zoom);
      // ffmpeg's visible centre, as a fraction of the source.
      const ffmpegCentre = (cropX + IW / zoom / 2) / IW;
      // ...and what the preview will centre on for the same instant.
      const previewCentre = kenBurnsVisibleCenter(zoom, kenBurnsAt(m, t).x);
      expect(previewCentre, `t=${t}`).toBeCloseTo(ffmpegCentre, 9);
    }
  });
});

describe("kenBurnsTransform", () => {
  it("is identity at 1x centred", () => {
    expect(kenBurnsTransform(1, 0, 0)).toBe("translate(0.0000%, 0.0000%) scale(1.000000)");
  });

  it("brings the focused point to the centre of the viewport", () => {
    // Parse the transform back and apply it to the visible centre; it must land
    // on 0.5 of the element.
    const check = (z: number, f: number) => {
      const t = kenBurnsTransform(z, f, 0);
      const tx = Number(/translate\(([-\d.]+)%/.exec(t)![1]) / 100;
      const c = kenBurnsVisibleCenter(z, f);
      // point c (offset c-0.5 from centre) scaled by z, then translated by tx
      return (c - 0.5) * z + tx;
    };
    for (const z of [1, 1.5, 2]) for (const f of [-50, -20, 0, 30, 50]) {
      expect(check(z, f), `${z}/${f}`).toBeCloseTo(0, 9);
    }
  });

  it("never scales below 1 — a move cannot shrink the frame and show background", () => {
    expect(kenBurnsTransform(0.5, 0, 0)).toContain("scale(1.000000)");
  });
});

describe("kenBurnsKeyframes", () => {
  it("its ends match sampling the contract at t=0 and t=1", () => {
    // Playback uses the keyframes, scrubbing samples kenBurnsAt; if these two
    // disagreed, pausing would make the picture jump.
    const m: KenBurns = { fromScale: 1.1, fromX: -12, fromY: 6, toScale: 1.8, toX: 22, toY: -18 };
    const kf = kenBurnsKeyframes(m);
    expect(kf.from).toBe(kenBurnsStyleAt(m, 0).transform);
    expect(kf.to).toBe(kenBurnsStyleAt(m, 1).transform);
  });
});
