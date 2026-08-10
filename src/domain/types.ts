// The domain model spine. Names come straight from CONTEXT.md — keep them in
// sync. Clip and Cut/Beat are load-bearing; everything else hangs off them.

export type Aspect = "16:9" | "9:16" | "1:1" | "4:5";

export interface TranscriptWord {
  text: string;
  startSec: number;
  endSec: number;
}

/** The editorial job a Beat performs in the Story Spine. */
export type StoryPurpose = "hook" | "problem" | "proof" | "payoff" | "cta";
export const STORY_PURPOSES: readonly StoryPurpose[] = ["hook", "problem", "proof", "payoff", "cta"];

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
  /**
   * The source's own frame rate, measured on ingest. Undefined when it could not
   * be measured — an older saved Project, a Still, or a browser without
   * `requestVideoFrameCallback`. Distinct from PROJECT_FPS, which every Beat is
   * encoded at: a 60fps source is what makes slowing one smooth (ADR-0020).
   */
  fps?: number;
  /** 1080p-normalized source (ADR-0002: 4K normalized on ingest). */
  normalized?: Blob;
  /** Poster thumbnail (data URL) generated on ingest. */
  poster?: string;
  /** Claude's per-clip understanding (ADR-0001). */
  description?: ClipDescription;
  /** Editor's include/exclude toggle for authoring. Undefined = included. */
  included?: boolean;
  /** User-assigned tags for clip organization (e.g. ["A-Roll", "B-Roll", "Interview"]). */
  tags?: string[];
  /** Empty media slot created when a template has more beats than assigned clips. */
  isTemplatePlaceholder?: boolean;
  /** The template's description of the footage expected in this empty slot. */
  templateSlotDescription?: string;
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

/**
 * One structural slot in a ProjectTemplate — a generic beat description
 * that Claude uses to assign clips during constrained generation.
 */
export interface TemplateBeat {
  /** Human-readable slot label sent to Claude (e.g. "Opening wide shot"). */
  description: string;
  /** Approximate duration in seconds inferred from the reference video. */
  approxDurationSec?: number;
  zoom?: number;
  transition?: VideoTransitionType;
  transitionSec?: number;
}

/**
 * A reusable project blueprint. Captures the extracted edit structure and style
 * hints, plus the optional local reference video used to create it.
 */
export interface ProjectTemplate {
  id: string;
  name: string;
  /** User-visible subtitle, e.g. "Extracted from 'Tokyo Travel Vlog'". */
  description?: string;
  createdAt: number;
  updatedAt: number;
  /** Structural skeleton — one entry per beat slot. */
  beats: TemplateBeat[];
  /** Inferred aspect ratio. */
  aspect?: Aspect;
  /** Visual tone/energy hint passed to Claude during constrained generation. */
  toneHint?: string;
  /** Approximated color grade extracted from the reference video. */
  colorHint?: ColorAdjustments;
  /** Raw text from the Claude extraction — retained for debugging. */
  extractionRaw?: string;
  /**
   * Original local inspiration video, retained so the editor can review the
   * reference alongside its extracted structure. Older templates may not have
   * one because early versions deliberately discarded the source file.
   */
  inspirationVideo?: File;
}

export type SplitLayoutType =
  | "none"
  | "v2-stacked" // 2 rows (top / bottom)
  | "v2-side"    // 2 columns (left / right)
  | "3-row"      // 3 rows (top / middle / bottom)
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

/** Compression-safe mosaic treatment. Pixel size is authored at 1080p/export pixels. */
export interface LedMatrixEffect {
  enabled?: boolean;
  cellSizePx?: number;
  shape?: "pixelate" | "pixelate-circle";
  /** Solid field visible between circular pixels. */
  backgroundColor?: string;
}

