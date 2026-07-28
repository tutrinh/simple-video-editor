import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

const STORAGE_KEY = "vidstr_settings";

export type AiProvider = "claude" | "codex";

export interface Settings {
  aiProvider: AiProvider;
  analyzeModel: string;
  authorModel: string;
  /** Tone/mood that steers the vlog coaching (Analyze) and script voice (Author). */
  tone: string;
  /** Genre/format that steers the Author prompt's structure (orthogonal to tone). */
  scriptType: string;
}

const DEFAULTS: Settings = {
  aiProvider: "claude",
  analyzeModel: "claude-haiku-4-5",
  authorModel: "claude-opus-4-8",
  tone: "casual",
  scriptType: "auto",
};

export const AI_PROVIDER_OPTIONS: { id: AiProvider; label: string }[] = [
  { id: "claude", label: "Claude Code CLI (claude -p)" },
  { id: "codex", label: "Codex CLI (codex exec)" },
];

/** Normalize persisted provider ids after engines are removed or renamed. */
export function normalizeAiProvider(value: unknown): AiProvider {
  return value === "codex" ? "codex" : "claude";
}

export const MODEL_OPTIONS = ["claude-haiku-4-5", "claude-sonnet-5", "claude-opus-4-8"] as const;
export const CODEX_MODEL_OPTIONS = ["gpt-5.6", "gpt-5.4", "gpt-5.3-codex"] as const;

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

// Script Type / genre presets. Unlike Tone (voice), `hint` steers the *structure*
// of the authored story — injected into the Author prompt. "auto" = no steer.
export const SCRIPT_TYPE_OPTIONS = [
  { id: "auto", label: "Auto / general", hint: "" },
  { id: "product-review", label: "Product review", hint: "Structure as a product review — hook with the product, walk through standout features and real use, land on a clear verdict or recommendation." },
  { id: "vlog", label: "Vlog / day-in-the-life", hint: "Structure as a personal vlog — first-person, day-in-the-life momentum, casual narration that carries the viewer from moment to moment." },
  { id: "explainer", label: "Explainer / how-to", hint: "Structure as an explainer — set up the topic or problem, move step by step in a logical order, end on a concise takeaway." },
  { id: "dramatic-news", label: "Dramatic news / tension", hint: "Structure as dramatic news with rising tension — open with an urgent lede, escalate the stakes beat by beat, hold the biggest reveal until the end." },
  { id: "sports", label: "Sports highlight", hint: "Structure as a sports highlight — play-by-play energy, build toward the biggest plays, finish on a celebratory payoff." },
] as const;

/** The prompt phrase for a script-type id (empty for "auto" or unknown). */
export function scriptTypeHint(id: string): string {
  return SCRIPT_TYPE_OPTIONS.find((t) => t.id === id)?.hint ?? "";
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
    const parsed = JSON.parse(raw) as Partial<Settings>;
    // Antigravity was removed as an engine. Normalize old persisted values so
    // the select never hydrates with an option that no longer exists.
    const aiProvider = normalizeAiProvider(parsed.aiProvider);
    return { ...DEFAULTS, ...parsed, aiProvider };
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
