import { describe, it, expect } from "vitest";
import { getSlotCountForLayout, normalizeSplitConfig, getSplitLayoutCss, buildSplitScreenFilterGraph, slotCropExpr, slotPanOffset } from "./splitScreenCanvas";

describe("splitScreenCanvas", () => {
  it("returns correct slot count for each layout type", () => {
    expect(getSlotCountForLayout("none")).toBe(1);
    expect(getSlotCountForLayout("v2-stacked")).toBe(2);
    expect(getSlotCountForLayout("v2-side")).toBe(2);
    expect(getSlotCountForLayout("3-row")).toBe(3);
    expect(getSlotCountForLayout("3-col")).toBe(3);
    expect(getSlotCountForLayout("4-grid")).toBe(4);
  });

  it("normalizes undefined split config to single slot", () => {
    const norm = normalizeSplitConfig(undefined, "clip-1", 1.5);
    expect(norm.layout).toBe("none");
    expect(norm.slots).toHaveLength(1);
    expect(norm.slots[0].clipId).toBe("clip-1");
  });

  it("populates missing slots with default clip when layout needs more slots", () => {
    const norm = normalizeSplitConfig({ layout: "v2-stacked", slots: [{ clipId: "c1", inSec: 0 }] }, "default-clip", 2.0);
    expect(norm.slots).toHaveLength(2);
    expect(norm.slots[0].clipId).toBe("c1");
    expect(norm.slots[1].clipId).toBe("default-clip");
    expect(norm.slots[1].volume).toBe(0);
  });

  it("generates valid FFmpeg filtergraph for vstack 2-split", () => {
    const fg = buildSplitScreenFilterGraph(
      { layout: "v2-stacked", slots: [{ clipId: "c1", inSec: 0 }, { clipId: "c2", inSec: 0 }] },
      1080,
      1920,
      0
    );
    expect(fg.outputLabel).toBe("[v_split]");
    expect(fg.filterGraph).toContain("scale=1080:960:force_original_aspect_ratio=increase:flags=fast_bilinear,crop=1080:960[split_slot_0]");

    expect(fg.filterGraph).toContain("[split_slot_0][split_slot_1]vstack=inputs=2[v_split]");
  });

  it("generates valid CSS grid properties for layouts", () => {
    const css = getSplitLayoutCss("4-grid");
    expect(css.display).toBe("grid");
    expect(css.gridTemplateColumns).toBe("1fr 1fr");
    expect(css.gridTemplateRows).toBe("1fr 1fr");
  });

  it("renders and exports a three-row vertical stack", () => {
    const css = getSplitLayoutCss("3-row");
    expect(css.gridTemplateColumns).toBe("1fr");
    expect(css.gridTemplateRows).toBe("1fr 1fr 1fr");

    const slots = ["c1", "c2", "c3"].map((clipId) => ({ clipId, inSec: 0 }));
    const fg = buildSplitScreenFilterGraph({ layout: "3-row", slots }, 1080, 1920);
    expect(fg.filterGraph).toContain("scale=1080:640:force_original_aspect_ratio=increase:flags=fast_bilinear,crop=1080:640[split_slot_0]");
    expect(fg.filterGraph).toContain("[split_slot_0][split_slot_1][split_slot_2]vstack=inputs=3[v_split]");
  });
});

// ARCHITECTURE_BACKLOG defect 3: panX/panY moved the picture in the preview and
// were silently dropped by the export. These pin the fix — and pin that an
// unpanned slot still emits exactly what it emitted before, so the change
// cannot have moved any existing output.

describe("split-screen slot pan reaches the export", () => {
  const slotOf = (over: Partial<{ panX: number; panY: number; scale: number }>) =>
    ({ clipId: "c1", inSec: 0, ...over });

  it("emits no offset at all for an unpanned slot", () => {
    expect(slotCropExpr(slotOf({}), 1080, 960)).toBeNull();
    expect(slotCropExpr(slotOf({ panX: 0, panY: 0, scale: 2 }), 1080, 960)).toBeNull();
  });

  it("keeps the filter byte-identical when nothing is panned", () => {
    const fg = buildSplitScreenFilterGraph(
      { layout: "v2-stacked", slots: [slotOf({}), slotOf({})] }, 1080, 1920,
    );
    expect(fg.filterGraph).toContain("crop=1080:960[split_slot_0]");
    expect(fg.filterGraph).not.toContain("in_w");
  });

  it("shifts the crop window opposite to the pan", () => {
    // Moving the picture right means taking the window from further left.
    const right = slotCropExpr(slotOf({ panX: 25 }), 1080, 960)!;
    expect(right.x).toBe("(in_w-out_w)/2-(270)");
    const left = slotCropExpr(slotOf({ panX: -25 }), 1080, 960)!;
    expect(left.x).toBe("(in_w-out_w)/2-(-270)");
  });

  it("scales the displacement, because the CSS scale sits outside the translate", () => {
    // A slot at 2x pans twice as far for the same slider position.
    expect(slotPanOffset(slotOf({ panX: 25 }), 1080, 960).dx).toBe(270);
    expect(slotPanOffset(slotOf({ panX: 25, scale: 2 }), 1080, 960).dx).toBe(540);
  });

  it("measures the pan against the slot, not the whole frame", () => {
    expect(slotPanOffset(slotOf({ panY: 50 }), 1080, 960).dy).toBe(480);
    expect(slotPanOffset(slotOf({ panY: 50 }), 1080, 1920).dy).toBe(960);
  });

  it("reaches the emitted filtergraph", () => {
    const fg = buildSplitScreenFilterGraph(
      { layout: "v2-side", slots: [slotOf({ panX: 25 }), slotOf({ panY: -10 })] }, 1920, 1080,
    );
    expect(fg.filterGraph).toContain("crop=960:1080:(in_w-out_w)/2-(240):(in_h-out_h)/2-(0)");
    expect(fg.filterGraph).toContain("crop=960:1080:(in_w-out_w)/2-(0):(in_h-out_h)/2-(-108)");
  });

  it("emits no comma inside an expression, which the graph parser splits on", () => {
    const fg = buildSplitScreenFilterGraph(
      { layout: "v2-side", slots: [slotOf({ panX: 25, panY: 30, scale: 1.5 }), slotOf({})] }, 1920, 1080,
    );
    for (const chain of fg.filterGraph.split(";")) {
      for (const filter of chain.split(",")) {
        // A comma landing inside an expression would leave an orphan fragment
        // with no filter name — that is what a mis-escaped graph looks like.
        expect(filter.trim()).toMatch(/^(\[[^\]]+\])*[a-z0-9_]+(=|$)/i);
      }
    }
  });

  it("holds at the edge rather than sampling outside the source", () => {
    // crop clips x/y into range itself, so an extreme pan cannot produce an
    // invalid window — it stops. The preview would show black there instead.
    const fg = buildSplitScreenFilterGraph(
      { layout: "v2-side", slots: [slotOf({ panX: 50, scale: 1 }), slotOf({})] }, 1920, 1080,
    );
    expect(fg.filterGraph).toContain("crop=960:1080:");
    expect(fg.filterGraph).not.toContain("NaN");
    expect(fg.filterGraph).not.toContain("undefined");
  });
});
