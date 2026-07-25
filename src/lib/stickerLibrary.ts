// Client for the Sticker asset library. Images live in the project's stickers/
// directory, served by the dev proxy at /api/stickers (list / file / upload — see
// vite.config.ts). Stickers reference an asset by filename; bytes are fetched on
// demand. Mirrors sfxLibrary.ts, which does the same for the audio/ folder.

export async function fetchStickerList(): Promise<string[]> {
  try {
    const res = await fetch("/api/stickers/list");
    if (!res.ok) return [];
    const data = (await res.json()) as { files?: string[] };
    return data.files ?? [];
  } catch {
    return [];
  }
}

/** Streamable URL for a sticker asset (used by the picker's thumbnails and the renderer). */
export function stickerFileUrl(fileName: string): string {
  return `/api/stickers/file?name=${encodeURIComponent(fileName)}`;
}

export async function fetchStickerBytes(fileName: string): Promise<ArrayBuffer> {
  const res = await fetch(stickerFileUrl(fileName));
  if (!res.ok) throw new Error(`Sticker file not found: ${fileName}`);
  return res.arrayBuffer();
}

/** Upload an image into the stickers/ directory; returns the stored filename. */
export async function uploadSticker(file: File): Promise<string> {
  const res = await fetch(`/api/stickers/upload?name=${encodeURIComponent(file.name)}`, {
    method: "POST",
    headers: { "content-type": file.type || "application/octet-stream" },
    body: file,
  });
  const data = (await res.json().catch(() => ({}))) as { name?: string; error?: string };
  if (!res.ok || data.error) throw new Error(data.error ?? `Upload failed (${res.status})`);
  return data.name ?? file.name;
}

// ── Favourites ───────────────────────────────────────────────────────────────
// Filenames in localStorage, mirroring how voPresets.ts stores its starred
// default. GLOBAL rather than per-Project: a sticker the author reaches for often
// is a property of the author, not of one edit.

const FAVORITES_KEY = "vidstr_sticker_favorites";

export function loadFavorites(): string[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((n): n is string => typeof n === "string");
  } catch { /* corrupt storage degrades to no favourites */ }
  return [];
}

function persistFavorites(names: string[]): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(names));
  } catch { /* quota or private mode — favourites are a convenience, not state */ }
}

export function isFavorite(fileName: string, favorites = loadFavorites()): boolean {
  return favorites.includes(fileName);
}

/** Toggle a sticker's favourite flag; returns the new favourites list. */
export function toggleFavorite(fileName: string): string[] {
  const current = loadFavorites();
  const next = current.includes(fileName)
    ? current.filter((n) => n !== fileName)
    : [...current, fileName];
  persistFavorites(next);
  return next;
}

/**
 * Favourites first, each group alphabetical — the same treatment custom
 * ElevenLabs voices get over stock ones in the voice picker.
 */
export function sortByFavorite(files: string[], favorites = loadFavorites()): string[] {
  const fav = new Set(favorites);
  return [...files].sort((a, b) => {
    const fa = fav.has(a), fb = fav.has(b);
    if (fa !== fb) return fa ? -1 : 1;
    return a.localeCompare(b);
  });
}
