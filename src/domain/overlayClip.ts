import { beatTiming } from "./beatTiming";
import type { Beat, OverlayBlendMode, OverlayClip } from "./types";

export interface OverlayVisual {
  layoutMode: "full" | "pip";
  x: number;
  y: number;
  width: number;
  height: number;
  fit: "contain" | "cover";
  cornerRadius: number;
}

export interface OverlayTiming {
  startTimeSec: number;
  durationSec: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function overlayCreationVisual(name: string, requestedBlendMode?: OverlayBlendMode): Pick<
  OverlayClip,
  "blendMode" | "opacity" | "volume" | "layoutMode" | "x" | "y" | "width" | "height" | "fit" | "cornerRadius"
> {
  const lower = name.toLowerCase();
  const isEffect = (requestedBlendMode != null && requestedBlendMode !== "normal")
    || lower.includes("overlay")
    || lower.includes("leak")
    || lower.includes("grain")
    || lower.includes("glitch");
  return {
    blendMode: requestedBlendMode ?? (isEffect ? "screen" : "normal"),
    opacity: 1,
    volume: 0,
    layoutMode: isEffect ? "full" : "pip",
    x: 0.8,
    y: 0.2,
    width: 0.34,
    height: 0.26,
    fit: "cover",
    cornerRadius: 0.08,
  };
}

export function overlayVisual(overlay: OverlayClip): OverlayVisual {
  const width = clamp(overlay.width ?? 0.34, 0.1, 1);
  const height = clamp(overlay.height ?? 0.26, 0.1, 1);
  return {
    layoutMode: overlay.layoutMode === "pip" ? "pip" : "full",
    x: clamp(overlay.x ?? 0.8, width / 2, 1 - width / 2),
    y: clamp(overlay.y ?? 0.2, height / 2, 1 - height / 2),
    width,
    height,
    fit: overlay.fit === "cover" ? "cover" : "contain",
    cornerRadius: clamp(overlay.cornerRadius ?? 0.08, 0, 0.5),
  };
}

export function overlayTiming(
  overlay: OverlayClip,
  beats: readonly Beat[],
  clipDurationById?: ReadonlyMap<string, number>,
): OverlayTiming {
  if (!overlay.fitToBeat || !overlay.attachedBeatId) {
    return {
      startTimeSec: Math.max(0, overlay.startTimeSec),
      durationSec: Math.max(0.05, overlay.durationSec),
    };
  }

  const index = beats.findIndex((beat) => beat.id === overlay.attachedBeatId);
  if (index < 0) {
    return {
      startTimeSec: Math.max(0, overlay.startTimeSec),
      durationSec: Math.max(0.05, overlay.durationSec),
    };
  }

  const durationOf = (beat: Beat) => beatTiming(beat, clipDurationById?.get(beat.clipId)).timelineSec;
  return {
    startTimeSec: beats.slice(0, index).reduce((sum, beat) => sum + durationOf(beat), 0),
    durationSec: Math.max(0.05, durationOf(beats[index])),
  };
}

export function resolveOverlayClip(
  overlay: OverlayClip,
  beats: readonly Beat[],
  clipDurationById?: ReadonlyMap<string, number>,
): OverlayClip {
  const migrateEarlyPipDefault = overlay.layoutMode === "pip"
    && overlay.blendMode === "normal"
    && overlay.opacityAuthored !== true
    && Math.abs(overlay.opacity - 0.85) < 0.0001;
  return {
    ...overlay,
    ...overlayTiming(overlay, beats, clipDurationById),
    opacity: migrateEarlyPipDefault ? 1 : overlay.opacity,
  };
}

export function activeOverlayClips(
  overlays: readonly OverlayClip[] | undefined,
  beats: readonly Beat[],
  elapsedSec: number,
  clipDurationById?: ReadonlyMap<string, number>,
): OverlayClip[] {
  return (overlays ?? [])
    .map((overlay) => resolveOverlayClip(overlay, beats, clipDurationById))
    .filter((overlay) => elapsedSec >= overlay.startTimeSec && elapsedSec < overlay.startTimeSec + overlay.durationSec);
}

export function attachOverlayToBeat(
  overlay: OverlayClip,
  beat: Beat,
  beats: readonly Beat[],
  clipDurationById?: ReadonlyMap<string, number>,
): OverlayClip {
  const attached = { ...overlay, fitToBeat: true, attachedBeatId: beat.id };
  return { ...attached, ...overlayTiming(attached, beats, clipDurationById) };
}
