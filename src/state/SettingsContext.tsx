import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

const STORAGE_KEY = "vidstr_settings";

export type AiProvider = "claude" | "antigravity";

export interface Settings {
  aiProvider: AiProvider;
  analyzeModel: string;
  authorModel: string;
  /** Tone/mood that steers the vlog coaching (Analyze) and script voice (Author). */
  tone: string;
  /** Whether the AI "Author Story & Script" bar (Step 2) is shown in the workspace. */
  showStoryBar: boolean;
}

const DEFAULTS: Settings = {
  aiProvider: "claude",
  analyzeModel: "claude-haiku-4-5",
  authorModel: "claude-opus-4-8",
  tone: "casual",
  showStoryBar: true,
};

export const AI_PROVIDER_OPTIONS: { id: AiProvider; label: string }[] = [
  { id: "claude", label: "Claude Code CLI (claude -p)" },
  { id: "antigravity", label: "Antigravity CLI (antigravity)" },
];

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

/** Load persisted settings, merged over DEFAULTS so new fields get their default. */
function loadSettings(): Settings {
  if (typeof localStorage === "undefined") return DEFAULTS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return DEFAULTS;
  }
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const update = (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch }));
  const reset = () => setSettings(DEFAULTS);

  // Persist across reloads. "Start over" calls reset() → DEFAULTS is written back.
  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      /* storage full or blocked — settings just won't persist */
    }
  }, [settings]);

  return <SettingsContext.Provider value={{ settings, update, reset }}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within a SettingsProvider");
  return ctx;
}
