import type { ProjectState } from "../state/projectReducer";

// Per-beat title layers may carry an uploaded custom-font File (fontId "custom").
// A File can't survive JSON.stringify (it becomes `{}`), so — exactly like clip
// media — the font bytes are stored out-of-band (IndexedDB structured clone, or a
// data URL in a .vidstr package) while the JSON state keeps fontFile = null. These
// helpers extract, strip, and reinject those fonts, keyed stably per beat+layer.

/** Stable key for a beat's title-layer font: `<beatId>:<layerId>`. */
export function titleFontKey(beatId: string, layerId: string): string {
  return `${beatId}:${layerId}`;
}

/** Every uploaded title-font File in the project's per-beat titles. */
export function collectTitleFonts(state: ProjectState): { key: string; file: File }[] {
  const out: { key: string; file: File }[] = [];
  for (const beat of state.cut?.beats ?? []) {
    for (const layer of beat.titleLayers ?? []) {
      if (layer.fontFile instanceof File) {
        out.push({ key: titleFontKey(beat.id, layer.id), file: layer.fontFile });
      }
    }
  }
  return out;
}

/** A JSON-safe clone with every per-beat title `fontFile` nulled out. */
export function stripTitleFonts(state: ProjectState): ProjectState {
  const hasFont = state.cut?.beats?.some((b) => b.titleLayers?.some((l) => l.fontFile));
  if (!state.cut || !hasFont) return state;
  return {
    ...state,
    cut: {
      ...state.cut,
      beats: state.cut.beats.map((b) =>
        b.titleLayers
          ? { ...b, titleLayers: b.titleLayers.map((l) => (l.fontFile ? { ...l, fontFile: null } : l)) }
          : b,
      ),
    },
  };
}

/** Reinject stored font blobs back into per-beat title layers, keyed by beat+layer. */
export function reinjectTitleFonts(state: ProjectState, fonts: Map<string, Blob>): ProjectState {
  if (!state.cut?.beats?.length || fonts.size === 0) return state;
  return {
    ...state,
    cut: {
      ...state.cut,
      beats: state.cut.beats.map((b) => {
        if (!b.titleLayers?.length) return b;
        return {
          ...b,
          titleLayers: b.titleLayers.map((l) => {
            const blob = fonts.get(titleFontKey(b.id, l.id));
            if (!blob) return l;
            const file = blob instanceof File ? blob : new File([blob], `${l.fontId || "title"}-font`, { type: blob.type });
            return { ...l, fontFile: file };
          }),
        };
      }),
    },
  };
}

/** Beat+layer keys for every per-beat title layer (for bulk font lookups). */
export function titleFontKeys(state: ProjectState): string[] {
  const keys: string[] = [];
  for (const beat of state.cut?.beats ?? []) {
    for (const layer of beat.titleLayers ?? []) keys.push(titleFontKey(beat.id, layer.id));
  }
  return keys;
}