export interface SpeedRamp {
  enabled?: boolean;
  startSpeed?: number;
  middleSpeed?: number;
  endSpeed?: number;
  /** End of the start→middle transition, as Beat progress (0..1). */
  firstPoint?: number;
  /** Start of the middle→end transition, as Beat progress (0..1). */
  secondPoint?: number;
  preset?: "custom" | "montage" | "impact" | "slow-reveal";
  curve?: "linear" | "ease-in" | "ease-out" | "smooth" | "custom" | "instant";
  /** 0..1 blend from linear toward the selected easing shape. */
  curveStrength?: number;
  /** Custom cubic Bézier Y controls. */
  curveIn?: number;
  curveOut?: number;
  /** Custom cubic Bézier X controls, enabling tight or broad shoulders. */
  curveInX?: number;
  curveOutX?: number;
  /** 0..1 extra tension beyond cubic Bézier, for near-instant shoulders. */
  curveSharpness?: number;
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
  /** Optional for backward compatibility. The Beat's editorial job in the Story Spine. */
  storyPurpose?: StoryPurpose;
  /** Expected footage for this position when the Beat came from a template. */
  templateSlotDescription?: string;
  /** Creator-selected AI shot execution that fulfills the template slot role. */
  templateSlotSuggestion?: string;
  captionDurations?: number[];
  colorAdjustments?: ColorAdjustments;
  /** Optional Beat override for the Cut-level pixel treatment. */
  ledMatrixEffect?: LedMatrixEffect;
  /** Per-beat stacked title layers, shown during this beat (parallel to the
   *  cut-level title in ExportSettings). Type-only import — erased at runtime,
   *  so no state↔domain runtime cycle. */
  titleLayers?: import("../state/ExportSettingsContext").TitleLayerSettings[];
  /** Video transition into this beat from the preceding beat. */
  transition?: VideoTransitionType;
  /** When true, moving inSec or outSec recalculates the other bound to preserve exact timeline duration (slip edit). */
  lockDuration?: boolean;
  /** Last explicit duration choice. Manual in/out trimming always changes this to "custom". */
  durationPreset?: "0.5" | "1" | "3" | "5" | "10" | "custom";
  /** Optional multi-clip split screen configuration for this beat. */
  splitScreen?: SplitScreenConfig;

  /** Duration of the transition in seconds (default 0.5s). */
  transitionSec?: number;
  /** Position of the transition relative to beat timing ("start" for entering beat, "end" for exiting beat). */
  transitionPosition?: "start" | "end";
  /** Audio volume multiplier for original clip audio (0 to 1, default 1.0 = 100%). */
  volume?: number;
  /** Mutes this Beat's original clip audio without discarding its volume. */
  muted?: boolean;
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
  /**
   * How fast this Beat's footage plays relative to its source — 1 is untouched,
   * lower is slow motion, higher is fast motion (ADR-0019). It does NOT move
   * `durationSec`: the Script still sets the Beat's length (ADR-0004), so
   * slowing shows *less* of the trim window rather than making the Beat last
   * longer, and speeding up spends the window early and leaves Fill to finish.
   * Undefined means 1. Not applicable to a Still, whose picture is identical at
   * any Speed.
   */
  speed?: number;
  /** Optional time-varying playback speed. When enabled it replaces `speed`. */
  speedRamp?: SpeedRamp;
  /**
   * What the Beat shows once its footage is spent before the Beat ends — the
   * last frame holds, or the trim window loops (ADR-0019). Undefined means
   * "hold". Deliberately has no "slow" member: Speed owns how fast the footage
   * plays, and a second owner would make both numbers unreadable (ADR-0015).
   */
  fill?: BeatFill;
}

export type BeatFill = "hold" | "loop";

/** Speed of 1 — footage plays at source rate. */
export const DEFAULT_BEAT_SPEED = 1;

/**
 * The Speeds the slider offers, slowest first. Discrete stops rather than a
 * continuous range because these are the ratios that read as deliberate on a
 * short reel; the domain itself allows any positive Speed (ADR-0019).
 */
export const BEAT_SPEED_STEPS = [0.5, 0.75, 1, 1.5, 2] as const;

/** Index of the nearest offered Speed, for driving a stepped slider. */
export function nearestBeatSpeedIndex(speed: number): number {
  let best = 0;
  for (let i = 1; i < BEAT_SPEED_STEPS.length; i++) {
    if (Math.abs(BEAT_SPEED_STEPS[i] - speed) < Math.abs(BEAT_SPEED_STEPS[best] - speed)) best = i;
  }
  return best;
}

/**
 * The Cut's frame rate — the rate every Segment is encoded at and the rate
 * Ken Burns renders its move at. A single constant so the picture, the move and
 * the encoder cannot disagree. Slowing a Beat conforms to this rate *after*
 * `setpts`, so a 60fps source at 0.5× yields one distinct source frame per
 * output frame rather than duplicated ones.
 */
