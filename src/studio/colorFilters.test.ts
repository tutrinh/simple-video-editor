import { describe, it, expect } from "vitest";
import { cssFilterFor, ffmpegColorFilters } from "./util";

describe("cssFilterFor", () => {
  it("returns 'none' when nothing is set", () => {
    expect(cssFilterFor({})).toBe("none");
    expect(cssFilterFor(undefined)).toBe("none");
  });

  it("maps basic sliders to CSS filters", () => {
    const css = cssFilterFor({ exposure: 50, contrast: 20, saturation: -40 });
    expect(css).toContain("brightness(1.50)");
    expect(css).toContain("contrast(1.20)");
    expect(css).toContain("saturate(0.60)");
  });

  it("emits a white-balance matrix when warmth or tint is set", () => {
    expect(cssFilterFor({ warmth: 30 })).toContain("feColorMatrix");
    expect(cssFilterFor({ tint: 30 })).toContain("feColorMatrix");
  });

  it("folds split-tone into the preview white balance (directional hint)", () => {
    // Shadow/highlight tints have no basic sliders, but should still produce a WB matrix.
    expect(cssFilterFor({ shadowWarmth: 40 })).toContain("feColorMatrix");
    expect(cssFilterFor({ highlightTint: 40 })).toContain("feColorMatrix");
  });
});

describe("ffmpegColorFilters", () => {
  it("returns [] when nothing is set", () => {
    expect(ffmpegColorFilters({})).toEqual([]);
  });

  it("emits eq for exposure/contrast/saturation", () => {
    const f = ffmpegColorFilters({ exposure: 100, contrast: 50, saturation: 50 }).join(" ");
    expect(f).toContain("eq=brightness=0.500:contrast=1.500:saturation=1.500");
  });

  it("emits a colorbalance covering shadows, mids, and highlights for split-tone", () => {
    const f = ffmpegColorFilters({ shadowWarmth: -50, shadowTint: 40, highlightWarmth: 50 }).join(" ");
    expect(f).toMatch(/colorbalance=rs=.*:gs=.*:bs=.*:rm=.*:gm=.*:bm=.*:rh=.*:gh=.*:bh=/);
  });

  it("warmth pushes red up and blue down in midtones", () => {
    const f = ffmpegColorFilters({ warmth: 100 }).join(" ");
    expect(f).toContain("rm=0.250");
    expect(f).toContain("bm=-0.250");
  });

  it("tint (magenta) pulls green down in midtones", () => {
    const f = ffmpegColorFilters({ tint: 100 }).join(" ");
    expect(f).toContain("gm=-0.200");
  });
});
