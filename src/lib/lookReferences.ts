import type { FilmLook } from "./filmLook";

// Saved film-look reference images (localStorage) so a reference + its derived Look
// can be reused across sessions without re-uploading or re-analyzing. Images are
// downscaled before storing to keep well within the localStorage quota.
export interface SavedReference {
  id: string;
  name: string;
  /** Downscaled JPEG data URL for the thumbnail + re-analysis. */
  dataUrl: string;
  /** The Look derived from this reference, if analyzed before saving. */
  look?: FilmLook;
}

const KEY = "vidstr_look_refs";
const MAX_REFS = 12;

export function loadReferences(): SavedReference[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((r) => r && typeof r.dataUrl === "string");
  } catch { /* ignore */ }
  return [];
}

function persist(refs: SavedReference[]): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(KEY, JSON.stringify(refs.slice(0, MAX_REFS)));
  } catch { /* quota exceeded or blocked */ }
}

export function saveReference(dataUrl: string, name: string, look?: FilmLook): SavedReference {
  const ref: SavedReference = { id: `ref-${Date.now()}`, name: name.trim() || "Reference", dataUrl, look };
  persist([ref, ...loadReferences()]);
  return ref;
}

export function deleteReference(id: string): void {
  persist(loadReferences().filter((r) => r.id !== id));
}

/** Downscale an image data URL to a small JPEG for thumbnail + storage. */
export function downscaleDataUrl(dataUrl: string, maxEdge = 512): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve(dataUrl); return; }
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}
