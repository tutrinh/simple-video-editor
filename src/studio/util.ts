import type { CSSProperties } from "react";
import type { Clip, ColorAdjustments, Cut, KenBurns } from "../domain/types";

/** m:ss from seconds. */
export function fmtClock(sec: number): string {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** e.g. 4.6s */
export function fmtSecs(sec: number): string {
  return sec.toFixed(1) + "s";
}

/** Theme-consistent slider track fill style (conforms to DESIGN_PATTERNS.md). */
export function sliderTrackStyle(val: number, min = -100, max = 100): CSSProperties {
  const thumbPct = Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100));

  if (min < 0) {
    const zeroPct = Math.max(0, Math.min(100, ((0 - min) / (max - min)) * 100));
    const left = Math.min(thumbPct, zeroPct);
    const width = Math.abs(thumbPct - zeroPct);
    return {
      accentColor: "var(--accent)",
      background: `linear-gradient(to right, var(--panel-3) 0%, var(--panel-3) ${left}%, var(--accent) ${left}%, var(--accent) ${left + width}%, var(--panel-3) ${left + width}%, var(--panel-3) 100%)`,
    };
  }

  return {
    accentColor: "var(--accent)",
    background: `linear-gradient(to right, var(--accent) 0%, var(--accent) ${thumbPct}%, var(--panel-3) ${thumbPct}%, var(--panel-3) 100%)`,
  };
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

// --- Ken Burns (ADR-0015) ---------------------------------------------------
// `kenBurnsAt` is THE contract. It is not ticked per frame: it generates the
// preview's CSS keyframes for playback, is sampled directly while paused or
// scrubbing (a running CSS animation cannot be scrubbed), and the export turns
// the same move into zoompan expressions. Preview and export must never
// interpolate separately — that is how the per-Beat rotation once shipped with
// an inverted sign.

/** The framing in force at `t01` (0 = the Beat's start, 1 = its end). */
export function kenBurnsAt(move: KenBurns, t01: number): { scale: number; x: number; y: number } {
  // Linear, deliberately (ADR-0015): `start + (end-start)·t` is exact in both
  // CSS `linear` and zoompan's frame arithmetic, so the two agree by
  // construction rather than by sampling a curve finely enough.
  const t = Number.isFinite(t01) ? Math.max(0, Math.min(1, t01)) : 0;
  const lerp = (a: number, b: number) => a + (b - a) * t;
  return {
    scale: lerp(move.fromScale, move.toScale),
    x: lerp(move.fromX, move.toX),
    y: lerp(move.fromY, move.toY),
  };
}

/**
 * How far a source must be scaled past "contained" before it covers the canvas
 * — the zoom the Fill preset needs. 1 when the aspects already match.
 *
 * A Beat is fitted with `force_original_aspect_ratio=decrease` then padded, so
 * scale 1.0 shows letterbox bars. A 3:4 photo in a 16:9 canvas needs ~2.37×
 * merely to lose them, which is why the zoom ceiling is available pixels rather
 * than a fixed number.
 */
export function coverScale(srcW: number, srcH: number, canvasW: number, canvasH: number): number {
  if (!(srcW > 0 && srcH > 0 && canvasW > 0 && canvasH > 0)) return 1;
  const sx = canvasW / srcW;
  const sy = canvasH / srcH;
  const contain = Math.min(sx, sy);
  const cover = Math.max(sx, sy);
  if (!(contain > 0) || !Number.isFinite(cover / contain)) return 1;
  return cover / contain;
}

/** The named moves. `Fill` is computed per-Still, so it is not in this table. */
export const KEN_BURNS_PRESETS: { id: string; label: string; move: KenBurns }[] = [
  { id: "push-in", label: "Push In", move: { fromScale: 1.0, fromX: 0, fromY: 0, toScale: 1.15, toX: 0, toY: 0 } },
  { id: "pull-out", label: "Pull Out", move: { fromScale: 1.15, fromX: 0, fromY: 0, toScale: 1.0, toX: 0, toY: 0 } },
  { id: "drift-left", label: "Drift Left", move: { fromScale: 1.15, fromX: 14, fromY: 0, toScale: 1.15, toX: -14, toY: 0 } },
  { id: "drift-right", label: "Drift Right", move: { fromScale: 1.15, fromX: -14, fromY: 0, toScale: 1.15, toX: 14, toY: 0 } },
  { id: "push-drift", label: "Push In + Drift", move: { fromScale: 1.0, fromX: -8, fromY: -5, toScale: 1.2, toX: 8, toY: 5 } },
];

/** What turning Ken Burns on gives you before anything is touched. */
export const KEN_BURNS_DEFAULT: KenBurns = KEN_BURNS_PRESETS[0].move;

/**
 * The size to render the Still at, ONCE, before it reaches ffmpeg.
 *
 * Task 1's spike measured a `scale` inside the filter chain as the slowest of
 * four options — worse than no pre-scale at all — because `-loop 1` pushes 300
 * frames through the graph and `scale` re-scales the same picture on every one.
 * So this is a canvas `drawImage` target, paid once, and the emitted chain
 * contains no `scale` at all.
 *
 * The image is rendered CONTAINED and padded to the canvas aspect at this size,
 * so zoompan can crop-and-output straight to canvas dimensions, and scale 1.0
 * means the contained frame exactly as `Beat.zoom` 1× does.
 *
 * `scale` is capped so the Still is never upscaled past its own pixels — a
 * small source simply gets a smaller pre-scale and less jitter headroom.
 */