export const PROJECT_FPS = 30;

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
   * Black point / Lift offset (-100 to +100, default 0).
   * Raises true black into charcoal/fade (+values) or pushes blacks deeper (-values).
   */
  blackPoint?: number;
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
  /** Skin tone / Orange hue offset (-100 to +100, default 0; golden↔rose). */
  skinTone?: number;
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
  /**
   * Creative colour wash applied after the corrective grade. Unlike warmth or
   * tint, this introduces chosen colours into the shadows and highlights.
   */
  colorize?: ColorizeSettings;
}

export interface ColorizeSettings {
  /** CSS hex colour introduced into the dark tonal range. */
  shadowColor: string;
  /** CSS hex colour introduced into the bright tonal range. */
  highlightColor: string;
  /** Overall mix amount (0..100). Zero disables Colorize. */
  intensity: number;
}

export type OverlayBlendMode = "normal" | "screen" | "multiply" | "overlay";

/**
 * An image placed over the Cut on its own lane (ADR-0011). The asset lives in the
 * app's shared stickers/ folder; this is the *placement*, so one asset can be placed
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
  fitToBeat?: boolean;
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

/**
 * Microphone audio recorded while previewing a Beat or the full Cut. The File is
 * persisted out-of-band (like clip media) while this timing metadata stays in
 * the Cut. Recordings are movable and tail-trimmable without modifying the
 * source audio.
 */
export type UserVoiceEffect =
  | "none"
  | "vintage-phone"
  | "walkie-talkie"
  | "old-radio"
  | "megaphone"
  | "intercom"
  | "muffled"
  | "underwater";

export interface UserVoiceSegment {
  id: string;
  name: string;
  file: File;
  startTimeSec: number;
  durationSec: number;
  sourceDurationSec: number;
  /** Browser-generated transcript, editable by the Author. */
  transcript?: string;
  /** Approximate word timings used for readable burned-in captions. */
  transcriptWords?: TranscriptWord[];
  /** Burn the transcript as captions during this recording. */
  captionVisible?: boolean;
  /** Non-destructive in-point within the original recording. Defaults to 0. */
  sourceStartSec?: number;
  /** 0..1.5 playback volume (up to 150%). */
  volume: number;
  /** Post-EQ segment gain in decibels. Missing values load as 0 dB. */
  levelDb?: number;
  /** Low-shelf gain in decibels. Missing values load as the neutral 0 dB. */
  bassDb?: number;
  /** High-shelf gain in decibels. Missing values load as the neutral 0 dB. */
  trebleDb?: number;
  /** Non-destructive voice character filter. Missing values load as clean audio. */
  voiceEffect?: UserVoiceEffect;
}

export interface MusicCueMarker {
  timeSec: number;
  /** Normalized onset confidence, 0..1. */
  strength: number;
}

/** One project-owned music bed. Video imports are reduced to their audio stream. */
export interface MusicTrack {
  id: string;
  name: string;
  /** Audio-only file used by preview and export. Never retains imported video bytes. */
  file: File;
  /** Filename in the app-wide Music library; this is what saved projects own. */
  fileName?: string;
  durationSec: number;
  /** Peak amplitudes reduced for timeline drawing. */
  waveform: number[];
  /** Detected rhythmic/onset changes used as optional edit cues. */
  cueMarkers: MusicCueMarker[];
  volume: number;
  /** Silences the track in preview and export without losing its level. */
  muted?: boolean;
  sourceKind: "audio" | "video-audio";
}


/** The assembled, editable draft — the ordered sequence of Beats and Overlays. */
export interface Cut {
  beats: Beat[];
  /** Master multiplier for every Beat's original clip audio (0..1, default 1). */
  beatAudioMasterVolume?: number;
  /** Master mute for Beat audio only; narration, User VO, SFX, and music are unaffected. */
  beatAudioMuted?: boolean;
  /** Template provenance retained so AI Story can honor the source edit's intent. */
  templateName?: string;
  templateToneHint?: string;
  overlays?: OverlayClip[];
  /** Narration + caption segments on the independent VO track. */
  voSegments?: VoSegment[];
  /** Sound effects on the independent SFX track. */
  sfxSegments?: SfxSegment[];
  /** Microphone recordings on the independent User VO track. */
  userVoiceSegments?: UserVoiceSegment[];
  /** Images placed over the Cut on the independent Sticker track (ADR-0011). */
  stickers?: Sticker[];
  aspect: Aspect;
  /** Non-destructive global look & feel color filter preset ID. */
  globalFilterId?: string;
  /** Global filter intensity scale (0..1, default 1). */
  globalFilterIntensity?: number;
  /** Fine-tuned custom color adjustments overriding the preset defaults. */
  globalFilterAdjustments?: ColorAdjustments;
  /** Pixel treatment inherited by Beats without an override. */
  ledMatrixEffect?: LedMatrixEffect;
}

