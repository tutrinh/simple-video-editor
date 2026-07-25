import { describe, it, expect } from "vitest";
import { parseAdjustments, parseLookResponse, parseGradeResponse } from "./filmLook";

describe("parseAdjustments", () => {
  it("keeps known keys and clamps to ±100 integers", () => {
    expect(parseAdjustments({ warmth: 30, shadowTint: -250, exposure: 12.6, bogus: 5 })).toEqual({
      warmth: 30, shadowTint: -100, exposure: 13,
    });
  });
  it("ignores non-numeric and missing values", () => {
    expect(parseAdjustments({ contrast: "x", tint: null })).toEqual({});
    expect(parseAdjustments(undefined)).toEqual({});
  });
});

describe("parseLookResponse", () => {
  it("parses name + description + nested adjustments, tolerating code fences", () => {
    const look = parseLookResponse('```json\n{"name":"Teal & Amber","description":"teal-orange","adjustments":{"contrast":20,"shadowWarmth":-40,"highlightWarmth":30}}\n```');
    expect(look.name).toBe("Teal & Amber");
    expect(look.description).toBe("teal-orange");
    expect(look.colorAdjustments).toEqual({ contrast: 20, shadowWarmth: -40, highlightWarmth: 30 });
  });
  it("tolerates surrounding prose and flat adjustments", () => {
    const look = parseLookResponse('Here it is: {"description":"warm","warmth":40}');
    expect(look.description).toBe("warm");
    expect(look.colorAdjustments.warmth).toBe(40);
  });
});

describe("parseGradeResponse", () => {
  it("parses nested adjustments", () => {
    expect(parseGradeResponse('{"adjustments":{"warmth":-20,"tint":10}}')).toEqual({ warmth: -20, tint: 10 });
  });
  it("parses a bare adjustments object", () => {
    expect(parseGradeResponse('{"warmth":15,"saturation":-5}')).toEqual({ warmth: 15, saturation: -5 });
  });
});
