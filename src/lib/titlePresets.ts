import type { TitleLayerSettings } from "../state/ExportSettingsContext";

export interface TitlePreset {
  id: string;
  name: string;
  isBuiltIn?: boolean;
  layers: Omit<TitleLayerSettings, "fontFile">[];
}

export const BUILT_IN_PRESETS: TitlePreset[] = [
  {
    id: "cinematic-gold",
    name: "✨ Cinematic Gold",
    isBuiltIn: true,
    layers: [
      { id: "layer-1", enabled: true, text: "SUMMER VIBES", fontId: "outfit", weight: 800, sizePx: 140, letterSpacing: 6, arcDeg: 0, shadow: true, color: "#ffd700", posX: 0, posY: -14, scope: "intro", introSec: 3 },
      { id: "layer-2", enabled: true, text: "OFFICIAL HIGHLIGHT REEL", fontId: "playfair", weight: 400, sizePx: 60, letterSpacing: 2, arcDeg: 0, shadow: true, color: "#ffffff", posX: 0, posY: 6, scope: "intro", introSec: 3 },
      { id: "layer-3", enabled: true, text: "PRESENTED BY VIDSTR", fontId: "inter", weight: 600, sizePx: 40, letterSpacing: 10, arcDeg: 0, shadow: true, color: "#e0e0e0", posX: 0, posY: 22, scope: "intro", introSec: 3 },
    ],
  },
  {
    id: "minimal-modern",
    name: "⚪ Minimalist Modern",
    isBuiltIn: true,
    layers: [
      { id: "layer-1", enabled: true, text: "URBAN EXPLORER", fontId: "inter", weight: 800, sizePx: 130, letterSpacing: 12, arcDeg: 0, shadow: false, color: "#ffffff", posX: 0, posY: -10, scope: "intro", introSec: 3 },
      { id: "layer-2", enabled: true, text: "VOLUME 01", fontId: "space-grotesk", weight: 400, sizePx: 55, letterSpacing: 4, arcDeg: 0, shadow: false, color: "#a0a0a0", posX: 0, posY: 10, scope: "intro", introSec: 3 },
      { id: "layer-3", enabled: false, text: "", fontId: "inter", weight: 400, sizePx: 36, letterSpacing: 8, arcDeg: 0, shadow: false, color: "#808080", posX: 0, posY: 24, scope: "intro", introSec: 3 },
    ],
  },
  {
    id: "bold-neon",
    name: "⚡ Bold Neon Punch",
    isBuiltIn: true,
    layers: [
      { id: "layer-1", enabled: true, text: "NEON NIGHTS", fontId: "bebas", weight: 400, sizePx: 160, letterSpacing: 4, arcDeg: 0, shadow: true, color: "#00ffcc", posX: 0, posY: -12, scope: "intro", introSec: 3 },
      { id: "layer-2", enabled: true, text: "LIVE IN TOKYO", fontId: "montserrat", weight: 800, sizePx: 65, letterSpacing: 2, arcDeg: 0, shadow: true, color: "#ff007f", posX: 0, posY: 8, scope: "intro", introSec: 3 },
      { id: "layer-3", enabled: false, text: "", fontId: "outfit", weight: 700, sizePx: 42, letterSpacing: 6, arcDeg: 0, shadow: true, color: "#ffffff", posX: 0, posY: 24, scope: "intro", introSec: 3 },
    ],
  },
  {
    id: "subtle-lower",
    name: "🏷️ Lower Third Tag",
    isBuiltIn: true,
    layers: [
      { id: "layer-1", enabled: true, text: "ALEX RIVERS", fontId: "montserrat", weight: 800, sizePx: 90, letterSpacing: 2, arcDeg: 0, shadow: true, color: "#ffffff", posX: -22, posY: 26, scope: "intro", introSec: 3 },
      { id: "layer-2", enabled: true, text: "Creative Director", fontId: "inter", weight: 500, sizePx: 48, letterSpacing: 1, arcDeg: 0, shadow: true, color: "#ffb339", posX: -22, posY: 36, scope: "intro", introSec: 3 },
      { id: "layer-3", enabled: false, text: "", fontId: "inter", weight: 400, sizePx: 36, letterSpacing: 3, arcDeg: 0, shadow: true, color: "#cccccc", posX: -22, posY: 44, scope: "intro", introSec: 3 },
    ],
  },
];

function getStorageKey(projectKey?: string): string {
  const cleanKey = (projectKey || "current_project").trim().toLowerCase().replace(/[^\w\-]+/g, "_");
  return `vidstr_title_presets_${cleanKey}`;
}

export function loadSavedPresets(projectKey?: string): TitlePreset[] {
  try {
    if (typeof window === "undefined") return [];
    const storage = window.sessionStorage || window.localStorage;
    const raw = storage.getItem(getStorageKey(projectKey));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {}
  return [];
}

export function savePreset(name: string, titleLayers: TitleLayerSettings[], projectKey?: string): TitlePreset {
  const custom = loadSavedPresets(projectKey);
  const newPreset: TitlePreset = {
    id: `preset-${Date.now()}`,
    name,
    layers: titleLayers.map((l) => ({
      id: l.id,
      enabled: l.enabled,
      text: l.text,
      fontId: l.fontId,
      weight: l.weight,
      sizePx: l.sizePx,
      letterSpacing: l.letterSpacing ?? 0,
      arcDeg: l.arcDeg ?? 0,
      shadow: l.shadow !== false,
      color: l.color,
      posX: l.posX,
      posY: l.posY,
      scope: l.scope,
      introSec: l.introSec,
    })),
  };
  const updated = [newPreset, ...custom];
  try {
    if (typeof window !== "undefined") {
      const storage = window.sessionStorage || window.localStorage;
      storage.setItem(getStorageKey(projectKey), JSON.stringify(updated));
    }
  } catch {}
  return newPreset;
}

export function exportPresetsToJson(presets: TitlePreset[]): string {
  return JSON.stringify(presets, null, 2);
}

export function parsePresetsJson(jsonText: string): TitlePreset[] {
  const parsed = JSON.parse(jsonText);
  if (Array.isArray(parsed)) {
    return parsed.filter((p) => p && typeof p.name === "string" && Array.isArray(p.layers));
  }
  if (parsed && typeof parsed === "object" && typeof (parsed as Record<string, unknown>).name === "string" && Array.isArray((parsed as Record<string, unknown>).layers)) {
    return [parsed as TitlePreset];
  }
  return [];
}