/** Which edge a Veil's gradient runs toward; "down" puts the from-stop on top. */
export type VeilDirection = "down" | "up" | "right" | "left";

/**
 * A colour laid over a Cover's picture, beneath its Stickers and Titles, so the
 * photograph recedes and the text above it reads.
 *
 * `color`/`opacity` is both the solid fill and the gradient's from-stop, and the
 * to-stop is retained in either mode, so toggling `mode` never discards a value
 * the author set.
 */
export interface Veil {
  mode: "solid" | "linear";
  /** Hex. The solid fill, and the gradient's from-stop. */
  color: string;
  /** 0..1. */
  opacity: number;
  /** Hex. The gradient's to-stop. Unused while `mode` is "solid". */
  toColor: string;
  /** 0..1. Unused while `mode` is "solid". */
  toOpacity: number;
  direction: VeilDirection;
}

/**
 * The TitleLayerSettings fields a still has no use for — everything about time.
 * A runtime constant rather than a bare Omit list so a test can assert it, and
 * `satisfies` so a typo or a renamed field fails the build instead of silently
 * omitting nothing.
 */
export const COVER_TITLE_OMITTED_FIELDS = [
  "scope",
  "introSec",
  "startSec",
  "durationSec",
  "fadeOut",
  "animation",
  "animDurationSec",
  "typewriterCursor",
] as const satisfies readonly (keyof import("../state/ExportSettingsContext").TitleLayerSettings)[];

/**
 * A Cover's Title overlay. Derived from TitleLayerSettings rather than
 * hand-copied, so a new appearance field there appears here for free. Type-only
 * import — erased at runtime, so no state↔domain runtime cycle.
 */
export type CoverTitle = Omit<
  import("../state/ExportSettingsContext").TitleLayerSettings,
  (typeof COVER_TITLE_OMITTED_FIELDS)[number]
>;

/** The Sticker fields that place it on a timeline, which a Cover does not have. */
export const COVER_STICKER_OMITTED_FIELDS = [
  "startTimeSec",
  "durationSec",
  "fitToBeat",
] as const satisfies readonly (keyof Sticker)[];

/** A Sticker placed on a Cover: the same asset, position, scale, rotation and
 *  tint, with the timeline fields removed. */
export type CoverSticker = Omit<Sticker, (typeof COVER_STICKER_OMITTED_FIELDS)[number]>;

/**
 * A still image dressed to advertise the Project (ADR-0021). Its picture is
 * either captured from a Beat or supplied from a file; either way the Cover
 * keeps those pixels, so retrimming, reordering or deleting whatever it came
 * from never disturbs it.
 *
 * Origin is deliberately not modelled. Nothing about a Cover branches on it
 * after ingest — unlike `Clip.kind`, where duration, ffmpeg input and frame
 * sampling all do — so it survives only as `sourceLabel` text.
 */
export interface Cover {
  id: string;
  /** The picture itself, long edge capped at COVER_MAX_EDGE on the way in. */
  frame: File;
  /** Provenance for the author's eye — "Beat 2 @ 1.4s" or "sunset.jpg". Never resolved. */
  sourceLabel: string;
  /** Output aspect. Seeded from the Cut's, then independent of it. */
  aspect: Aspect;
  /** Framing: the same scale-and-centre model a Beat's Zoom uses (ADR-0021). */
  zoom: number;
  /** Horizontal focus, -50..50 (0 = centred). */
  zoomX: number;
  /** Vertical focus, -50..50 (0 = centred). */
  zoomY: number;
  /**
   * Fine rotation in degrees, -15..15, matching a Beat's straightening range.
   * The picture is scaled to cover, so a rotation never shows the corners it
   * exposes — a Beat leaves them visible, but wedges of background on a cover
   * image just read as broken. Optional: covers authored before it default to 0.
   */
  rotation?: number;
  /**
   * Flattened once at capture via `resolveGrade`, so a Cover never follows a
   * later re-grade of the Cut. An uploaded picture starts neutral.
   */
  grade: ColorAdjustments;
  veil?: Veil;
  stickers: CoverSticker[];
  titles: CoverTitle[];
}
