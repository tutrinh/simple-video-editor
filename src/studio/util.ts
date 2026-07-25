import type { CSSProperties } from "react";
import type { Clip, ColorAdjustments, Cut } from "../domain/types";

/** m:ss from seconds. */
export function fmtClock(sec: number): string {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** e.g. 4.6s */
export function fmtSecs(sec: number): string {
  return sec.toFixed(1) + "s";
}

/** A clip is "in play" for authoring unless explicitly excluded. */
export function isIncluded(clip: Clip): boolean {
  return clip.included !== false;
}

/**
 * The clips that are beats in the cut — "what's in the cut". AI analysis and
 * authoring operate only on these: the arranged beats are the story, and clips
 * used only as overlays (or not placed at all) are intentionally left out.
 * Preserves cut/beat order and de-dupes if a clip appears in more than one beat.
 */
export function beatClips(clips: Clip[], cut?: Cut | null): Clip[] {
  const byId = new Map(clips.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const out: Clip[] = [];
  for (const b of cut?.beats ?? []) {
    const clip = byId.get(b.clipId);
    if (clip && !seen.has(clip.id)) { seen.add(clip.id); out.push(clip); }
  }
  return out;
}

/** CSS background value for a clip's poster (data URL), or a neutral fallback. */
export function posterBg(clip: Clip | undefined): string | undefined {
  return clip?.poster ? `#0a0b0d url(${JSON.stringify(clip.poster)}) center/cover no-repeat` : undefined;
}

import { getFilterPresetById, type FilterPreset } from "../lib/customPresets";
import { resolveGrade, gradeSvgFilter, gradeCube, isIdentityGrade } from "../lib/grade";
export { getFilterPresetById as getFilterPreset, type FilterPreset };

/** The Grade in effect for a Beat: its own values plus the global override, clamped. */
export function gradeFor(adj?: ColorAdjustments, globalFilterId?: string | null, globalIntensity = 1, customGlobalAdj?: ColorAdjustments): ColorAdjustments {
  const preset = getFilterPresetById(globalFilterId);
  return resolveGrade(adj, customGlobalAdj ?? preset?.colorAdjustments, globalIntensity);
}

/**
 * The Grade as a CSS `filter` for the live preview. Delegates to the one grade
 * generator (ADR-0010), so this and the export's baked LUT are two renderings
 * of the same transform rather than two implementations of it.
 */
export function cssFilterFor(adj?: ColorAdjustments, globalFilterId?: string | null, globalIntensity = 1, customGlobalAdj?: ColorAdjustments): string {
  return gradeSvgFilter(gradeFor(adj, globalFilterId, globalIntensity, customGlobalAdj));
}

/**
 * The Grade as an ffmpeg LUT for one exported segment (ADR-0010).
 *
 * Returns the `.cube` bytes to hand to `runIsolated` as an `EngineInput` plus
 * the `-vf` entry that consumes it, or `null` for an identity Grade. This
 * replaced the `eq`/`hue`/`colorbalance` chain: `eq=brightness` was an additive
 * offset where the preview's `brightness()` was a multiplicative gain, so the
 * two could never agree on exposure no matter how they were tuned.
 */
export function ffmpegColorLut(
  name: string,
  adj?: ColorAdjustments,
  globalFilterId?: string | null,
  globalIntensity = 1,
  customGlobalAdj?: ColorAdjustments,
): { input: { name: string; data: Uint8Array }; filter: string } | null {
  const grade = gradeFor(adj, globalFilterId, globalIntensity, customGlobalAdj);
  if (isIdentityGrade(grade)) return null;
  return {
    input: { name, data: new TextEncoder().encode(gradeCube(grade)) },
    filter: `lut3d=${name}`,
  };
}

/** Normalized zoom focus point (0..1) from the beat's -50..50 pan sliders. */
function zoomFocus(zoomX?: number, zoomY?: number): { fx: number; fy: number } {
  return {
    fx: Math.max(0, Math.min(1, 0.5 + (zoomX ?? 0) / 100)),
    fy: Math.max(0, Math.min(1, 0.5 + (zoomY ?? 0) / 100)),
  };
}

/**
 * CSS transform for a beat's punch-in zoom. Scaling around a transform-origin at
 * the focus point keeps that point fixed while cropping in — the exact match for
 * the ffmpeg scale+crop below (footage is already letterboxed/`contain`, so the
 * preview and export crop identically). Returns {} at 1× (no effect).
 */
export function beatZoomStyle(zoom?: number, zoomX?: number, zoomY?: number): CSSProperties {
  const z = zoom ?? 1;
  if (z <= 1.001) return {};
  const { fx, fy } = zoomFocus(zoomX, zoomY);
  return {
    transform: `scale(${z})`,
    transformOrigin: `${(fx * 100).toFixed(2)}% ${(fy * 100).toFixed(2)}%`,
  };
}

/** Whether the punch-in zoom is active at `elapsedSec` into the beat. "entire"
 *  scope is always on; "intro" scope only for the first `zoomSec` seconds. */
export function isBeatZoomActive(zoom?: number, zoomScope?: "entire" | "intro", zoomSec?: number, elapsedSec = 0): boolean {
  if ((zoom ?? 1) <= 1.001) return false;
  if ((zoomScope ?? "entire") === "entire") return true;
  return elapsedSec < (zoomSec ?? 3);
}

/** ffmpeg filters for a beat's punch-in zoom (scale up, crop back to frame). */
export function ffmpegZoomFilters(w: number, h: number, zoom?: number, zoomX?: number, zoomY?: number): string[] {
  const z = zoom ?? 1;
  if (z <= 1.001) return [];
  const W2 = Math.round(w * z);
  const H2 = Math.round(h * z);
  const { fx, fy } = zoomFocus(zoomX, zoomY);
  const cropX = Math.round(fx * (W2 - w));
  const cropY = Math.round(fy * (H2 - h));
  return [`scale=${W2}:${H2}`, `crop=${w}:${h}:${cropX}:${cropY}`];
}
