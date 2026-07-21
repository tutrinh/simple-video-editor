import { createContext, useContext, useState, type ReactNode } from "react";

// Per-stage model config (ADR-0001: cheap for analyze, stronger for authoring).
// No API key — AI calls run through the local `claude -p` proxy (ADR-0005).
export interface Settings {
  analyzeModel: string;
  authorModel: string;
  /** Tone/mood that steers the vlog coaching (Analyze) and script voice (Author). */
  tone: string;
}

const DEFAULTS: Settings = {
  analyzeModel: "claude-haiku-4-5",
  authorModel: "claude-opus-4-8",
  tone: "casual",
};

export const MODEL_OPTIONS = ["claude-haiku-4-5", "claude-sonnet-5", "claude-opus-4-8"] as const;

// Tone/mood presets. `hint` is the phrase injected into the AI prompts.
export const TONE_OPTIONS = [
  { id: "casual", label: "Casual / authentic", hint: "casual, authentic, conversational" },
  { id: "hype", label: "Hype / energetic", hint: "high-energy, hyped, exciting" },
  { id: "chill", label: "Chill / calm", hint: "relaxed, calm, easygoing" },
  { id: "funny", label: "Funny / playful", hint: "playful, funny, lighthearted" },
  { id: "cinematic", label: "Cinematic / dramatic", hint: "moody, cinematic, dramatic" },
  { id: "informative", label: "Informative / clear", hint: "clear, informative, straightforward" },
  { id: "heartfelt", label: "Heartfelt / wholesome", hint: "warm, heartfelt, personal" },
] as const;

/** The prompt phrase for a tone id (empty if unknown). */
export function toneHint(id: string): string {
  return TONE_OPTIONS.find((t) => t.id === id)?.hint ?? "";
}

const SettingsContext = createContext<{
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  reset: () => void;
} | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const update = (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch }));
  const reset = () => setSettings(DEFAULTS);
  return <SettingsContext.Provider value={{ settings, update, reset }}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within a SettingsProvider");
  return ctx;
}
