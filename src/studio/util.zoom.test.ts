import { describe, it, expect } from "vitest";
import { beatZoomStyle, ffmpegZoomFilters } from "./util";

describe("beat zoom", () => {
  it("is a no-op at 1x", () => {
    expect(beatZoomStyle(1, 0, 0)).toEqual({});
    expect(beatZoomStyle(undefined)).toEqual({});
    expect(ffmpegZoomFilters(1920, 1080, 1, 0, 0)).toEqual([]);
    expect(ffmpegZoomFilters(1920, 1080, undefined)).toEqual([]);
  });

  it("scales+crops centered by default (ffmpeg)", () => {
    expect(ffmpegZoomFilters(1920, 1080, 2, 0, 0)).toEqual([
      "scale=3840:2160",
      "crop=1920:1080:960:540",
    ]);
  });

  it("pans the crop to the edges via focus (ffmpeg)", () => {
    // focusX = 0 → left edge, cropX = 0
    expect(ffmpegZoomFilters(1920, 1080, 2, -50, 0)[1]).toBe("crop=1920:1080:0:540");
    // focusX = 1 → right edge, cropX = margin = 1920
    expect(ffmpegZoomFilters(1920, 1080, 2, 50, 0)[1]).toBe("crop=1920:1080:1920:540");
    // focusY = 1 → bottom, cropY = margin = 1080
    expect(ffmpegZoomFilters(1920, 1080, 2, 0, 50)[1]).toBe("crop=1920:1080:960:1080");
  });

  it("CSS transform-origin matches the focus point (preview parity)", () => {
    expect(beatZoomStyle(2, 0, 0)).toEqual({ transform: "scale(2)", transformOrigin: "50.00% 50.00%" });
    expect(beatZoomStyle(1.5, -50, 50)).toEqual({ transform: "scale(1.5)", transformOrigin: "0.00% 100.00%" });
  });
});
