import { describe, it, expect } from "vitest";
import {
  AXIS_LIMIT, CURVE_SAMPLES, SHOULDER_KNEE, softClip, shadowsWeight, highlightsWeight,
  curveStep, curveTable, matrixStep, applyMatrix, gradePixel, resolveGrade,
  isIdentityGrade, type Rgb,
} from "./grade";

const MID: Rgb = [0.5, 0.5, 0.5];

describe("resolveGrade", () => {
  it("sums the Beat Grade with the global override", () => {
    expect(resolveGrade({ warmth: 20 }, { warmth: 30 }, 1)).toEqual({ warmth: 50 });
  });

  it("scales the global by intensity", () => {
    expect(resolveGrade({ warmth: 20 }, { warmth: 40 }, 0.5)).toEqual({ warmth: 40 });
  });

  it("clamps the composed value to the axis limit", () => {
    // The old unbounded sum resolved this to +120, outside the model's range.
    expect(resolveGrade({ warmth: 80 }, { warmth: 40 }, 1).warmth).toBe(AXIS_LIMIT);
    expect(resolveGrade({ contrast: -80 }, { contrast: -60 }, 1).contrast).toBe(-AXIS_LIMIT);
  });

  it("omits axes that resolve to zero", () => {
    expect(resolveGrade({ warmth: 20 }, { warmth: -20 }, 1)).toEqual({});
  });
});

describe("isIdentityGrade", () => {
  it("is true for empty and undefined", () => {
    expect(isIdentityGrade(undefined)).toBe(true);
    expect(isIdentityGrade({})).toBe(true);
    expect(isIdentityGrade({ warmth: 0 })).toBe(true);
  });

  it("is false once any axis is set", () => {
    expect(isIdentityGrade({ shadowTint: 5 })).toBe(false);
  });
});

