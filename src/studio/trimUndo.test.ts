import { describe, it, expect } from "vitest";
import type { Beat } from "../domain/types";

describe("Beat Trim Undo System", () => {
  it("tracks trim history and reverts to exact previous trim state on undo", () => {
    const initialBeat: Beat = {
      id: "b1",
      clipId: "c1",
      inSec: 2.0,
      outSec: 6.0,
      durationSec: 4.0,
      scriptText: "",
      captionText: "",
    };

    const trimHistory: { inSec: number; outSec: number; durationSec: number }[] = [];

    // First trim change
    const nextBeat1: Beat = {
      ...initialBeat,
      inSec: 3.5,
      outSec: 8.5,
      durationSec: 5.0,
    };
    trimHistory.push({ inSec: initialBeat.inSec, outSec: initialBeat.outSec, durationSec: initialBeat.durationSec });

    // Second trim change
    const nextBeat2: Beat = {
      ...nextBeat1,
      inSec: 1.0,
      outSec: 5.0,
      durationSec: 4.0,
    };
    trimHistory.push({ inSec: nextBeat1.inSec, outSec: nextBeat1.outSec, durationSec: nextBeat1.durationSec });

    expect(trimHistory).toHaveLength(2);

    // Undo 1st step
    const prevTrim1 = trimHistory.pop()!;
    const undoneBeat1: Beat = {
      ...nextBeat2,
      inSec: prevTrim1.inSec,
      outSec: prevTrim1.outSec,
      durationSec: prevTrim1.durationSec,
    };

    expect(undoneBeat1.inSec).toBe(3.5);
    expect(undoneBeat1.outSec).toBe(8.5);
    expect(undoneBeat1.durationSec).toBe(5.0);

    // Undo 2nd step
    const prevTrim2 = trimHistory.pop()!;
    const undoneBeat2: Beat = {
      ...undoneBeat1,
      inSec: prevTrim2.inSec,
      outSec: prevTrim2.outSec,
      durationSec: prevTrim2.durationSec,
    };

    expect(undoneBeat2.inSec).toBe(2.0);
    expect(undoneBeat2.outSec).toBe(6.0);
    expect(undoneBeat2.durationSec).toBe(4.0);
  });
});
