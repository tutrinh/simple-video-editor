/**
 * Centralized Application Defaults & Configuration
 *
 * Single source of truth for editor defaults including beat durations,
 * video export quality profiles, script pacing, caption styling, and audio settings.
 */

export type ExportQualityProfile = "standard" | "high" | "max";

export interface QualitySetting {
  crf: number;
  preset: string;
  audioBitrate: string;
  label: string;
}

export const EDITOR_DEFAULTS = {
  /** Default duration in seconds when adding a new beat manually or from clip bin */
  DEFAULT_BEAT_DURATION_SEC: 5.0,
  /** Minimum duration in seconds for script pacing */
  MIN_BEAT_DURATION_SEC: 1.5,
  /** Words per second reading pace estimation (~150 wpm) */
  WORDS_PER_SEC: 2.5,

  /** Default aspect ratio */
  DEFAULT_ASPECT: "16:9" as const,

  /** Default video export quality profile */
  DEFAULT_EXPORT_QUALITY: "high" as ExportQualityProfile,

  /** Video Export Quality Profiles (CRF, H.264 Preset, AAC Bitrate).
   *  Preset ladders with quality: ultrafast disables CABAC/deblocking/trellis and
   *  makes coarse, blocky decisions on fine detail (text especially), so the
   *  presets below climb with the profile. Higher presets are slower on
   *  ffmpeg.wasm — the user picks the speed/quality balance via the dropdown. */
  EXPORT_QUALITY_PROFILES: {
    max: {
      crf: 15,
      preset: "veryfast",
      audioBitrate: "320k",
      label: "Maximum (CRF 15 · 320k)",
    },
    high: {
      crf: 18,
      preset: "superfast",
      audioBitrate: "320k",
      label: "High (CRF 18 · 320k)",
    },
    standard: {
      crf: 22,
      preset: "superfast",
      audioBitrate: "192k",
      label: "Standard (CRF 22 · 192k)",
    },
  } as Record<ExportQualityProfile, QualitySetting>,

  /** Default Audio & Voiceover Settings */
  AUDIO: {
    DEFAULT_MUSIC_VOLUME: 0.2,
    DEFAULT_VOICEOVER_SPEED: 0.9,
    DEFAULT_VOICEOVER_LEAD_SEC: 0.5,
    DEFAULT_VOICEOVER_GAP_SEC: 0.5,
  },

  /** Default Caption Styling */
  CAPTIONS: {
    DEFAULT_SCALE: 0.5,
    DEFAULT_OPACITY: 0,
    DEFAULT_LINE_HEIGHT: 1.0,
  },
} as const;
