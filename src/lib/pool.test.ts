import { describe, it, expect } from "vitest";
import { runPool } from "./pool";

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

describe("runPool", () => {
  it("processes every item exactly once", async () => {
    const seen: number[] = [];
    await runPool([1, 2, 3, 4, 5], 2, async (x) => { seen.push(x); });
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it("never exceeds the concurrency limit", async () => {
    let active = 0;
    let peak = 0;
    await runPool(Array.from({ length: 8 }, (_, i) => i), 2, async () => {
      active++;
      peak = Math.max(peak, active);
      await tick();
      active--;
    });
    expect(peak).toBe(2);
  });

  it("runs concurrently (2-wide is faster than sequential)", async () => {
    const start = Date.now();
    await runPool([1, 2, 3, 4], 2, async () => { await tick(20); });
    // 4 items / width 2 = 2 waves ~40ms; sequential would be ~80ms.
    expect(Date.now() - start).toBeLessThan(75);
  });

  it("clamps a limit larger than the item count", async () => {
    let active = 0;
    let peak = 0;
    await runPool([1, 2], 5, async () => {
      active++; peak = Math.max(peak, active); await tick(); active--;
    });
    expect(peak).toBe(2);
  });

  it("handles empty input without running the worker", async () => {
    await runPool([], 2, async () => { throw new Error("should not run"); });
  });

  it("treats a limit below 1 as sequential", async () => {
    let active = 0;
    let peak = 0;
    await runPool([1, 2, 3], 0, async () => {
      active++; peak = Math.max(peak, active); await tick(); active--;
    });
    expect(peak).toBe(1);
  });
});
