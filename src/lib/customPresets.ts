import defaultPresets from "../data/filterPresets.json";
import type { ColorAdjustments } from "../domain/types";

export interface FilterPreset {
  id: string;
  name: string;
  description: string;
  colorAdjustments: ColorAdjustments;
  previewGradient: string;
  isCustom?: boolean;
}

const STORAGE_KEY = "simple_editor_custom_filter_presets";

export function loadCustomPresets(): FilterPreset[] {
  if (typeof window === "undefined" || !window.localStorage) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveCustomPreset(name: string, colorAdjustments: ColorAdjustments, description?: string): FilterPreset {
  const existing = loadCustomPresets();
  const genId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  const id = `custom-${genId}`;

  // Generate an attractive preview gradient based on warmth, colorTone, and exposure
  const warm = colorAdjustments.warmth ?? 0;
  const tone = colorAdjustments.colorTone ?? 0;
  const sat = colorAdjustments.saturation ?? 0;

  let c1 = "#2b3036";
  let c2 = "#ffb339";
  if (sat < -50) {
    c1 = "#111111";
    c2 = "#888888";
  } else if (warm > 15) {
    c1 = "#e67e22";
    c2 = "#f1c40f";
  } else if (warm < -15 || tone < -15) {
    c1 = "#00e5ff";
    c2 = "#10062b";
  }

  const newPreset: FilterPreset = {
    id,
    name: name.trim() || "Custom Preset",
    description: description || "User-customized color grading preset",
    colorAdjustments: { ...colorAdjustments },
    previewGradient: `linear-gradient(135deg, ${c1} 0%, ${c2} 100%)`,
    isCustom: true,
  };

  const updated = [newPreset, ...existing];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (e) {
    console.error("Failed to save custom preset to localStorage:", e);
  }

  return newPreset;
}

export function deleteCustomPreset(id: string): void {
  const existing = loadCustomPresets();
  const updated = existing.filter((p) => p.id !== id);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (e) {
    console.error("Failed to delete custom preset from localStorage:", e);
  }
}

export function getAllFilterPresets(): FilterPreset[] {
  const custom = loadCustomPresets();
  const defaults = defaultPresets as FilterPreset[];
  return [...custom, ...defaults];
}

export function getFilterPresetById(id?: string | null): FilterPreset | undefined {
  if (!id) return undefined;
  return getAllFilterPresets().find((p) => p.id === id);
}