export function kenBurnsPreScale(
  canvasW: number, canvasH: number, srcW: number, srcH: number,
): { w: number; h: number; scale: number } {
  const TARGET = 2; // 2x canvas width: one integer zoompan step is half an output pixel
  if (!(srcW > 0 && srcH > 0 && canvasW > 0 && canvasH > 0)) {
    return { w: canvasW, h: canvasH, scale: 1 };
  }
  // How big the source is when contained in the canvas — the 1.0 reference.
  const contain = Math.min(canvasW / srcW, canvasH / srcH);
  const containedW = srcW * contain;
  // Upscaling past native buys no detail, only cost.
  const maxScale = Math.max(1, srcW / Math.max(1, containedW));
  const scale = Math.min(TARGET, maxScale);
  return { w: Math.round(canvasW * scale), h: Math.round(canvasH * scale), scale };
}

/**
 * The export chain for a Ken Burns move: one `zoompan`, no `scale`, cropping
 * the pre-scaled image and outputting canvas dimensions directly.
 *
 * Replaces the `scale`+`pad` a normal Beat uses rather than following it — the
 * static Zoom runs AFTER the pad and so scales the letterbox bars along with the
 * picture, which for a Still would also throw away the native resolution
 * ADR-0012 deliberately preserved.
 */
export function kenBurnsChain(
  canvasW: number, canvasH: number, move: KenBurns, durSec: number, fps = 30,
): string[] {
  const frames = Math.max(2, Math.round(Math.max(0.1, durSec) * fps));
  const last = frames - 1;
  // Linear over the output frame index — the same `start + (end-start)*t` that
  // kenBurnsAt computes and the preview's keyframes use (ADR-0015).
  // The delta is computed here, not emitted as `(to-from)`: a negative `from`
  // renders that as `8--8`, which is a double-minus the expression parser is
  // entitled to read as something else entirely. Rounded because 1.2-1.0 is
  // 0.19999999999999996 in binary floating point, and a filtergraph is hard
  // enough to read at 2am without that in it.
  const r = (n: number) => Number(n.toFixed(6));
  const lerp = (from: number, to: number) =>
    from === to ? String(r(from)) : `(${r(from)}+(${r(to - from)})*on/${last})`;
  const z = lerp(move.fromScale, move.toScale);
  // Focus is -50..50 with 0 centred, matching zoomX/zoomY; zoompan wants the
  // crop origin, so convert to a 0..1 fraction of the leftover space.
  const fx = `(0.5+${lerp(move.fromX, move.toX)}/100)`;
  const fy = `(0.5+${lerp(move.fromY, move.toY)}/100)`;
  return [
    `zoompan=z='${z}':x='(iw-iw/zoom)*${fx}':y='(ih-ih/zoom)*${fy}'` +
    `:d=1:s=${canvasW}x${canvasH}:fps=${fps}`,
  ];
}

/**
 * Where the centre of the visible region sits, as a 0..1 fraction of the source.
 *
 * This exists because CSS and `zoompan` mean different things by "focus".
 * zoompan's x is the crop's LEFT EDGE within the leftover space, so focus 1.0 at
 * 2× puts the crop flush right — centred on 0.75, not 1.0. A CSS transform that
 * centred on 1.0 would show a different picture. Both sides derive their
 * geometry from this one function so they cannot disagree.
 */
export function kenBurnsVisibleCenter(scale: number, focus: number): number {
  const z = Math.max(1, scale);
  const f = Math.max(0, Math.min(1, 0.5 + focus / 100));
  return (1 - 1 / z) * f + 1 / (2 * z);
}

/**
 * The preview's transform for one instant of a move. A single `transform` —
 * translate-then-scale about the centre — rather than a scale plus a moving
 * `transform-origin`, so playback can animate one property linearly.
 */
export function kenBurnsTransform(scale: number, x: number, y: number): string {
  const z = Math.max(1, scale);
  const tx = -(kenBurnsVisibleCenter(z, x) - 0.5) * z * 100;
  const ty = -(kenBurnsVisibleCenter(z, y) - 0.5) * z * 100;
  return `translate(${tx.toFixed(4)}%, ${ty.toFixed(4)}%) scale(${z.toFixed(6)})`;
}

/** The transform at `t01` — used while paused or scrubbing, where CSS cannot help. */
export function kenBurnsStyleAt(move: KenBurns, t01: number): CSSProperties {
  const m = kenBurnsAt(move, t01);
  return { transform: kenBurnsTransform(m.scale, m.x, m.y), transformOrigin: "50% 50%" };
}

/** The two ends of the move, for the CSS keyframes that run during playback. */
export function kenBurnsKeyframes(move: KenBurns): { from: string; to: string } {
  return {
    from: kenBurnsTransform(move.fromScale, move.fromX, move.fromY),
    to: kenBurnsTransform(move.toScale, move.toX, move.toY),
  };
}

/** The Fill move for one Still: hold at the scale that just covers the canvas. */
export function fillMove(srcW: number, srcH: number, canvasW: number, canvasH: number): KenBurns {
  const s = coverScale(srcW, srcH, canvasW, canvasH);
  return { fromScale: s, fromX: 0, fromY: 0, toScale: s, toX: 0, toY: 0 };
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
