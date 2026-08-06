import { describe, expect, it } from "vitest";
import type { SplitLayoutType, SplitScreenSlot } from "../../domain/types";
import { getSlotCountForLayout, slotPanOffset } from "../export/splitScreenCanvas";
import { drawSplitScreenToCanvas, slotSourceTime, splitSlotRects, type SlotSource } from "./splitScreenFrame";

const LAYOUTS: SplitLayoutType[] = ["none", "v2-stacked", "v2-side", "3-row", "3-col", "4-grid"];

describe("splitSlotRects", () => {
  it("produces exactly the slot count the rest of the app expects", () => {
    // Bound to getSlotCountForLayout rather than a local list: this is a THIRD
    // encoding of the layout, and the count is the one fact all three share.
    for (const layout of LAYOUTS) {
      expect(splitSlotRects(layout, 1920, 1080)).toHaveLength(getSlotCountForLayout(layout));
    }
  });

  it("tiles the frame exactly — no gap, no overlap, no lost pixel", () => {
    for (const layout of LAYOUTS) {
      for (const [w, h] of [[1920, 1080], [1080, 1920], [1080, 1080], [1000, 1000], [1081, 1921]]) {
        const rects = splitSlotRects(layout, w, h);
        const area = rects.reduce((sum, r) => sum + r.width * r.height, 0);
        expect(area).toBe(w * h);
        for (const r of rects) {
          expect(r.x).toBeGreaterThanOrEqual(0);
          expect(r.y).toBeGreaterThanOrEqual(0);
          expect(r.x + r.width).toBeLessThanOrEqual(w);
          expect(r.y + r.height).toBeLessThanOrEqual(h);
          expect(r.width).toBeGreaterThan(0);
          expect(r.height).toBeGreaterThan(0);
        }
      }
    }
  });

  it("leaves no seam on a dimension that does not divide evenly", () => {
    // 1000/3 rounds to 333.33 — rounding sizes would lose a pixel column and
    // show background through it. Rounding boundaries cannot.
    const rects = splitSlotRects("3-col", 1000, 500);
    expect(rects.map((r) => r.x)).toEqual([0, 333, 667]);
    expect(rects.map((r) => r.width)).toEqual([333, 334, 333]);
    expect(rects[0].width + rects[1].width + rects[2].width).toBe(1000);
  });

  it("stacks vertically for row layouts and horizontally for column layouts", () => {
    const stacked = splitSlotRects("v2-stacked", 1080, 1920);
    expect(stacked[0]).toEqual({ x: 0, y: 0, width: 1080, height: 960 });
    expect(stacked[1]).toEqual({ x: 0, y: 960, width: 1080, height: 960 });

    const side = splitSlotRects("v2-side", 1920, 1080);
    expect(side[0]).toEqual({ x: 0, y: 0, width: 960, height: 1080 });
    expect(side[1]).toEqual({ x: 960, y: 0, width: 960, height: 1080 });
  });

  it("orders a 4-grid in reading order, matching xstack's layout string", () => {
    // buildSplitScreenFilterGraph uses `0_0|w0_0|0_h0|w0_h0` — top-left,
    // top-right, bottom-left, bottom-right. A different order here would put
    // slot 2 in a different corner than the exported video does.
    const q = splitSlotRects("4-grid", 1920, 1080);
    expect(q.map((r) => [r.x, r.y])).toEqual([[0, 0], [960, 0], [0, 540], [960, 540]]);
  });

  it("gives 'none' the whole frame", () => {
    expect(splitSlotRects("none", 1920, 1080)).toEqual([{ x: 0, y: 0, width: 1920, height: 1080 }]);
  });
});

describe("slotSourceTime", () => {
  it("advances a slot from its own in-point by the Beat's progress", () => {
    expect(slotSourceTime(10, 2, 5)).toBe(13);
    expect(slotSourceTime(0, 0, 4)).toBe(4);
  });

  it("shows the in-point at the Beat's start", () => {
    expect(slotSourceTime(7, 3, 3)).toBe(7);
  });

  it("never goes negative", () => {
    expect(slotSourceTime(0, 5, 2)).toBe(0);
  });
});

// A recording stub, since canvas cannot be asserted in this environment.
interface Op { op: string; args: number[] }

function fakeCtx() {
  const ops: Op[] = [];
  const push = (op: string, ...args: number[]) => { ops.push({ op, args }); };
  const ctx = {
    save: () => push("save"),
    restore: () => push("restore"),
    beginPath: () => push("beginPath"),
    rect: (...a: number[]) => push("rect", ...a),
    clip: () => push("clip"),
    fillRect: (...a: number[]) => push("fillRect", ...a),
    translate: (...a: number[]) => push("translate", ...a),
    scale: (...a: number[]) => push("scale", ...a),
    rotate: (...a: number[]) => push("rotate", ...a),
    drawImage: (_img: unknown, ...a: number[]) => push("drawImage", ...a),
    set fillStyle(_v: unknown) { push("fillStyle"); },
    get fillStyle() { return "#000000"; },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, ops };
}

const source = (width = 1920, height = 1080): SlotSource => ({ image: {} as CanvasImageSource, width, height });
const slot = (over: Partial<SplitScreenSlot> = {}): SplitScreenSlot => ({ clipId: "c", inSec: 0, ...over });

