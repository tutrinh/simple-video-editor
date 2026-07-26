import { describe, it, expect } from "vitest";
import { getSlotCountForLayout, normalizeSplitConfig, getSplitLayoutCss, buildSplitScreenFilterGraph } from "./splitScreenCanvas";

describe("splitScreenCanvas", () => {
  it("returns correct slot count for each layout type", () => {
    expect(getSlotCountForLayout("none")).toBe(1);
    expect(getSlotCountForLayout("v2-stacked")).toBe(2);
    expect(getSlotCountForLayout("v2-side")).toBe(2);
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
});
