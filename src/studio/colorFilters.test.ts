import { describe, it, expect } from "vitest";
import { cssFilterFor, ffmpegColorLut, gradeFor } from "./util";
import { AXIS_LIMIT, CURVE_SAMPLES } from "../lib/grade";

function decode(filter: string): string {
  const m = filter.match(/utf8,([^#]+)#g/);
  if (!m) throw new Error(`not a data-URI filter: ${filter}`);
  return decodeURIComponent(m[1]);
}

function tableOf(filter: string, tag: "feFuncR" | "feFuncG" | "feFuncB"): number[] {
  return decode(filter).match(new RegExp(`<${tag} type="table" tableValues="([^"]+)"`))![1].split(" ").map(Number);
}

describe("gradeFor", () => {
  it("composes the Beat Grade with the global override", () => {
    expect(gradeFor({ warmth: 20 }, null, 1, { warmth: 25 })).toEqual({ warmth: 45 });
  });

  it("clamps the composed Grade to the axis limit", () => {
    // Previously unbounded: +80 under a +40 global resolved to +120.
    expect(gradeFor({ warmth: 80 }, null, 1, { warmth: 40 }).warmth).toBe(AXIS_LIMIT);
  });

  it("scales the global override by intensity", () => {
    expect(gradeFor({}, null, 0.5, { contrast: 40 })).toEqual({ contrast: 20 });
  });
});

describe("cssFilterFor", () => {
  it("returns 'none' when nothing is set", () => {
    expect(cssFilterFor({})).toBe("none");
    expect(cssFilterFor(undefined)).toBe("none");
  });

  it("emits one SVG filter carrying the curve and matrix steps", () => {
    const svg = decode(cssFilterFor({ exposure: 50, contrast: 20, saturation: -40 }));
    expect(svg).toContain("feComponentTransfer");
    expect(svg).toContain("feColorMatrix");
  });

  it("applies exposure multiplicatively, matching the exported LUT", () => {
    // The export used to add an eq=brightness offset here, which lifted blacks
    // while the preview multiplied them. Black must stay black on both sides.
    const t = tableOf(cssFilterFor({ exposure: 50 }), "feFuncR");
    expect(t[0]).toBeCloseTo(0, 5);
    // White lands just shy of 1.0: the highlight shoulder rolls the 1.5x
    // overshoot off rather than truncating it. Black is untouched.
    expect(t[CURVE_SAMPLES - 1]).toBeGreaterThan(0.99);
    expect(t[CURVE_SAMPLES - 1]).toBeLessThanOrEqual(1);
  });

  it("tone-targets split-tone instead of folding it into global white balance", () => {
    // Was: shadow/highlight tints folded into overall WB at 0.4x as a
    // "directional hint", which is linear and cannot bend the curve.
    const t = tableOf(cssFilterFor({ shadowWarmth: 80 }), "feFuncR");
    const lo = Math.floor(CURVE_SAMPLES * 0.1);
    const hi = Math.floor(CURVE_SAMPLES * 0.9);
    const loShift = t[lo] - lo / (CURVE_SAMPLES - 1);
    const hiShift = t[hi] - hi / (CURVE_SAMPLES - 1);
    expect(loShift).toBeGreaterThan(0);
    expect(Math.abs(hiShift)).toBeLessThan(Math.abs(loShift));
  });

  it("can push shadows and highlights opposite ways in one Grade", () => {
    const t = tableOf(cssFilterFor({ shadowWarmth: -70, highlightWarmth: 70 }), "feFuncR");
    const lo = Math.floor(CURVE_SAMPLES * 0.1);
    const hi = Math.floor(CURVE_SAMPLES * 0.9);
    expect(t[lo]).toBeLessThan(lo / (CURVE_SAMPLES - 1));
    expect(t[hi]).toBeGreaterThan(hi / (CURVE_SAMPLES - 1));
  });

  it("folds the global override into the preview", () => {
    expect(cssFilterFor({}, null, 1, { warmth: 40 })).not.toBe("none");
  });
});

describe("ffmpegColorLut", () => {
  it("returns null for an identity Grade, so no filter and no input", () => {
    expect(ffmpegColorLut("grade.cube", {})).toBeNull();
    expect(ffmpegColorLut("grade.cube", undefined)).toBeNull();
    expect(ffmpegColorLut("grade.cube", { warmth: 0 })).toBeNull();
  });

  it("emits a lut3d filter naming its own input file", () => {
    const lut = ffmpegColorLut("grade.cube", { warmth: 40 })!;
    expect(lut.filter).toBe("lut3d=grade.cube");
    expect(lut.input.name).toBe("grade.cube");
  });

  it("no longer emits the eq/hue/colorbalance chain", () => {
    // These are the filters whose math could not agree with the preview.
    const lut = ffmpegColorLut("grade.cube", { exposure: 50, contrast: 20, colorTone: 30, warmth: 25 })!;
    expect(lut.filter).not.toContain("eq=");
    expect(lut.filter).not.toContain("hue=");
    expect(lut.filter).not.toContain("colorbalance=");
  });

  it("writes a well-formed .cube payload", () => {
    const lut = ffmpegColorLut("grade.cube", { shadowWarmth: -60, highlightWarmth: 60 })!;
    const text = new TextDecoder().decode(lut.input.data);
    expect(text).toContain("LUT_3D_SIZE 33");
    const rows = text.split("\n").filter((l) => l && !l.startsWith("#") && !l.startsWith("LUT_3D_SIZE"));
    expect(rows).toHaveLength(33 ** 3);
  });

  it("respects the global override and its intensity", () => {
    expect(ffmpegColorLut("grade.cube", {}, null, 1, { warmth: 40 })).not.toBeNull();
    expect(ffmpegColorLut("grade.cube", {}, null, 0, { warmth: 40 })).toBeNull();
  });
});
