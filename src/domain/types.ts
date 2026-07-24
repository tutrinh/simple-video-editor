// The domain model spine. Names come straight from CONTEXT.md — keep them in
// sync. Clip and Cut/Beat are load-bearing; everything else hangs off them.

export type Aspect = "16:9" | "9:16" | "1:1";

/** A single uploaded video file — the raw input unit. */
export interface Clip {
  id: string;
  file: File;
  name: string;
  durationSec: number;
  width: number;
  height: number;
  /** 1080p-normalized source (ADR-0002: 4K normalized on ingest). */
  normalized?: Blob;
  /** Poster thumbnail (data URL) generated on ingest. */
  poster?: string;
  /** Claude's per-clip understanding (ADR-0001). */
  description?: ClipDescription;
  /** Editor's include/exclude toggle for authoring. Undefined = included. */
  included?: boolean;
}

/**
 * Claude's neutral, observational read of one Clip, built from sampled frames.
 * A *description* of the footage — not coaching aimed at the creator (ADR-0007).
 */
export interface ClipDescription {
  /** What the clip shows: subject + action. */
  subjectAction: string;
  /** Where it is and how it feels: setting + mood. */
  settingMood: string;
  /** 1–5 suitability as a story beat. */
  usability: number;
  model: string;
  /** Full raw model text, always retained. */
  raw: string;
}

/** One authored beat: which clip, and the script line to show/speak over it. */
export interface StoryBeat {
  clipId: string;
  scriptText: string;
}

/**
 * The authored narrative intermediate: a logline plus the ordered, kept clips
 * with their Script lines. Phase 4 turns each StoryBeat into a full Beat
 * (adding trim in/out and a script-driven duration).
 */
export interface Story {
  logline: string;
  beats: StoryBeat[];
}

export type VideoTransitionType =
  | "none"
  | "fade"
  | "fadeblack"
  | "fadewhite"
  | "wipeleft"
  | "wiperight"
  | "slideleft"
  | "slideright";

/**
 * One entry in the Cut: a trimmed Clip plus the Script segment shown as a
 * Caption. Duration derives from the Script segment's spoken length (ADR-0004).
 * A Clip appears in at most one Beat; Beats are not split or reused (v1).
 */
export interface Beat {
  id: string;
  clipId: string;
  inSec: number;
  outSec: number;
  durationSec: number;
  scriptText: string;
  captionText: string;
  captionDurations?: number[];
  colorAdjustments?: ColorAdjustments;
  /** Per-beat stacked title layers, shown during this beat (parallel to the
   *  cut-level title in ExportSettings). Type-only import — erased at runtime,
   *  so no state↔domain runtime cycle. */
  titleLayers?: import("../state/ExportSettingsContext").TitleLayerSettings[];
  /** Video transition into this beat from the preceding beat. */
  transition?: VideoTransitionType;
  /** Duration of the transition in seconds (default 0.5s). */
  transitionSec?: number;
  /** Position of the transition relative to beat timing ("start" for entering beat, "end" for exiting beat). */
  transitionPosition?: "start" | "end";
  /** Audio volume multiplier for original clip audio (0 to 1, default 1.0 = 100%). */
  volume?: number;
}

export interface ColorAdjustments {
  /** Exposure / Brightness offset (-100 to +100, default 0). */
  exposure?: number;
  /** Contrast offset (-100 to +100, default 0). */
  contrast?: number;
  /** Color tone / Hue offset (-100 to +100, default 0). */
  colorTone?: number;
  /** Warmth / Color temperature offset (-100 to +100, default 0). */
  warmth?: number;
  /** Saturation offset (-100 to +100, default 0). */
  saturation?: number;
}

export type OverlayBlendMode = "normal" | "screen" | "multiply" | "overlay";

export interface OverlayClip {
  id: string;
  clipId: string;
  startTimeSec: number;
  durationSec: number;
  inSec: number;
  outSec: number;
  blendMode: OverlayBlendMode;
  opacity: number; // 0..1
  volume: number; // 0..1
}

/** The assembled, editable draft — the ordered sequence of Beats and Overlays. */
export interface Cut {
  beats: Beat[];
  overlays?: OverlayClip[];
  aspect: Aspect;
  /** Non-destructive global look & feel color filter preset ID. */
  globalFilterId?: string;
  /** Global filter intensity scale (0..1, default 1). */
  globalFilterIntensity?: number;
  /** Fine-tuned custom color adjustments overriding the preset defaults. */
  globalFilterAdjustments?: ColorAdjustments;
}
