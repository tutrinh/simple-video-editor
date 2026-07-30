import { describe, expect, it } from "vitest";
import { drawTitleLayerAsset, wrapLines, type TitleRenderLayer } from "./titleCanvas";

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
