import { useSyncExternalStore } from "react";
import type { TitleLayerSettings } from "../state/ExportSettingsContext";

// A single in-memory clipboard for title-layer *styling*, shared across every
// TitleTreatmentEditor instance (cut-level titles in Export, per-beat titles in
// the Inspector). Copying grabs everything except the layer's identity/content
// (id, text, enabled), so a pasted style keeps the target layer's own text.
export type TitleLayerStyle = Omit<TitleLayerSettings, "id" | "text" | "enabled">;

let copied: TitleLayerStyle | null = null;
const listeners = new Set<() => void>();

/** Pull the copyable style off a full layer (drops id / text / enabled). */
export function extractTitleStyle(layer: TitleLayerSettings): TitleLayerStyle {
  const { id: _id, text: _text, enabled: _enabled, ...style } = layer;
  return style;
}

export function setCopiedTitleStyle(style: TitleLayerStyle) {
  copied = style;
  listeners.forEach((l) => l());
}

export function getCopiedTitleStyle(): TitleLayerStyle | null {
  return copied;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** Reactive read — components re-render when something new is copied. */
export function useCopiedTitleStyle(): TitleLayerStyle | null {
  return useSyncExternalStore(subscribe, getCopiedTitleStyle, getCopiedTitleStyle);
}