describe("drawSplitScreenToCanvas", () => {
  it("clips and backs every slot, even one with no source", () => {
    const { ctx, ops } = fakeCtx();
    drawSplitScreenToCanvas(ctx, "v2-side", [slot(), slot()], [source(), undefined], 1920, 1080);
    expect(ops.filter((o) => o.op === "clip")).toHaveLength(2);
    // Both slots get their black backing; the empty one reads as empty rather
    // than showing what the first slot spilled.
    expect(ops.filter((o) => o.op === "fillRect")).toHaveLength(2);
    expect(ops.filter((o) => o.op === "drawImage")).toHaveLength(1);
    expect(ops.filter((o) => o.op === "save")).toHaveLength(2);
    expect(ops.filter((o) => o.op === "restore")).toHaveLength(2);
  });

  it("issues the transform in the CSS order: origin, scale, translate, rotate", () => {
    // `transform: scale() translate() rotate()` about centre. Re-ordering these
    // silently changes where a panned, scaled slot lands.
    const { ctx, ops } = fakeCtx();
    drawSplitScreenToCanvas(
      ctx, "v2-side",
      [slot({ scale: 2, panX: 10, panY: -20, rotation: 90 }), slot()],
      [source(), undefined], 1920, 1080,
    );
    const seq = ops.map((o) => o.op);
    const first = seq.indexOf("translate");
    expect(seq.slice(first, first + 4)).toEqual(["translate", "scale", "translate", "rotate"]);

    const t = ops.filter((o) => o.op === "translate");
    expect(t[0].args).toEqual([480, 540]);        // slot centre
    expect(t[1].args).toEqual([96, -216]);        // pan as a % of the SLOT, not the frame
    expect(ops.find((o) => o.op === "scale")!.args).toEqual([2, 2]);
    expect(ops.find((o) => o.op === "rotate")!.args[0]).toBeCloseTo(Math.PI / 2, 6);
  });

  it("honours panX/panY, as the preview and the encoder now both do", () => {
    // Was ARCHITECTURE_BACKLOG defect 3, since fixed: the ffmpeg path discarded
    // pan entirely. All three agree now; the test below binds this to the
    // encoder's own arithmetic.
    const { ctx, ops } = fakeCtx();
    drawSplitScreenToCanvas(ctx, "v2-side", [slot({ panX: 25 }), slot()], [source(), undefined], 1920, 1080);
    const pan = ops.filter((o) => o.op === "translate")[1];
    expect(pan.args[0]).toBeCloseTo(240, 6); // 25% of the 960-wide slot
  });

  it("defaults an untouched slot to no transform at all", () => {
    const { ctx, ops } = fakeCtx();
    drawSplitScreenToCanvas(ctx, "v2-side", [slot(), slot()], [source(), source()], 1920, 1080);
    expect(ops.filter((o) => o.op === "scale").every((o) => o.args[0] === 1)).toBe(true);
    expect(ops.filter((o) => o.op === "rotate").every((o) => o.args[0] === 0)).toBe(true);
  });

  it("cover-fits the source into its slot rather than squashing it", () => {
    // A 1920x1080 source in a 960x1080 slot keeps full height and crops width.
    const { ctx, ops } = fakeCtx();
    drawSplitScreenToCanvas(ctx, "v2-side", [slot(), slot()], [source(1920, 1080), undefined], 1920, 1080);
    const [sx, sy, sw, sh, dx, dy, dw, dh] = ops.find((o) => o.op === "drawImage")!.args;
    expect(sh).toBe(1080);
    expect(Math.round(sw)).toBe(960);
    expect(Math.round(sx)).toBe(480);
    expect(sy).toBe(0);
    expect([dx, dy, dw, dh]).toEqual([-480, -540, 960, 1080]);
  });
});

describe("the canvas and the encoder agree on pan", () => {
  // ARCHITECTURE_BACKLOG defect 3 existed because two implementations of one
  // idea drifted. There are now three (ADR-0021), so the agreement is asserted
  // rather than assumed: the canvas applies pan INSIDE ctx.scale, so its
  // effective displacement is the translate argument times the scale — which is
  // exactly what slotPanOffset computes for the filtergraph.
  it("produces the same effective displacement as slotPanOffset", () => {
    for (const s of [
      { panX: 25, panY: 0, scale: 1 },
      { panX: 10, panY: -20, scale: 2 },
      { panX: -50, panY: 50, scale: 1.5 },
      { panX: 0, panY: 0, scale: 1 },
    ]) {
      const { ctx, ops } = fakeCtx();
      drawSplitScreenToCanvas(
        ctx, "v2-side", [slot(s), slot()], [source(), undefined], 1920, 1080,
      );
      const translates = ops.filter((o) => o.op === "translate");
      const scaleOp = ops.find((o) => o.op === "scale")!;
      const canvasDx = translates[1].args[0] * scaleOp.args[0];
      const canvasDy = translates[1].args[1] * scaleOp.args[1];

      const encoder = slotPanOffset(s, 960, 1080);
      expect(Math.round(canvasDx)).toBe(encoder.dx);
      expect(Math.round(canvasDy)).toBe(encoder.dy);
    }
  });
});
