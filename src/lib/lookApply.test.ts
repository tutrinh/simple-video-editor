import { describe, it, expect } from "vitest";
import {
  captureGradeSnapshot, clearedGlobal, isGlobalCleared, restoredBeatGrade,
  restoredGlobal, wasSnapshotted, type GlobalLook, type GradedBeat,
} from "./lookApply";

const beats: GradedBeat[] = [
  { id: "b1", colorAdjustments: { warmth: 20 } },
  { id: "b2" },
  { id: "b3", colorAdjustments: { contrast: -15, shadowWarmth: 30 } },
];

const global: GlobalLook = { filterId: "teal-orange", intensity: 0.8, adjustments: { warmth: 18, contrast: 22 } };

describe("captureGradeSnapshot", () => {
  it("captures every Beat's Grade, including the unset ones", () => {
    const snap = captureGradeSnapshot(beats, global);
    expect(snap.beats.size).toBe(3);
    expect(snap.beats.get("b1")).toEqual({ warmth: 20 });
    expect(snap.beats.get("b2")).toBeUndefined();
    expect(wasSnapshotted(snap, "b2")).toBe(true);
  });

  it("captures the global override alongside the Beats", () => {
    const snap = captureGradeSnapshot(beats, global);
    expect(snap.global).toEqual({ filterId: "teal-orange", intensity: 0.8, adjustments: { warmth: 18, contrast: 22 } });
  });

  it("normalises a missing filter id to null", () => {
    expect(captureGradeSnapshot(beats, { intensity: 1 }).global.filterId).toBeNull();
  });

  it("is unaffected by later mutation of the Beat list", () => {
    const live = [...beats];
    const snap = captureGradeSnapshot(live, global);
    live.push({ id: "b4", colorAdjustments: { warmth: 90 } });
    expect(snap.beats.size).toBe(3);
    expect(wasSnapshotted(snap, "b4")).toBe(false);
  });
});

describe("clearedGlobal", () => {
  it("drops the preset and the adjustments", () => {
    // The double-apply fix: applying a Look to the Beats must not leave the same
    // Look sitting on the global override as a flat offset underneath.
    const cleared = clearedGlobal(global);
    expect(cleared.filterId).toBeNull();
    expect(cleared.adjustments).toEqual({});
    expect(isGlobalCleared(cleared)).toBe(true);
  });

  it("keeps intensity, so picking a preset later behaves as before", () => {
    expect(clearedGlobal(global).intensity).toBe(0.8);
  });

  it("does not mutate the global it was given", () => {
    const before = JSON.parse(JSON.stringify(global));
    clearedGlobal(global);
    expect(global).toEqual(before);
  });
});

describe("isGlobalCleared", () => {
  it("is false while a preset is selected", () => {
    expect(isGlobalCleared({ filterId: "teal-orange", intensity: 1 })).toBe(false);
  });

  it("is false while any adjustment is non-zero", () => {
    expect(isGlobalCleared({ filterId: null, intensity: 1, adjustments: { warmth: 5 } })).toBe(false);
  });

  it("is true for no preset and all-zero adjustments", () => {
    expect(isGlobalCleared({ filterId: null, intensity: 1, adjustments: {} })).toBe(true);
    expect(isGlobalCleared({ filterId: null, intensity: 1, adjustments: { warmth: 0 } })).toBe(true);
    expect(isGlobalCleared({ intensity: 1 })).toBe(true);
  });
});

describe("undo", () => {
  it("restores each Beat's original Grade", () => {
    const snap = captureGradeSnapshot(beats, global);
    expect(restoredBeatGrade(snap, "b1")).toEqual({ warmth: 20 });
    expect(restoredBeatGrade(snap, "b3")).toEqual({ contrast: -15, shadowWarmth: 30 });
  });

  it("restores a Beat that had no Grade back to none", () => {
    const snap = captureGradeSnapshot(beats, global);
    expect(restoredBeatGrade(snap, "b2")).toBeUndefined();
  });

  it("leaves a Beat whose grade failed exactly as it was", () => {
    // A failed grade never dispatched, so the snapshot value is still current
    // and restoring it is a no-op rather than a change.
    const snap = captureGradeSnapshot(beats, global);
    expect(restoredBeatGrade(snap, "b3")).toEqual(beats[2].colorAdjustments);
  });

  it("restores the global override the apply cleared", () => {
    const snap = captureGradeSnapshot(beats, global);
    expect(isGlobalCleared(clearedGlobal(snap.global))).toBe(true);
    expect(restoredGlobal(snap)).toEqual(global);
    expect(isGlobalCleared(restoredGlobal(snap))).toBe(false);
  });

  it("skips Beats added after the snapshot", () => {
    const snap = captureGradeSnapshot(beats, global);
    expect(wasSnapshotted(snap, "b9")).toBe(false);
  });
});
