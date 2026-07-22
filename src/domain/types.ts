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
  /**
   * On-screen length. Normally equals outSec - inSec. After a voiceover export it
   * equals the narration's length; if that exceeds the trimmed footage the export
   * freezes the last frame for the remainder, so durationSec > outSec - inSec.
   * When `captionDurations` is set it equals the sum of those per-line timers.
   */
  durationSec: number;
  /**
   * The Script segment (spoken as Voiceover) and the Caption (shown on-screen)
   * are two distinct roles, kept identical in v1 — do NOT collapse them into one
   * field. Voiceover reads `scriptText`; the burned-in caption + `.srt` read
   * `captionText`. Keeping both is the seam that lets them diverge later.
   */
  scriptText: string;
  captionText: string;
  /**
   * Optional author-set per-line caption timers, in seconds, aligned to
   * `captionText`'s raw lines (row i ↔ captionDurations[i]). When present, the
   * caption lines stop stacking and instead play in sequence — each line on
   * screen for its own timer — and the beat's on-screen clock becomes the sum of
   * the timers (see pacing.captionSchedule). Undefined = today's behavior: lines
   * stack for the whole beat and duration comes from the spoken-length estimate.
   */
  captionDurations?: number[];
  /** Optional minor color adjustments for exposure, contrast, color tone, and saturation. */
  colorAdjustments?: ColorAdjustments;
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

/** The assembled, editable draft — the ordered sequence of Beats. */
export interface Cut {
  beats: Beat[];
  aspect: Aspect;
}
