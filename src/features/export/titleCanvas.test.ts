import { describe, expect, it } from "vitest";
import { drawTitleLayer, drawTitleLayerAsset, wrapLines, type TitleRenderLayer } from "./titleCanvas";

function fakeContext() {
  const operations: Array<{ op: string; composite: string; fill?: string }> = [];
  const ctx = {
    fillStyle: "#ffffff",
    globalCompositeOperation: "source-over",
    font: "",
    textBaseline: "middle",
    textAlign: "center",
    shadowColor: "",
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    save() { operations.push({ op: "save", composite: this.globalCompositeOperation }); },
    restore() { operations.push({ op: "restore", composite: this.globalCompositeOperation }); },
    fillRect() {
      operations.push({ op: "fillRect", composite: this.globalCompositeOperation, fill: this.fillStyle });
    },
    fillText() {
      operations.push({ op: "fillText", composite: this.globalCompositeOperation, fill: this.fillStyle });
    },
    measureText(text: string) { return { width: text.length * 20 }; },
  };
  return { ctx, operations };
}

const layer: TitleRenderLayer = {
  text: "MASK",
  canvasFamily: "sans-serif",
  cssFamily: "sans-serif",
  fontWeight: 700,
  sizePx: 120,
  color: "#ffffff",
  posX: 0,
  posY: 0,
  shadow: false,
};

describe("video title mask", () => {
  it("draws an opaque black matte and cuts transparent glyphs from it", async () => {
    const { ctx, operations } = fakeContext();

    await drawTitleLayerAsset(
      ctx as unknown as CanvasRenderingContext2D,
      { ...layer, maskMode: "video" },
      1920,
      1080,
    );

    expect(operations).toContainEqual({ op: "fillRect", composite: "source-over", fill: "#000000" });
    expect(operations.some((operation) =>
      operation.op === "fillText" && operation.composite === "destination-out"
    )).toBe(true);
  });

  it("uses the selected matte color", async () => {
    const { ctx, operations } = fakeContext();

    await drawTitleLayerAsset(
      ctx as unknown as CanvasRenderingContext2D,
      { ...layer, maskMode: "video", maskColor: "#ff3366" },
      1920,
      1080,
    );

    expect(operations).toContainEqual({
      op: "fillRect",
      composite: "source-over",
      fill: "#ff3366",
    });
  });
});

describe("wrapLines", () => {
  it("breaks words character-by-character when a single word exceeds maxWidth", () => {
    const ctx = {
      measureText(text: string) {
        return { width: text.length * 10 };
      },
    } as unknown as CanvasRenderingContext2D;

    // "SUMMER" has length 6 -> width 60. maxWidth is 40.
    // Should break "SUMMER" into "SUMM" (40px) and "ER" (20px).
    const lines = wrapLines(ctx, "SUMMER", 40);
    expect(lines).toEqual(["SUMM", "ER"]);
  });
});

// Rotation reaches every surface through drawTitleLayer (ADR-0008): the Cover
// canvas, the preview's drawTitleLayerAsset, and the export's
// renderTitleLayerToPng all call it, so there is nowhere for it to drift.
describe("drawTitleLayer — rotation", () => {
  function fakeCtx() {
    const ops: { op: string; args: number[] }[] = [];
    const push = (op: string, ...args: number[]) => { ops.push({ op, args }); };
    const ctx = {
      save: () => push("save"),
      restore: () => push("restore"),
      translate: (...a: number[]) => push("translate", ...a),
      rotate: (...a: number[]) => push("rotate", ...a),
      fillText: () => push("fillText"),
      measureText: () => ({ width: 100 }),
      set font(_v: string) {}, get font() { return ""; },
      set fillStyle(_v: string) {}, get fillStyle() { return ""; },
      set textBaseline(_v: string) {}, get textBaseline() { return ""; },
      set textAlign(_v: string) {}, get textAlign() { return ""; },
      set shadowColor(_v: string) {}, get shadowColor() { return ""; },
      set shadowBlur(_v: number) {}, get shadowBlur() { return 0; },
      set shadowOffsetX(_v: number) {}, get shadowOffsetX() { return 0; },
      set shadowOffsetY(_v: number) {}, get shadowOffsetY() { return 0; },
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, ops };
  }

  it("adds no transform at all when there is no rotation", async () => {
    const { ctx, ops } = fakeCtx();
    await drawTitleLayer(ctx, { ...layer, rotation: 0 }, 1080, 1920);
    expect(ops.filter((o) => o.op === "rotate")).toHaveLength(0);
  });

  it("pivots on the title's own anchor, not the frame centre", async () => {
    // An off-centre title rotated about the frame would swing across the
    // picture instead of turning in place.
    const { ctx, ops } = fakeCtx();
    await drawTitleLayer(ctx, { ...layer, rotation: 15, posX: 25, posY: -10 }, 1000, 2000);
    const t = ops.filter((o) => o.op === "translate");
    expect(t[0].args).toEqual([1000 / 2 + 250, 2000 / 2 - 200]);
    expect(ops.find((o) => o.op === "rotate")!.args[0]).toBeCloseTo((15 * Math.PI) / 180, 8);
    // and it translates back, so the glyph maths is unchanged
    expect(t[1].args).toEqual([-(1000 / 2 + 250), -(2000 / 2 - 200)]);
  });

  it("brackets the rotation so it cannot leak into whatever draws next", async () => {
    const { ctx, ops } = fakeCtx();
    await drawTitleLayer(ctx, { ...layer, rotation: 30 }, 1080, 1920);
    expect(ops[0].op).toBe("save");
    expect(ops[ops.length - 1].op).toBe("restore");
  });

  it("treats a missing rotation as none", async () => {
    const { ctx, ops } = fakeCtx();
    await drawTitleLayer(ctx, layer, 1080, 1920);
    expect(ops.filter((o) => o.op === "rotate")).toHaveLength(0);
  });
});
