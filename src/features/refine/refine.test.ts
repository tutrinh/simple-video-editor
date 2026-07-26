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

describe("lockDuration (slip editing)", () => {
  it("preserves timeline duration when sliding inSec with lockDuration active", () => {
    const fixedDur = 4.4;
    const maxOut = 10.0;

    function slipIn(inSec: number) {
      const nextIn = Math.max(0, Math.min(inSec, maxOut - fixedDur));
      const nextOut = Math.min(maxOut, Math.round((nextIn + fixedDur) * 10) / 10);
      return { inSec: Math.round(nextIn * 10) / 10, outSec: nextOut, durationSec: fixedDur };
    }

    const res = slipIn(3.0);

    expect(res.inSec).toBe(3.0);
    expect(res.outSec).toBe(7.4);
    expect(res.durationSec).toBe(4.4);
  });

  it("preserves timeline duration when sliding outSec with lockDuration active", () => {
    const fixedDur = 4.4;
    const maxOut = 10.0;

    function slipOut(outSec: number) {
      const nextOut = Math.max(fixedDur, Math.min(outSec, maxOut));
      const nextIn = Math.max(0, Math.round((nextOut - fixedDur) * 10) / 10);
      return { inSec: nextIn, outSec: Math.round(nextOut * 10) / 10, durationSec: fixedDur };
    }

    const res = slipOut(8.4);
    expect(res.inSec).toBe(4.0);
    expect(res.outSec).toBe(8.4);
    expect(res.durationSec).toBe(4.4);
  });
});

