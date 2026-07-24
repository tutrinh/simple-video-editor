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
  /** Punch-in zoom scale for this beat's footage (1 = none, up to 3). */
  zoom?: number;
  /** Horizontal focus of the zoom, -50..50 (0 = centered). */
  zoomX?: number;
  /** Vertical focus of the zoom, -50..50 (0 = centered). */
  zoomY?: number;
  /** When the zoom is active within the beat: "entire" (whole beat) or "intro"
   *  (only the first `zoomSec` seconds). Default "entire". */
  zoomScope?: "entire" | "intro";
  /** Duration in seconds the zoom holds when zoomScope === "intro" (default 3). */
  zoomSec?: number;
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

export type StickerAnimation = "none" | "fade" | "slide_left" | "slide_right" | "slide_top" | "slide_bottom";

/**
 * A static image (transparent PNG or SVG) placed on an independent Sticker track.
 * Positioned by posX/posY (% offset from centre), scaled, rotated, and animated
 * in/out during [startTimeSec, startTimeSec + durationSec].
 */
export interface StickerClip {
  id: string;
  /** Data URL (image/png or image/svg+xml). Stored in state — no File reference. */
  src: string;
  /** MIME type of the source asset. */
  mimeType: "image/png" | "image/svg+xml";
  /** Display label (filename or user-assigned name). */
  name: string;
  startTimeSec: number;
  durationSec: number;
  /** Horizontal offset from centre: -50..+50 (%). Default 0. */
  posX: number;
  /** Vertical offset from centre: -50..+50 (%). Default 0. */
  posY: number;
  /** Uniform scale multiplier, 0.1..3.0. Default 1. */
  scale: number;
  /** Rotation in degrees, -180..180. Default 0. */
  rotation: number;
  /** Opacity 0..1. Default 1. */
  opacity: number;
  /** Animate-in style. Default "fade". */
  animIn: StickerAnimation;
  /** Animate-out style. Default "fade". */
  animOut: StickerAnimation;
  /** Duration of both anim-in and anim-out in seconds. Default 0.3. */
  animDurationSec: number;
}

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

/**
 * A narration segment on the VO track — its own timeline lane, independent of the
 * beats. `text` is read by TTS (ElevenLabs/Kokoro) and, when `captionVisible`, burned
 * as a caption during [startTimeSec, startTimeSec + durationSec]. Draggable/resizable
 * like an OverlayClip, so a line can carry across beat boundaries.
 */
export interface VoSegment {
  id: string;
  text: string;
  startTimeSec: number;
  durationSec: number;
  captionVisible: boolean;
}

/** The assembled, editable draft — the ordered sequence of Beats and Overlays. */
export interface Cut {
  beats: Beat[];
  overlays?: OverlayClip[];
  /** Narration + caption segments on the independent VO track. */
  voSegments?: VoSegment[];
  /** Static image stickers (PNG/SVG) on the independent Sticker track. */
  stickers?: StickerClip[];
  aspect: Aspect;
  /** Non-destructive global look & feel color filter preset ID. */
  globalFilterId?: string;
  /** Global filter intensity scale (0..1, default 1). */
  globalFilterIntensity?: number;
  /** Fine-tuned custom color adjustments overriding the preset defaults. */
  globalFilterAdjustments?: ColorAdjustments;
}
