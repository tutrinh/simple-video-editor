// Client for the app-wide font library. Uploaded faces live in public/fonts/
// and projects reference them by filename instead of owning a copy of the bytes.

export const APP_FONT_PREFIX = "app-font:";

export function appFontId(fileName: string): string {
  return `${APP_FONT_PREFIX}${fileName}`;
}

export function appFontFileName(fontId: string): string | null {
  return fontId.startsWith(APP_FONT_PREFIX) ? fontId.slice(APP_FONT_PREFIX.length) || null : null;
}

export function appFontCssFamily(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, "").replace(/[^a-z0-9_-]+/gi, "_");
  return `Vidstr_${stem || "CustomFont"}`;
}

export function fontFileUrl(fileName: string): string {
  return `/api/fonts/file?name=${encodeURIComponent(fileName)}`;
}

export async function fetchFontList(): Promise<string[]> {
  try {
    const res = await fetch("/api/fonts/list");
    if (!res.ok) return [];
    const data = (await res.json()) as { files?: string[] };
    return data.files ?? [];
  } catch {
    return [];
  }
}

export async function uploadFont(file: File): Promise<string> {
  const res = await fetch(`/api/fonts/upload?name=${encodeURIComponent(file.name)}`, {
    method: "POST",
    headers: { "content-type": file.type || "application/octet-stream" },
    body: file,
  });
  const data = (await res.json().catch(() => ({}))) as { name?: string; error?: string };
  if (!res.ok || data.error) throw new Error(data.error ?? `Upload failed (${res.status})`);
  return data.name ?? file.name;
}

export async function fetchAppFontBytes(fileName: string): Promise<Uint8Array> {
  const res = await fetch(fontFileUrl(fileName));
  if (!res.ok) throw new Error(`Font file not found: ${fileName}`);
  return new Uint8Array(await res.arrayBuffer());
}

const loadedFaces = new Set<string>();

/** Register one shared font for DOM/canvas previews. Safe to call repeatedly. */
export function ensureAppFontLoaded(fileName: string): void {
  if (typeof document === "undefined" || loadedFaces.has(fileName)) return;
  loadedFaces.add(fileName);
  const family = appFontCssFamily(fileName);
  const face = new FontFace(family, `url(${JSON.stringify(fontFileUrl(fileName))})`);
  void face.load().then((loaded) => document.fonts.add(loaded)).catch(() => loadedFaces.delete(fileName));
}
