// Shared title-font byte loader (ADR-0008). The preview and the export both need
// the exact same TTF bytes so the shared canvas renderer draws byte-identical
// glyphs. Fetching is cached per font+weight so the preview (which redraws
// often) fetches each font at most once.

import { GOOGLE_TITLE_FONTS, fetchGoogleFontBytes } from "../../lib/googleFonts";

const cache = new Map<string, Promise<Uint8Array | undefined>>();

/** Resolve TTF bytes for a title font id + weight (or a custom uploaded file).
 *  Returns undefined when nothing usable is found — callers fall back to the CSS
 *  family. Cached; safe to call on every render. */
export function getTitleFontBytes(
  fontId: string,
  weight = 400,
  fontFile?: File | null,
): Promise<Uint8Array | undefined> {
  const key = fontId === "custom" ? `custom-${fontFile?.name}-${fontFile?.size}` : `${fontId}-${weight}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const p = (async (): Promise<Uint8Array | undefined> => {
    try {
      if (fontId === "custom") {
        return fontFile ? new Uint8Array(await fontFile.arrayBuffer()) : undefined;
      }
      const gf = GOOGLE_TITLE_FONTS.find((f) => f.id === fontId);
      if (gf) return await fetchGoogleFontBytes(gf, weight);
      // System sans/serif ship as bundled TTFs.
      const url = fontId === "serif" ? "/fonts/title-serif.ttf" : "/fonts/title-sans.ttf";
      const res = await fetch(url);
      const ct = res.headers.get("content-type") || "";
      if (res.ok && !ct.includes("text/html")) {
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.length > 1000 && bytes[0] !== 0x3c) return bytes;
      }
      return undefined;
    } catch {
      return undefined;
    }
  })();

  cache.set(key, p);
  return p;
}