describe("curveStep", () => {
  it("is the identity for an empty Grade", () => {
    for (const x of [0, 0.25, 0.5, 0.75, 1]) {
      expect(curveStep({}, 0, x)).toBeCloseTo(x, 6);
    }
  });

  it("applies exposure multiplicatively, so black stays black", () => {
    // The old export used an additive eq=brightness offset, which lifted blacks
    // to grey and was the largest preview/export mismatch.
    expect(curveStep({ exposure: 50 }, 0, 0)).toBeCloseTo(0, 6);
    expect(curveStep({ exposure: 50 }, 0, 0.4)).toBeCloseTo(0.6, 6);
  });

  it("pivots contrast around 0.5", () => {
    expect(curveStep({ contrast: 50 }, 0, 0.5)).toBeCloseTo(0.5, 6);
    expect(curveStep({ contrast: 50 }, 0, 0.75)).toBeGreaterThan(0.75);
    expect(curveStep({ contrast: 50 }, 0, 0.25)).toBeLessThan(0.25);
  });

  it("targets shadow tint at the dark end and leaves highlights alone", () => {
    const adj = { shadowWarmth: 80 };
    const darkShift = curveStep(adj, 0, 0.1) - 0.1;
    const brightShift = curveStep(adj, 0, 0.9) - 0.9;
    expect(darkShift).toBeGreaterThan(0);
    expect(Math.abs(brightShift)).toBeLessThan(Math.abs(darkShift));
  });

  it("targets highlight tint at the bright end and leaves shadows alone", () => {
    const adj = { highlightWarmth: 80 };
    const darkShift = curveStep(adj, 0, 0.1) - 0.1;
    const brightShift = curveStep(adj, 0, 0.9) - 0.9;
    expect(brightShift).toBeGreaterThan(0);
    expect(Math.abs(darkShift)).toBeLessThan(Math.abs(brightShift));
  });

  it("splits shadows and highlights in opposite directions", () => {
    // Teal shadows + amber highlights: the cinematic look the old 0.4x fold
    // could not represent, because one global WB cannot go both ways at once.
    const adj = { shadowWarmth: -70, highlightWarmth: 70 };
    expect(curveStep(adj, 0, 0.1)).toBeLessThan(0.1);   // R down in shadows
    expect(curveStep(adj, 0, 0.9)).toBeGreaterThan(0.9); // R up in highlights
    expect(curveStep(adj, 2, 0.1)).toBeGreaterThan(0.1); // B up in shadows
  });

  it("keeps output inside [0,1]", () => {
    expect(curveStep({ exposure: 100 }, 0, 1)).toBeLessThanOrEqual(1);
    expect(curveStep({ exposure: 100 }, 0, 1)).toBeGreaterThan(SHOULDER_KNEE);
    expect(curveStep({ exposure: -100 }, 0, 1)).toBe(0);
  });

  it("keeps overshooting highlights separated instead of flat-topping", () => {
    // The garish failure: a punchy Grade drove every bright channel to 255, so
    // a turquoise wall and a yellow pavement both became flat primaries.
    const adj = { exposure: 10, contrast: 45 };
    const a = curveStep(adj, 0, 0.82);
    const b = curveStep(adj, 0, 0.95);
    expect(a).toBeLessThan(b);          // still distinguishable
    expect(b).toBeLessThan(1);          // and neither is pinned to the rail
  });

  // Under half a step in 8-bit — the weight tapers toward the far end without
  // reaching exactly zero, so "untouched" means invisibly so, not bit-identical.
  const INVISIBLE = 1 / 255 / 2;

  it("lifts the dark region but holds true black", () => {
    const adj = { shadows: 80 };
    expect(curveStep(adj, 0, 0)).toBe(0);                   // black is held exactly
    expect(curveStep(adj, 0, 0.25)).toBeGreaterThan(0.30);  // dark region lifts clearly
    expect(Math.abs(curveStep(adj, 0, 0.9) - 0.9)).toBeLessThan(INVISIBLE);
  });

  it("crushes the dark region without pulling black below zero", () => {
    const adj = { shadows: -80 };
    expect(curveStep(adj, 0, 0)).toBe(0);
    expect(curveStep(adj, 0, 0.25)).toBeLessThan(0.25);
  });

  it("moves the bright region but holds pure white", () => {
    const adj = { highlights: -80 };
    expect(curveStep(adj, 0, 1)).toBe(1);                 // white is held exactly
    expect(curveStep(adj, 0, 0.75)).toBeLessThan(0.70);   // bright region recovers clearly
    expect(Math.abs(curveStep(adj, 0, 0.1) - 0.1)).toBeLessThan(INVISIBLE);
  });

  it("does not engage the shoulder for a Grade that never overshoots", () => {
    // Shadows and Highlights hold both ends by construction, so they must not
    // pay the shoulder's in-range highlight compression.
    expect(curveStep({ shadows: 100 }, 0, 1)).toBe(1);
    expect(curveStep({ highlights: -100 }, 0, 1)).toBe(1);
    expect(curveStep({ shadows: 60, highlights: -60 }, 0, 1)).toBe(1);
  });

  it("keeps Shadows and Highlights independent", () => {
    // Each axis peaks where the other is near zero, so they can be dialled
    // in opposite directions without fighting.
    const adj = { shadows: 80, highlights: -80 };
    expect(curveStep(adj, 0, 0.25)).toBeGreaterThan(0.25);
    expect(curveStep(adj, 0, 0.75)).toBeLessThan(0.75);
  });

  it("does not engage the shoulder for a saturation-only Grade", () => {
    // Saturation lives in the matrix, so the curve must stay untouched — a
    // shoulder here would dull whites for no reason.
    expect(curveStep({ saturation: 60 }, 0, 1)).toBe(1);
    expect(curveStep({ colorTone: 40 }, 0, 0.9)).toBeCloseTo(0.9, 6);
  });
});

describe("tone weights", () => {
  it("shadows weight is zero at both ends and peaks at 0.25", () => {
    expect(shadowsWeight(0)).toBe(0);
    expect(shadowsWeight(1)).toBe(0);
    expect(shadowsWeight(0.25)).toBeCloseTo(1, 6);
    expect(shadowsWeight(0.25)).toBeGreaterThan(shadowsWeight(0.5));
  });

  it("highlights weight is zero at both ends and peaks at 0.75", () => {
    expect(highlightsWeight(0)).toBe(0);
    expect(highlightsWeight(1)).toBe(0);
    expect(highlightsWeight(0.75)).toBeCloseTo(1, 6);
    expect(highlightsWeight(0.75)).toBeGreaterThan(highlightsWeight(0.5));
  });

  it("the two weights are mirrors of each other", () => {
    for (const x of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      expect(shadowsWeight(x)).toBeCloseTo(highlightsWeight(1 - x), 6);
    }
  });

  it("neither weight exceeds its peak anywhere in range", () => {
    for (let x = 0; x <= 1; x += 0.01) {
      expect(shadowsWeight(x)).toBeLessThanOrEqual(1 + 1e-9);
      expect(highlightsWeight(x)).toBeLessThanOrEqual(1 + 1e-9);
    }
  });
});

