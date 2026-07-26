// The domain model spine. Names come straight from CONTEXT.md — keep them in
// sync. Clip and Cut/Beat are load-bearing; everything else hangs off them.

export type Aspect = "16:9" | "9:16" | "1:1";

/** A single uploaded source file — video footage, or a Still. */
export interface Clip {
  id: string;
  file: File;
  name: string;
  durationSec: number;
  width: number;
  height: number;
  /**
   * "still" = imported from an image, so `durationSec` is the synthetic
   * `STILL_CLIP_DURATION_SEC` rather than a measured length (ADR-0012).
   * Undefined means video — saved projects predate this field.
   */
  kind?: "video" | "still";
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

/**
 * A Ken Burns move (ADR-0015): the frame travels from one framing to another
 * across the Beat, rather than holding one. Stored as start and end rather than
 * as a rate, so retrimming the Beat re-fits the move — the same journey, faster.
 *
 * Scale is relative to the CONTAINED frame, exactly as `Beat.zoom` is: 1.0 is
 * the untouched frame, letterbox bars and all. Focus is -50..50 on each axis
 * with 0 centred, the same convention as `zoomX`/`zoomY`, so both framings read
 * their focus through the same helper.
 */
export interface KenBurns {
  fromScale: number;
  fromX: number;
  fromY: number;
  toScale: number;
  toX: number;
  toY: number;
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

export type SplitLayoutType =
  | "none"
  | "v2-stacked" // 2 rows (top / bottom)
  | "v2-side"    // 2 columns (left / right)
  | "3-col"      // 3 columns
  | "4-grid";    // 2x2 quad grid

export interface SplitScreenSlot {
  /** Project clip ID assigned to this slot. */
  clipId: string;
  /** In-point (seconds) within the source clip. */
  inSec: number;
  /** Individual volume for this slot (0..1, default: slot 0 = 1.0, others = 0). */
  volume?: number;
  /** Zoom/scale multiplier inside slot (1.0..3.0, default 1.0). */
  scale?: number;
  /** Horizontal pan offset x (-50..50%, default 0). */
  panX?: number;
  /** Vertical pan offset y (-50..50%, default 0). */
  panY?: number;
  /** Rotation angle in degrees (-180..180, default 0). */
  rotation?: number;
}


export interface SplitScreenConfig {
  layout: SplitLayoutType;
  slots: SplitScreenSlot[];
}


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
  /** When true, moving inSec or outSec recalculates the other bound to preserve exact timeline duration (slip edit). */
  lockDuration?: boolean;
  /** Optional multi-clip split screen configuration for this beat. */
  splitScreen?: SplitScreenConfig;

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
  /**
   * Which framing is in force (ADR-0015). Zoom and Ken Burns both command the
   * scale and centre of the frame, so they are a MODE, not a stack — composing
   * them would make the real start scale `zoom × fromScale` and every number in
   * the UI a lie. Undefined means "zoom", which is every Beat authored before
   * Ken Burns existed.
   */
  framing?: "zoom" | "kenBurns";
  /** The move, when `framing === "kenBurns"`. Still Beats only for now. */
  kenBurns?: KenBurns;
  /** Duration in seconds the zoom holds when zoomScope === "intro" (default 3). */
  zoomSec?: number;
  /**
   * Fine rotation in degrees, -15..15 (0 = none). Static for the whole beat —
   * unlike zoom there is no scope/animation. Rotating exposes the frame's
   * corners, so the frame is auto-scaled to cover: rotation punches in slightly
   * even at zoom 1×.
   */
  rotation?: number;
}

export interface ColorAdjustments {
  /** Exposure / Brightness offset (-100 to +100, default 0). */
  exposure?: number;
  /** Contrast offset (-100 to +100, default 0). */
  contrast?: number;
  /**
   * Shadows — brightness of the dark region only (-100 to +100, default 0).
   * Tapers to zero at true black, so blacks stay black; use shadowWarmth/
   * shadowTint for a lifted, faded look.
   */
  shadows?: number;
  /**
   * Highlights — brightness of the bright region only (-100 to +100, default 0).
   * Tapers to zero at pure white, mirroring Shadows.
   */
  highlights?: number;
  /** Color tone / Hue offset (-100 to +100, default 0). */
  colorTone?: number;
  /** Warmth / Color temperature offset — blue↔amber (-100 to +100, default 0). */
  warmth?: number;
  /** Saturation offset (-100 to +100, default 0). */
  saturation?: number;
  /** Tint — green↔magenta, the second white-balance axis (-100 to +100, default 0). */
  tint?: number;
  /** Split-tone: shadows warmth — blue↔amber (-100 to +100, default 0). */
  shadowWarmth?: number;
  /** Split-tone: shadows tint — green↔magenta (-100 to +100, default 0). */
  shadowTint?: number;
  /** Split-tone: highlights warmth — blue↔amber (-100 to +100, default 0). */
  highlightWarmth?: number;
  /** Split-tone: highlights tint — green↔magenta (-100 to +100, default 0). */
  highlightTint?: number;
}

export type OverlayBlendMode = "normal" | "screen" | "multiply" | "overlay";

/**
 * An image placed over the Cut on its own lane (ADR-0011). The asset lives in the
 * project's stickers/ folder; this is the *placement*, so one asset can be placed
 * many times. Shaped like SfxSegment/OverlayClip for the timeline half, plus the
 * spatial fields those have no need for.
 *
 * Position and size are fractions of the frame, not pixels, so a placement stays
 * correct across the 16:9 / 9:16 / 1:1 aspects.
 */
export interface Sticker {
  id: string;
  /** Filename within the stickers/ directory. */
  fileName: string;
  startTimeSec: number;
  durationSec: number;
  /** Centre X as a fraction of frame width (0 = left edge, 0.5 = centred, 1 = right). */
  x: number;
  /** Centre Y as a fraction of frame height (0 = top, 0.5 = centred, 1 = bottom). */
  y: number;
  /** Width as a fraction of the frame's width (0.01..2). Height follows the asset's aspect. */
  scale: number;
  /**
   * Degrees, -180..180. Full range on purpose: unlike a Beat's rotation — which
   * straightens footage and is deliberately capped at ±15° — a Sticker's rotation
   * is placement, where any angle is legitimate.
   */
  rotation: number;
  /** 0..1. */
  opacity: number;
  /**
   * When true the Sticker spans the whole Beat it starts in, following that
   * Beat's trim rather than keeping its own start/duration. The window is
   * DERIVED at read time (see resolveSticker) rather than written back, so
   * retrimming the Beat can never leave a stale duration behind. Its own
   * startTimeSec still decides which Beat it belongs to.
   */
  fitToBeat?: boolean;
  /** Tint colour laid over the asset, clipped to its alpha. Hex, default white. */
  tintColor?: string;
  /**
   * How strongly the tint applies, 0..1. 0 leaves the asset untouched; 1 makes it
   * a solid silhouette of `tintColor`. Recolouring a monochrome icon needs this
   * rather than a hue rotation — hue-rotating near-black does nothing.
   */
  tintStrength?: number;
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
  volume?: number; // 0..1 volume multiplier (default 1)
}


/**
 * A sound effect placed on the SFX track — its own timeline lane, independent of the
 * beats (like VoSegment/OverlayClip). References a file in the `audio/` directory by
 * name (resolved via the dev proxy). `durationSec` is the played window, clamped to
 * `sourceDurationSec` (the file's true length) — trim-tail only, no loop. Mixed into
 * the live Cut preview and the export at `startTimeSec` with per-segment `volume`.
 */
export interface SfxSegment {
  id: string;
  /** Filename within the audio/ directory. */
  fileName: string;
  startTimeSec: number;
  durationSec: number;
  /** The sound file's full decoded length (clamp ceiling for trimming). */
  sourceDurationSec: number;
  /** 0..1 playback volume. */
  volume: number;
  /** When true, durationSec dynamically locks to the length of the beat it lands on (clamped to sourceDurationSec). */
  fitToBeat?: boolean;
}


/** The assembled, editable draft — the ordered sequence of Beats and Overlays. */
export interface Cut {
  beats: Beat[];
  overlays?: OverlayClip[];
  /** Narration + caption segments on the independent VO track. */
  voSegments?: VoSegment[];
  /** Sound effects on the independent SFX track. */
  sfxSegments?: SfxSegment[];
  /** Images placed over the Cut on the independent Sticker track (ADR-0011). */
  stickers?: Sticker[];
  aspect: Aspect;
  /** Non-destructive global look & feel color filter preset ID. */
  globalFilterId?: string;
  /** Global filter intensity scale (0..1, default 1). */
  globalFilterIntensity?: number;
  /** Fine-tuned custom color adjustments overriding the preset defaults. */
  globalFilterAdjustments?: ColorAdjustments;
}
