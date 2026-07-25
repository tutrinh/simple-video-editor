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

/** SVG feColorMatrix data-URL for white balance: warmth (blue↔amber) + tint
 *  (green↔magenta) as per-channel gain. Positive tint pushes magenta (down-weights G). */
function wbMatrixFilter(warm: number, tint: number): string {
  const w = warm / 100;
  const t = tint / 100;
  const r = ((1 + 0.25 * w) * (1 + 0.05 * t)).toFixed(3);
  const g = ((1 + 0.08 * w) * (1 - 0.20 * t)).toFixed(3);
  const b = ((1 - 0.25 * w) * (1 + 0.05 * t)).toFixed(3);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg"><filter id="w"><feColorMatrix type="matrix" values="${r} 0 0 0 0  0 ${g} 0 0 0  0 0 ${b} 0 0  0 0 0 1 0"/></filter></svg>`;
  return `url('data:image/svg+xml;utf8,${encodeURIComponent(svg)}#w')`;
}

import { getFilterPresetById, type FilterPreset } from "../lib/customPresets";
export { getFilterPresetById as getFilterPreset, type FilterPreset };

/** Convert Beat color adjustments & optional Global Filter to a CSS filter string for live HTML video preview. */
export function cssFilterFor(adj?: ColorAdjustments, globalFilterId?: string | null, globalIntensity = 1, customGlobalAdj?: ColorAdjustments): string {
  const preset = getFilterPresetById(globalFilterId);
  const globalAdj = customGlobalAdj ?? preset?.colorAdjustments;

  const g = (k: keyof ColorAdjustments) => (adj?.[k] ?? 0) + (globalAdj?.[k] ?? 0) * globalIntensity;
  const exp = g("exposure"), con = g("contrast"), tone = g("colorTone"), sat = g("saturation");
  // White balance + split-tone. Preview is global (CSS can't tone-target), so the
  // shadow/highlight tints are folded into the overall WB at reduced strength — a
  // directional hint; the export (ffmpeg colorbalance) applies them per tonal range.
  const warm = g("warmth") + 0.4 * (g("shadowWarmth") + g("highlightWarmth"));
  const tint = g("tint") + 0.4 * (g("shadowTint") + g("highlightTint"));

  if (!exp && !con && !tone && !warm && !sat && !tint) return "none";
  const filters: string[] = [];
  if (exp !== 0) filters.push(`brightness(${(1 + exp / 100).toFixed(2)})`);
  if (con !== 0) filters.push(`contrast(${(1 + con / 100).toFixed(2)})`);
  if (sat !== 0) filters.push(`saturate(${(1 + sat / 100).toFixed(2)})`);
  if (tone !== 0) filters.push(`hue-rotate(${(tone * 1.8).toFixed(1)}deg)`);
  if (warm !== 0 || tint !== 0) filters.push(wbMatrixFilter(warm, tint));
  return filters.join(" ");
}

/** Convert Beat color adjustments & optional Global Filter to FFmpeg filtergraph strings for export encoding. */
export function ffmpegColorFilters(adj?: ColorAdjustments, globalFilterId?: string | null, globalIntensity = 1, customGlobalAdj?: ColorAdjustments): string[] {
  const preset = getFilterPresetById(globalFilterId);
  const globalAdj = customGlobalAdj ?? preset?.colorAdjustments;

  const g = (k: keyof ColorAdjustments) => (adj?.[k] ?? 0) + (globalAdj?.[k] ?? 0) * globalIntensity;
  const exp = g("exposure"), con = g("contrast"), tone = g("colorTone"), sat = g("saturation");
  const warm = g("warmth"), tint = g("tint");
  const sWarm = g("shadowWarmth"), sTint = g("shadowTint"), hWarm = g("highlightWarmth"), hTint = g("highlightTint");

  const anyWB = warm || tint || sWarm || sTint || hWarm || hTint;
  if (!exp && !con && !tone && !sat && !anyWB) return [];
  const filters: string[] = [];
  if (exp !== 0 || con !== 0 || sat !== 0) {
    const brightness = (exp / 200).toFixed(3);
    const contrast = (1 + con / 100).toFixed(3);
    const saturation = (1 + sat / 100).toFixed(3);
    filters.push(`eq=brightness=${brightness}:contrast=${contrast}:saturation=${saturation}`);
  }
  if (tone !== 0) {
    filters.push(`hue=h=${(tone * 1.8).toFixed(1)}`);
  }
  if (anyWB) {
    // One colorbalance carrying midtones (global WB), shadows, and highlights.
    // warmth: R+ B- ; tint(magenta+): G- (R,B slight+). Scaled per tonal range.
    const wb = (w: number, t: number) => ({
      r: 0.25 * (w / 100) + 0.05 * (t / 100),
      g: 0.08 * (w / 100) - 0.20 * (t / 100),
      b: -0.25 * (w / 100) + 0.05 * (t / 100),
    });
    const m = wb(warm, tint), s = wb(sWarm, sTint), h = wb(hWarm, hTint);
    const f = (n: number) => n.toFixed(3);
    filters.push(
      `colorbalance=rs=${f(s.r)}:gs=${f(s.g)}:bs=${f(s.b)}:rm=${f(m.r)}:gm=${f(m.g)}:bm=${f(m.b)}:rh=${f(h.r)}:gh=${f(h.g)}:bh=${f(h.b)}`,
    );
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
