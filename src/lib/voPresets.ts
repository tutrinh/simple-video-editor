import type { Voice } from "./kokoroTts";
import type { TtsEngine } from "./tts";

// Named Voiceover presets (mirrors titlePresets.ts, but GLOBAL — not per-project —
// so a preset the user saves is available in every project and survives reloads /
// "Start over"). The last-applied preset auto-seeds new sessions so the user doesn't
// re-adjust every time. Only VO fields are stored (music is a File).
export interface VoSettings {
  voiceover: boolean;
  ttsEngine: TtsEngine;
  voice: Voice;
  elevenVoiceId: string;
  elevenModel: string;
  elevenStability: number;
  elevenStyle: number;
  voiceoverSpeed: number;
  voiceoverLeadSec: number;
  voiceoverGapSec: number;
}

export interface VoPreset {
  id: string;
  name: string;
  settings: VoSettings;
}

const PRESETS_KEY = "vidstr_vo_presets";
// Which preset auto-seeds new sessions / "Start over" — set explicitly via the ★
// toggle, independent of which preset is merely applied in the current session.
const DEFAULT_KEY = "vidstr_vo_default_preset";

export function loadVoPresets(): VoPreset[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(PRESETS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((p) => p && typeof p.name === "string" && p.settings);
  } catch { /* ignore */ }
  return [];
}

function persist(presets: VoPreset[]): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
  } catch { /* storage full or blocked */ }
}

/** Save a new preset (newest first). Returns the created preset. */
export function saveVoPreset(name: string, settings: VoSettings): VoPreset {
  const preset: VoPreset = { id: `vo-${Date.now()}`, name: name.trim() || "Untitled preset", settings };
  persist([preset, ...loadVoPresets()]);
  return preset;
}

/** Overwrite an existing preset's settings (keeps its id/name). Returns it, or null. */
export function updateVoPreset(id: string, settings: VoSettings): VoPreset | null {
  const presets = loadVoPresets();
  const idx = presets.findIndex((p) => p.id === id);
  if (idx < 0) return null;
  const updated: VoPreset = { ...presets[idx], settings };
  const next = presets.slice();
  next[idx] = updated;
  persist(next);
  return updated;
}

export function deleteVoPreset(id: string): void {
  persist(loadVoPresets().filter((p) => p.id !== id));
  if (getDefaultPresetId() === id) setDefaultPresetId(null);
}

/** The preset marked as the auto-load default (via the ★ toggle), if any. */
export function getDefaultPresetId(): string | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(DEFAULT_KEY);
  } catch {
    return null;
  }
}

export function setDefaultPresetId(id: string | null): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (id) localStorage.setItem(DEFAULT_KEY, id);
    else localStorage.removeItem(DEFAULT_KEY);
  } catch { /* ignore */ }
}

/** The settings of the default preset (for seeding on load/reset), or {}. */
export function activeVoPresetSettings(): Partial<VoSettings> {
  const id = getDefaultPresetId();
  if (!id) return {};
  return loadVoPresets().find((p) => p.id === id)?.settings ?? {};
}
