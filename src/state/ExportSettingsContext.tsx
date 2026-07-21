import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Voice } from "../lib/kokoroTts";
import type { TtsEngine } from "../lib/tts";
import { DEFAULT_ELEVEN_VOICE } from "../lib/elevenLabs";

// Export-page settings live here (not in ExportView) so they survive tab
// navigation — switching away and back keeps every slider, dropdown, and upload.
export interface ExportSettings {
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
  titleText: string;
  titleFontId: string;
  titleFontFile: File | null;
  titleSize: number;
  titleColor: string;
  titlePos: "top" | "center" | "bottom";
  titleScope: "intro" | "entire";
}

const DEFAULTS: ExportSettings = {
  captionScale: 0.5,
  captionOpacity: 0,
  captionLineHeight: 1.0,
  voiceover: true,
  ttsEngine: "elevenlabs",
  voice: "af_heart",
  elevenVoiceId: DEFAULT_ELEVEN_VOICE,
  voiceoverSpeed: 0.9,
  voiceoverLeadSec: 0.5,
  voiceoverGapSec: 0.5,
  music: null,
  musicVolume: 0.2,
  titleText: "",
  titleFontId: "sans",
  titleFontFile: null,
  titleSize: 140,
  titleColor: "#ffffff",
  titlePos: "center",
  titleScope: "intro",
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
