import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Voice } from "../lib/kokoroTts";
import type { TtsEngine } from "../lib/tts";
import { DEFAULT_ELEVEN_VOICE } from "../lib/elevenLabs";

import type { ExportQuality, TitleAnimation } from "../features/export/export";

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
  scope: "intro" | "entire";
  introSec: number;
  animation?: TitleAnimation;
  animDurationSec?: number;
}

export interface ExportSettings {
  exportQuality: ExportQuality;
  captionScale: number;
  captionOpacity: number;
  captionLineHeight: number;
  voiceover: boolean;
  ttsEngine: TtsEngine;
  voice: Voice;
  elevenVoiceId: string;
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
  titleScope: "intro" | "entire";
  titleIntroSec: number;
}

const DEFAULT_TITLE_LAYERS: TitleLayerSettings[] = [
  {
    id: "layer-1",
    enabled: true,
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

import { EDITOR_DEFAULTS } from "../config/editorDefaults";

const DEFAULTS: ExportSettings = {
  exportQuality: EDITOR_DEFAULTS.DEFAULT_EXPORT_QUALITY,
  captionScale: EDITOR_DEFAULTS.CAPTIONS.DEFAULT_SCALE,
  captionOpacity: EDITOR_DEFAULTS.CAPTIONS.DEFAULT_OPACITY,
  captionLineHeight: EDITOR_DEFAULTS.CAPTIONS.DEFAULT_LINE_HEIGHT,
  voiceover: true,
  ttsEngine: "elevenlabs",
  voice: "af_heart",
  elevenVoiceId: DEFAULT_ELEVEN_VOICE,
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

const Ctx = createContext<{
  settings: ExportSettings;
  update: (patch: Partial<ExportSettings>) => void;
  reset: () => void;
} | null>(null);

export function ExportSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<ExportSettings>(DEFAULTS);
  const update = (patch: Partial<ExportSettings>) => setSettings((s) => ({ ...s, ...patch }));

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
  const reset = () => { setSettings(DEFAULTS); loadDefaultMusic(); };

  return <Ctx.Provider value={{ settings, update, reset }}>{children}</Ctx.Provider>;
}

export function useExportSettings() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useExportSettings must be used within an ExportSettingsProvider");
  return ctx;
}
