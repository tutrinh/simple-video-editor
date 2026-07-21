import { describe, it, expect } from "vitest";
import { parseAlternatives } from "./refine";

describe("parseAlternatives", () => {
  it("keeps up to count clean lines", () => {
    const text = "First take\nSecond take\nThird take\nFourth take";
    expect(parseAlternatives(text, 3)).toEqual(["First take", "Second take", "Third take"]);
  });
  it("strips list bullets, numbering, and wrapping quotes", () => {
    const text = `1. "Serve it up"\n- Bring the heat\n* Match point energy`;
    expect(parseAlternatives(text, 3)).toEqual(["Serve it up", "Bring the heat", "Match point energy"]);
  });
  it("drops blank lines", () => {
    expect(parseAlternatives("Alpha\n\n   \nBravo", 5)).toEqual(["Alpha", "Bravo"]);
  });
});
