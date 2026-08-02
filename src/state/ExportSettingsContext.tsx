import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Voice } from "../lib/kokoroTts";
import type { TtsEngine } from "../lib/tts";
import { DEFAULT_ELEVEN_VOICE, DEFAULT_ELEVEN_MODEL } from "../lib/elevenLabs";
import { activeVoPresetSettings } from "../lib/voPresets";

import type { ExportQuality, TitleAnimation } from "../features/export/export";
import type { TitleScope } from "../features/export/titleTiming";
import type { UserVoiceEffect } from "../domain/types";
import { DEFAULT_CAPTION_FONT_ID } from "../features/export/captionFont";

// Export-page settings live here (not in ExportView) so they survive tab
// navigation — switching away and back keeps every slider, dropdown, and upload.
export interface TitleLayerSettings {
  id: string;
  enabled: boolean;
  text: string;
  fontId: string;
  fontFile: File | null;
  weight: number;
  sizePx: number;
  letterSpacing: number;
  arcDeg: number;
  shadow: boolean;
  color: string;
  posX: number;
  posY: number;
  scope: TitleScope;
  introSec: number;
  /** Start time in Cut seconds, or Beat-local seconds for a Beat title. */
  startSec?: number;
  /** Visible duration when scope is "range". */
  durationSec?: number;
  /** Fade at the end of Intro/Timed range. Undefined preserves the default: on. */
  fadeOut?: boolean;
  animation?: TitleAnimation;
  animDurationSec?: number;
  boxWidthPct?: number;
  lineHeight?: number;
  typewriterCursor?: boolean;
  /** "video" reveals the composited picture through the title glyphs. */
  maskMode?: "none" | "video";
  /** Opaque matte behind a video-mask title. Defaults to black. */
  maskColor?: string;
}


export interface ExportSettings {
  exportQuality: ExportQuality;
  exportResolution: "720p" | "1080p";
  exportFps: 24 | 30 | 60;
  exportFormat: "mp4" | "webm";
  captionScale: number;
  captionOpacity: number;
  captionLineHeight: number;
  /** Font id for captions. Empty keeps the bundled caption face (see captionFont.ts). */
  captionFontId: string;
  voiceover: boolean;
  ttsEngine: TtsEngine;
  voice: Voice;
  elevenVoiceId: string;
  /** ElevenLabs model id (quality vs fast; v3 supports audio tags). */
  elevenModel: string;
  /** ElevenLabs voice stability 0..1 (lower = more expressive/variable). */
  elevenStability: number;
  /** ElevenLabs style exaggeration 0..1 (0 = off). */
  elevenStyle: number;
  /** Narration audio volume multiplier 0..1. */
  voiceoverVolume: number;
  /** Global VO tone, same shelves as the User VO track. 0 dB is neutral. */
  voiceoverBassDb: number;
  voiceoverTrebleDb: number;
  /** Character filter for narration, same presets as the User VO track. */
  voiceoverEffect: UserVoiceEffect;
  /** Narration speed, 0.7 (slow) .. 1.2 (fast); 1 = natural. */
  voiceoverSpeed: number;

  /** Silent lead-in before each beat's narration begins, seconds. */
  voiceoverLeadSec: number;
  /** Silent tail after each beat's narration ends, seconds. */
  voiceoverGapSec: number;
  music: File | null;
  musicVolume: number;
  /** 3 stacked title layers */
  titleLayers: TitleLayerSettings[];
  // Legacy single title settings for fallback
  titleText: string;
  titleFontId: string;
  titleFontFile: File | null;
  titleWeight: number;
  titleSize: number;
  titleColor: string;
  titlePos: "top" | "center" | "bottom";
  titleScope: TitleScope;
  titleIntroSec: number;
}

const DEFAULT_TITLE_LAYERS: TitleLayerSettings[] = [
  {
    id: "layer-1",
    // Off until it has text, matching makeBeatTitleLayers() and the invariant
    // TitleTreatmentEditor enforces — typing turns it on.
    enabled: false,
    text: "",
    fontId: "outfit",
    fontFile: null,
    weight: 700,
    sizePx: 140,
    letterSpacing: 0,
    arcDeg: 0,
    shadow: true,
    color: "#ffffff",
    posX: 0,
    posY: -12,
    scope: "intro",
    introSec: 3,
    animation: "fade",
  },
  {
    id: "layer-2",
    enabled: false,
    text: "",
    fontId: "inter",
    fontFile: null,
    weight: 400,
    sizePx: 70,
    letterSpacing: 0,
    arcDeg: 0,
    shadow: true,
    color: "#ffd400",
    posX: 0,
    posY: 5,
    scope: "intro",
    introSec: 3,
    animation: "slide_left",
  },
  {
    id: "layer-3",
    enabled: false,
    text: "",
    fontId: "space-grotesk",
    fontFile: null,
    weight: 600,
    sizePx: 45,
    letterSpacing: 0,
    arcDeg: 0,
    shadow: true,
    color: "#ffffff",
    posX: 0,
    posY: 20,
    scope: "intro",
    introSec: 3,
    animation: "slide_bottom",
  },
];

/**
 * A fresh stack of 3 title layers for a Beat's own title treatment. All layers
 * start disabled with empty text (so a beat shows no title until you add one),
 * and default to "entire" scope — a per-beat title shows for that whole beat.
 */
