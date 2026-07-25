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
 * The ROTATION layer of the preview transform — its own element, its own pivot.
 *
 * Rotation is centre-pivoted to match ffmpeg's `rotate`, which always turns about
 * the frame centre. Zoom's focus offset lives on a separate layer; folding the
 * two together made CSS rotate about the zoom focus while the export rotated
 * about the centre, so an off-centre focus silently disagreed.
 *
 * No cover scale: the corners a rotation exposes are left showing, for the
 * editor to zoom away or keep.
 *
 * Must be the INNER layer: nested transforms apply child-first, and the export
 * rotates before it zooms.
 */
export function beatRotationStyle(_w: number, _h: number, rotation?: number): CSSProperties {
  const deg = rotation ?? 0;
  if (Math.abs(deg) < ROTATION_EPSILON) return {};
  return { transform: `rotate(${deg.toFixed(2)}deg)`, transformOrigin: "50% 50%" };
}

/**
 * The ZOOM layer of the preview transform — the OUTER element, pivoting on the
 * focus point so that point stays fixed as the frame crops in.
 */
export function beatZoomStyle(zoom?: number, zoomX?: number, zoomY?: number, zoomActive = true): CSSProperties {
  const z = zoomActive ? (zoom ?? 1) : 1;
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

/**
 * The Still transport clock (ADR-0012). A Still has no `<video>` to fire
 * `timeupdate`, so its preview and trimmer advance a normalized 0..1 position
 * over the Beat's window themselves. `ended` is the out-point: the caller stops
 * there rather than wrapping, matching how a video Beat pauses at `outSec`.
 */
export function advanceStillPos(pos: number, dtSec: number, spanSec: number): { pos: number; ended: boolean } {
  const span = Math.max(0.01, spanSec);
  const next = pos + dtSec / span;
  if (!Number.isFinite(next) || next >= 1) return { pos: 1, ended: true };
  return { pos: Math.max(0, next), ended: false };
}

/** Below this a rotation is treated as none — 0.05° is under a pixel of skew at 1080p. */
const ROTATION_EPSILON = 0.05;

/**
 * The smallest uniform scale that would keep a rotated w×h frame covering the
 * w×h window. Nothing applies this automatically — it only powers the hint that
 * tells the editor how far to zoom if they want the corners gone.
 */
export function rotationCoverScale(w: number, h: number, deg?: number): number {
  const d = deg ?? 0;
  if (Math.abs(d) < ROTATION_EPSILON) return 1;
  const r = (Math.abs(d) * Math.PI) / 180;
  const c = Math.abs(Math.cos(r));
  const s = Math.abs(Math.sin(r));
  return Math.max((w * c + h * s) / w, (w * s + h * c) / h);
}

/**
 * Rotation's chain — just the rotate filter.
 *
 * The frame is NOT scaled up to hide the corners the rotation exposes; they
 * stay, filled black. Auto-cover was silently cropping the shot to pay for a
 * tilt, which is the editor's decision to make, not this function's. Reach for
 * the zoom slider if you want the corners gone.
 */
function rotationChain(_w: number, _h: number, rotation?: number): string[] {
  const deg = rotation ?? 0;
  if (Math.abs(deg) < ROTATION_EPSILON) return [];
  // Both ffmpeg's `rotate` and CSS `rotate()` turn CLOCKWISE for a positive
  // angle, so the slider value passes through unchanged. An earlier negation
  // here — added on the wrong assumption that ffmpeg went the other way — tilted
  // the export opposite to the preview.
  // ow/oh pinned to the input keeps the frame size unchanged.
  const rad = (deg * Math.PI) / 180;
  return [`rotate=angle=${rad.toFixed(6)}:ow=iw:oh=ih:fillcolor=black`];
}

/** Zoom's own chain: scale up, crop back at the focus point. */
function zoomChain(w: number, h: number, zoom?: number, zoomX?: number, zoomY?: number): string[] {
  const z = zoom ?? 1;
  if (z <= 1.001) return [];
  const W2 = Math.round(w * z);
  const H2 = Math.round(h * z);
  const { fx, fy } = zoomFocus(zoomX, zoomY);
  return [`scale=${W2}:${H2}`, `crop=${w}:${h}:${Math.round(fx * (W2 - w))}:${Math.round(fy * (H2 - h))}`];
}

export interface BeatFrame {
  zoom?: number; zoomX?: number; zoomY?: number;
  zoomScope?: "entire" | "intro"; zoomSec?: number;
  rotation?: number;
}

/**
 * The export geometry for one beat, as two independent chains.
 *
 * Rotation always sits in `base`, ahead of the `split=2`, so it outlives an
 * expired "intro" zoom. Because rotation now crops back to w×h on its own, the
 * intro branch is just the plain zoom chain — no relative-scale arithmetic.
 */
export function beatFrameFilters(w: number, h: number, b: BeatFrame): { base: string[]; introZoom: string[] | null } {
  const rot = rotationChain(w, h, b.rotation);
  const zm = zoomChain(w, h, b.zoom, b.zoomX, b.zoomY);
  const isIntro = (b.zoomScope ?? "entire") === "intro" && zm.length > 0;
  return {
    base: isIntro ? rot : [...rot, ...zm],
    introZoom: isIntro ? zm : null,
  };
}
