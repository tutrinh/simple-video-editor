import { describe, expect, it } from "vitest";
import type { OverlayClip } from "../../domain/types";
import { overlayColorLutForExport } from "./export";

const overlay: OverlayClip = {
  id: "ov",
  clipId: "clip",
  startTimeSec: 0,
  durationSec: 2,
  inSec: 0,
  outSec: 2,
  blendMode: "normal",
  opacity: 1,
  volume: 0,
  colorAdjustments: { exposure: 20, warmth: -15, saturation: 10 },
};

describe("overlay color export", () => {
  it("bakes the overlay grade through the shared 3D LUT generator", () => {
    const lut = overlayColorLutForExport(overlay, 3);
    expect(lut?.input.name).toBe("overlay_grade_3.cube");
    expect(lut?.filter).toBe("lut3d=overlay_grade_3.cube");
    expect(lut?.input.data.byteLength).toBeGreaterThan(100);
  });
});