describe("softClip", () => {
  it("passes values below the knee through untouched", () => {
    for (const x of [0, 0.25, 0.5, SHOULDER_KNEE]) expect(softClip(x)).toBeCloseTo(x, 6);
  });

  it("holds black at black", () => {
    expect(softClip(0)).toBe(0);
    expect(softClip(-0.5)).toBe(0);
  });

  it("never exceeds 1, however far the input overshoots", () => {
    // tanh saturates to exactly 1.0 in floating point for large inputs, so the
    // guarantee is "never above 1", not "strictly below" it.
    for (const x of [1, 1.5, 3, 100, 1e6]) {
      expect(softClip(x)).toBeLessThanOrEqual(1);
      expect(softClip(x)).toBeGreaterThan(SHOULDER_KNEE);
    }
  });

  it("leaves headroom for realistic overshoot rather than pinning to the rail", () => {
    expect(softClip(1)).toBeLessThan(1);
    expect(softClip(1.2)).toBeLessThan(1);
    expect(softClip(1.2)).toBeGreaterThan(softClip(1));
  });

  it("is strictly increasing across the shoulder", () => {
    let prev = -1;
    for (let x = 0; x <= 2; x += 0.01) {
      const y = softClip(x);
      expect(y).toBeGreaterThan(prev);
      prev = y;
    }
  });

  it("is continuous at the knee", () => {
    const eps = 1e-6;
    expect(Math.abs(softClip(SHOULDER_KNEE + eps) - softClip(SHOULDER_KNEE - eps))).toBeLessThan(1e-5);
  });
});

describe("curveTable", () => {
  it("emits CURVE_SAMPLES values spanning the range", () => {
    const t = curveTable({}, 0);
    expect(t).toHaveLength(CURVE_SAMPLES);
    expect(t[0]).toBeCloseTo(0, 6);
    expect(t[CURVE_SAMPLES - 1]).toBeCloseTo(1, 6);
  });

  it("is non-linear when split-tone is set", () => {
    const t = curveTable({ shadowWarmth: 80 }, 0);
    const mid = Math.floor(CURVE_SAMPLES / 2);
    const linear = (t[0] + t[CURVE_SAMPLES - 1]) / 2;
    expect(Math.abs(t[mid] - linear)).toBeGreaterThan(0.005);
  });
});

describe("matrixStep", () => {
  it("is the identity for an empty Grade", () => {
    expect(applyMatrix(matrixStep({}), MID)).toEqual(MID);
  });

  it("pushes red up and blue down for warmth", () => {
    const out = applyMatrix(matrixStep({ warmth: 80 }), MID);
    expect(out[0]).toBeGreaterThan(0.5);
    expect(out[2]).toBeLessThan(0.5);
  });

  it("pushes green down for positive tint (toward magenta)", () => {
    const out = applyMatrix(matrixStep({ tint: 80 }), MID);
    expect(out[1]).toBeLessThan(0.5);
  });

  it("collapses colour toward luma at full desaturation", () => {
    const out = applyMatrix(matrixStep({ saturation: -100 }), [0.8, 0.2, 0.2]);
    expect(out[0]).toBeCloseTo(out[1], 6);
    expect(out[1]).toBeCloseTo(out[2], 6);
  });

  it("leaves grey untouched under saturation and hue", () => {
    const out = applyMatrix(matrixStep({ saturation: 60, colorTone: 40 }), MID);
    expect(out[0]).toBeCloseTo(0.5, 3);
    expect(out[1]).toBeCloseTo(0.5, 3);
    expect(out[2]).toBeCloseTo(0.5, 3);
  });
});

describe("gradePixel", () => {
  it("is the identity for an empty Grade", () => {
    expect(gradePixel({}, [0.2, 0.5, 0.8])).toEqual([0.2, 0.5, 0.8]);
  });

  it("composes the curve step before the matrix step", () => {
    // Exposure (curve) then desaturation (matrix): the result is grey but
    // brighter than the ungraded luma, which only holds in this order.
    const out = gradePixel({ exposure: 50, saturation: -100 }, [0.4, 0.4, 0.4]);
    expect(out[0]).toBeCloseTo(out[2], 6);
    expect(out[0]).toBeGreaterThan(0.4);
  });

  it("keeps every channel in [0,1] under extreme Grades", () => {
    const extreme = {
      exposure: 100, contrast: 100, saturation: 100, colorTone: 100,
      warmth: 100, tint: -100, shadowWarmth: 100, highlightTint: -100,
    };
    for (const c of gradePixel(extreme, [0.9, 0.1, 0.5])) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
  });
});
