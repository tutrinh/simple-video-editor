import type { CSSProperties } from "react";
import type { Clip, ColorAdjustments } from "../domain/types";

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

/** CSS background value for a clip's poster (data URL), or a neutral fallback. */
export function posterBg(clip: Clip | undefined): string | undefined {
  return clip?.poster ? `#0a0b0d url(${JSON.stringify(clip.poster)}) center/cover no-repeat` : undefined;
}

/** Generate SVG data URL for RGB color temperature (warmth). */
function warmthSvgFilter(warm: number): string {
  const w = warm / 100;
  const r = (1 + 0.25 * w).toFixed(3);
  const g = (1 + 0.08 * w).toFixed(3);
  const b = (1 - 0.25 * w).toFixed(3);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg"><filter id="w"><feColorMatrix type="matrix" values="${r} 0 0 0 0  0 ${g} 0 0 0  0 0 ${b} 0 0  0 0 0 1 0"/></filter></svg>`;
  return `url('data:image/svg+xml;utf8,${encodeURIComponent(svg)}#w')`;
}

import { getFilterPresetById, type FilterPreset } from "../lib/customPresets";
export { getFilterPresetById as getFilterPreset, type FilterPreset };

/** Convert Beat color adjustments & optional Global Filter to a CSS filter string for live HTML video preview. */
export function cssFilterFor(adj?: ColorAdjustments, globalFilterId?: string | null, globalIntensity = 1, customGlobalAdj?: ColorAdjustments): string {
  const preset = getFilterPresetById(globalFilterId);
  const globalAdj = customGlobalAdj ?? preset?.colorAdjustments;

  const exp = (adj?.exposure ?? 0) + (globalAdj?.exposure ?? 0) * globalIntensity;
  const con = (adj?.contrast ?? 0) + (globalAdj?.contrast ?? 0) * globalIntensity;
  const tone = (adj?.colorTone ?? 0) + (globalAdj?.colorTone ?? 0) * globalIntensity;
  const warm = (adj?.warmth ?? 0) + (globalAdj?.warmth ?? 0) * globalIntensity;
  const sat = (adj?.saturation ?? 0) + (globalAdj?.saturation ?? 0) * globalIntensity;

  if (!exp && !con && !tone && !warm && !sat) return "none";
  const filters: string[] = [];
  if (exp !== 0) filters.push(`brightness(${(1 + exp / 100).toFixed(2)})`);
  if (con !== 0) filters.push(`contrast(${(1 + con / 100).toFixed(2)})`);
  if (sat !== 0) filters.push(`saturate(${(1 + sat / 100).toFixed(2)})`);
  if (tone !== 0) filters.push(`hue-rotate(${(tone * 1.8).toFixed(1)}deg)`);
  if (warm !== 0) filters.push(warmthSvgFilter(warm));
  return filters.join(" ");
}

/** Convert Beat color adjustments & optional Global Filter to FFmpeg filtergraph strings for export encoding. */
export function ffmpegColorFilters(adj?: ColorAdjustments, globalFilterId?: string | null, globalIntensity = 1, customGlobalAdj?: ColorAdjustments): string[] {
  const preset = getFilterPresetById(globalFilterId);
  const globalAdj = customGlobalAdj ?? preset?.colorAdjustments;

  const exp = (adj?.exposure ?? 0) + (globalAdj?.exposure ?? 0) * globalIntensity;
  const con = (adj?.contrast ?? 0) + (globalAdj?.contrast ?? 0) * globalIntensity;
  const tone = (adj?.colorTone ?? 0) + (globalAdj?.colorTone ?? 0) * globalIntensity;
  const warm = (adj?.warmth ?? 0) + (globalAdj?.warmth ?? 0) * globalIntensity;
  const sat = (adj?.saturation ?? 0) + (globalAdj?.saturation ?? 0) * globalIntensity;

  if (!exp && !con && !tone && !warm && !sat) return [];
  const filters: string[] = [];
  if (exp !== 0 || con !== 0 || sat !== 0) {
    const brightness = (exp / 200).toFixed(3);
    const contrast = (1 + con / 100).toFixed(3);
    const saturation = (1 + sat / 100).toFixed(3);
    filters.push(`eq=brightness=${brightness}:contrast=${contrast}:saturation=${saturation}`);
  }
  if (tone !== 0) {
    const hue = (tone * 1.8).toFixed(1);
    filters.push(`hue=h=${hue}`);
  }
  if (warm !== 0) {
    const w = warm / 100;
    const rm = (0.25 * w).toFixed(3);
    const gm = (0.08 * w).toFixed(3);
    const bm = (-0.25 * w).toFixed(3);
    filters.push(`colorbalance=rm=${rm}:gm=${gm}:bm=${bm}`);
  }
  return filters;
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
