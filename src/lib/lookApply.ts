import type { ColorAdjustments } from "../domain/types";

// Applying a Look to the Beats (ADR-0010). A Look is a *target*, not an offset:
// each Beat is graded individually toward it, because clips shot at different
// exposures and white balances need different corrections to land in the same
// place. The global override must therefore be cleared when a Look is applied —
// otherwise the Look lands twice, once flat across every Beat and once as the
// per-shot match, which is exactly what `gradeBeatToLook` is prompted to avoid.

/** The global override — a manual trim on top of the Beats, not a Look itself. */
export interface GlobalLook {
  filterId?: string | null;
  intensity: number;
  adjustments?: ColorAdjustments;
}

/** A Beat as far as grading is concerned. */
export interface GradedBeat {
  id: string;
  colorAdjustments?: ColorAdjustments;
}

/** Everything an apply overwrites, so Undo can put all of it back. */
export interface GradeSnapshot {
  beats: Map<string, ColorAdjustments | undefined>;
  global: GlobalLook;
}

/** Capture the per-Beat Grades and the global override before an apply. */
export function captureGradeSnapshot(beats: GradedBeat[], global: GlobalLook): GradeSnapshot {
  return {
    beats: new Map(beats.map((b) => [b.id, b.colorAdjustments])),
    global: { filterId: global.filterId ?? null, intensity: global.intensity, adjustments: global.adjustments },
  };
}

/**
 * The global override once a Look has been applied to the Beats: no preset and
 * no adjustments. Intensity is kept so picking a preset later behaves as before.
 */
export function clearedGlobal(current: GlobalLook): GlobalLook {
  return { filterId: null, intensity: current.intensity, adjustments: {} };
}

/** True when the global override would contribute nothing to a Grade. */
export function isGlobalCleared(global: GlobalLook): boolean {
  if (global.filterId) return false;
  const adj = global.adjustments;
  return !adj || Object.values(adj).every((v) => !v);
}

/** The Grade to put back on a Beat when the AI grade is undone. */
export function restoredBeatGrade(snapshot: GradeSnapshot, beatId: string): ColorAdjustments | undefined {
  return snapshot.beats.get(beatId);
}

/** Whether a Beat was captured — Beats added after the apply are left alone. */
export function wasSnapshotted(snapshot: GradeSnapshot, beatId: string): boolean {
  return snapshot.beats.has(beatId);
}

/** The global override to put back when the AI grade is undone. */
export function restoredGlobal(snapshot: GradeSnapshot): GlobalLook {
  return snapshot.global;
}
