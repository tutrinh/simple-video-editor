import { describe, it, expect } from "vitest";
import { advanceStillPos } from "./util";

// The Still transport clock (ADR-0012). A Still has no <video> firing
// `timeupdate`, so the beat preview and the trimmer advance this themselves.

describe("advanceStillPos", () => {
  it("advances proportionally to the window", () => {
    // 1s into a 10s window = 10%.
    expect(advanceStillPos(0, 1, 10)).toEqual({ pos: 0.1, ended: false });
    expect(advanceStillPos(0.5, 1, 10).pos).toBeCloseTo(0.6, 10);
    // The same dt over a 2s window moves five times as far.
    expect(advanceStillPos(0, 1, 2)).toEqual({ pos: 0.5, ended: false });
  });

  it("ends exactly at the out-point rather than wrapping", () => {
    expect(advanceStillPos(0.99, 1, 10)).toEqual({ pos: 1, ended: true });
    expect(advanceStillPos(0, 10, 10)).toEqual({ pos: 1, ended: true });
    // Overshooting a frame clamps; it never reports > 1 or restarts at 0.
    expect(advanceStillPos(0.5, 999, 10)).toEqual({ pos: 1, ended: true });
  });

  it("does not end one frame early", () => {
    const nearly = advanceStillPos(0, 9.9, 10);
    expect(nearly.ended).toBe(false);
    expect(nearly.pos).toBeCloseTo(0.99, 10);
  });

  it("clamps below zero — a backward step cannot go negative", () => {
    expect(advanceStillPos(0.1, -1, 10)).toEqual({ pos: 0, ended: false });
    expect(advanceStillPos(0, -5, 10)).toEqual({ pos: 0, ended: false });
  });

  it("survives a degenerate window instead of dividing by zero", () => {
    // The span floors at 10ms, so a zero or negative window stays finite and
    // in range rather than producing NaN or Infinity...
    for (const span of [0, -3]) {
      const r = advanceStillPos(0, 0.001, span);
      expect(Number.isFinite(r.pos), `span ${span}`).toBe(true);
      expect(r.pos).toBeGreaterThanOrEqual(0);
      expect(r.pos).toBeLessThanOrEqual(1);
    }
    // ...and it still terminates: 10ms of dt spends that floored window.
    expect(advanceStillPos(0, 0.01, 0)).toEqual({ pos: 1, ended: true });
  });

  it("is a no-op for a zero dt", () => {
    expect(advanceStillPos(0.42, 0, 10)).toEqual({ pos: 0.42, ended: false });
  });

  it("accumulates to the out-point over many frames without drifting", () => {
    // A 10s window at 30fps is 300 frames. Repeated 1/30 addition loses a few
    // ULPs, so it can land on frame 301 — but never later, and never short.
    let pos = 0;
    let ended = false;
    let frames = 0;
    while (!ended && frames < 1000) { ({ pos, ended } = advanceStillPos(pos, 1 / 30, 10)); frames++; }
    expect(ended).toBe(true);
    expect(pos).toBe(1);
    expect(frames).toBeGreaterThanOrEqual(300);
    expect(frames).toBeLessThanOrEqual(301);
  });
});