export function makeBeatTitleLayers(): TitleLayerSettings[] {
  return [
    { id: "beat-layer-1", enabled: false, text: "", fontId: "outfit", fontFile: null, weight: 700, sizePx: 120, letterSpacing: 0, arcDeg: 0, shadow: true, color: "#ffffff", posX: 0, posY: -12, scope: "entire", introSec: 3, animation: "fade" },
    { id: "beat-layer-2", enabled: false, text: "", fontId: "inter", fontFile: null, weight: 400, sizePx: 60, letterSpacing: 0, arcDeg: 0, shadow: true, color: "#ffd400", posX: 0, posY: 5, scope: "entire", introSec: 3, animation: "slide_left" },
    { id: "beat-layer-3", enabled: false, text: "", fontId: "space-grotesk", fontFile: null, weight: 600, sizePx: 40, letterSpacing: 0, arcDeg: 0, shadow: true, color: "#ffffff", posX: 0, posY: 20, scope: "entire", introSec: 3, animation: "slide_bottom" },
  ];
}

import { EDITOR_DEFAULTS } from "../config/editorDefaults";

const DEFAULTS: ExportSettings = {
  exportQuality: EDITOR_DEFAULTS.DEFAULT_EXPORT_QUALITY,
  exportResolution: "1080p",
  exportFps: 30,
  exportFormat: "mp4",
  captionScale: EDITOR_DEFAULTS.CAPTIONS.DEFAULT_SCALE,
  captionOpacity: EDITOR_DEFAULTS.CAPTIONS.DEFAULT_OPACITY,
  captionLineHeight: EDITOR_DEFAULTS.CAPTIONS.DEFAULT_LINE_HEIGHT,
  captionFontId: DEFAULT_CAPTION_FONT_ID,
  voiceover: true,
  ttsEngine: "elevenlabs",
  voice: "af_heart",
  elevenVoiceId: DEFAULT_ELEVEN_VOICE,
  elevenModel: DEFAULT_ELEVEN_MODEL,
  elevenStability: 0.5,
  elevenStyle: 0,
  voiceoverVolume: EDITOR_DEFAULTS.AUDIO.DEFAULT_VOICEOVER_VOLUME,
  voiceoverBassDb: 0,
  voiceoverTrebleDb: 0,
  voiceoverEffect: "none",
  voiceoverSpeed: EDITOR_DEFAULTS.AUDIO.DEFAULT_VOICEOVER_SPEED,

  voiceoverLeadSec: EDITOR_DEFAULTS.AUDIO.DEFAULT_VOICEOVER_LEAD_SEC,
  voiceoverGapSec: EDITOR_DEFAULTS.AUDIO.DEFAULT_VOICEOVER_GAP_SEC,
  music: null,
  musicVolume: EDITOR_DEFAULTS.AUDIO.DEFAULT_MUSIC_VOLUME,
  titleLayers: DEFAULT_TITLE_LAYERS,
  titleText: "",
  titleFontId: "outfit",
  titleFontFile: null,
  titleWeight: 400, // Normal by default
  titleSize: 140,
  titleColor: "#ffffff",
  titlePos: "center",
  titleScope: "intro",
  titleIntroSec: 3,
};

const EXPORT_SETTINGS_KEY = "simple_editor_export_settings";

function loadSavedExportSettings(): ExportSettings {
  const base = { ...DEFAULTS, ...activeVoPresetSettings() };
  if (typeof localStorage === "undefined") return base;
  try {
    const raw = localStorage.getItem(EXPORT_SETTINGS_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw);
    return { ...base, ...parsed };
  } catch {
    return base;
  }
}

function saveExportSettingsToStorage(settings: ExportSettings) {
  if (typeof localStorage === "undefined") return;
  try {
    const { music, titleFontFile, ...rest } = settings;
    const cleanTitleLayers = rest.titleLayers?.map(({ fontFile, ...lRest }) => lRest);
    localStorage.setItem(
      EXPORT_SETTINGS_KEY,
      JSON.stringify({ ...rest, titleLayers: cleanTitleLayers })
    );
  } catch (e) {
    console.error("Failed to save export settings to localStorage:", e);
  }
}

const Ctx = createContext<{
  settings: ExportSettings;
  update: (patch: Partial<ExportSettings>) => void;
  reset: () => void;
} | null>(null);

export function ExportSettingsProvider({ children }: { children: ReactNode }) {
  // Seed from stored export settings (or factory DEFAULTS overlaid with active VO preset).
  const [settings, setSettings] = useState<ExportSettings>(() => loadSavedExportSettings());

  const update = (patch: Partial<ExportSettings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      saveExportSettingsToStorage(next);
      return next;
    });
  };

  // Dev convenience: auto-load the default music bed configured via DEFAULT_MUSIC
  // in .env.local (served by the dev server at /api/default-music). A browser
  // File can't be built from a path in code, so we fetch the bytes and wrap them.
  // Only fills in when music isn't already set, and no-ops in production or when
  // the path is missing / the drive isn't mounted.
  const loadDefaultMusic = useCallback(() => {
    if (!import.meta.env.DEV) return;
    (async () => {
      try {
        const res = await fetch("/api/default-music");
        if (!res.ok) return;
        const blob = await res.blob();
        const name = res.headers.get("x-music-name") || "background-music.mp3";
        const file = new File([blob], name, { type: blob.type || "audio/mpeg" });
        setSettings((s) => (s.music ? s : { ...s, music: file }));
      } catch { /* no default configured, or drive not mounted */ }
    })();
  }, []);

  useEffect(() => { loadDefaultMusic(); }, [loadDefaultMusic]);

  // "Start over" / new project reverts to factory DEFAULTS but keeps the user's active VO preset.
  const reset = () => {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(EXPORT_SETTINGS_KEY);
    }
    setSettings({ ...DEFAULTS, ...activeVoPresetSettings() });
    loadDefaultMusic();
  };

  return <Ctx.Provider value={{ settings, update, reset }}>{children}</Ctx.Provider>;
}

export function useExportSettings() {
  const ctx = useContext(Ctx);
  return ctx ?? { settings: DEFAULTS, update: () => {}, reset: () => {} };
}
