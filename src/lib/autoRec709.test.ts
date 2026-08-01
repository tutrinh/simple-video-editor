import { describe, expect, it } from "vitest";
import { AUTO_REC709_GRADE, autoRec709Grade } from "./autoRec709";

describe("Auto Rec.709 grade", () => {
  it("normalizes flat footage without assuming a camera profile", () => {
    expect(AUTO_REC709_GRADE).toEqual({
      contrast: 32,
      shadows: 6,
      highlights: -12,
      saturation: 24,
    });
    expect(AUTO_REC709_GRADE).not.toHaveProperty("exposure");
    expect(AUTO_REC709_GRADE).not.toHaveProperty("warmth");
    expect(AUTO_REC709_GRADE).not.toHaveProperty("tint");
  });

  it("returns an independently editable grade for each beat", () => {
    const first = autoRec709Grade();
    const second = autoRec709Grade();

    expect(first).toEqual(AUTO_REC709_GRADE);
    expect(first).not.toBe(second);
  });
});

