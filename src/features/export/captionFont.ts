import { ensureFontLoadedById, fetchGoogleFontBytes, findFontById } from "../../lib/googleFonts";
import { ensureTitleFontFace, titleFontKey } from "./titleCanvas";

// Resolving a caption's font id to something `ctx.font` can use. Captions are drawn to a
// canvas on every surface — preview and export alike — so, unlike titles, nothing has to
// be handed to ffmpeg; registering the face in the browser is the whole job.
//
// The bundled /caption-font.ttf remains the default so existing projects are untouched
// until someone picks a font.

/** The id meaning "leave captions on the bundled face". */
export const DEFAULT_CAPTION_FONT_ID = "";

/**
 * Captions draw bold. Bytes are fetched at this weight so the registered face is the one
 * actually rendered rather than a synthesised bold of a regular face.
 */
export const CAPTION_FONT_WEIGHT = 700;

/**
 * The family string for `ctx.font`, or null to mean "use the bundled caption face".
 * Falls back to the CSS family when the byte fetch fails, and to null when the id is
 * unknown — a font that disappeared from the list should not blank the caption.
 */
export async function resolveCaptionFontFamily(fontId: string | undefined): Promise<string | null> {
  const id = fontId?.trim();
  if (!id || id === DEFAULT_CAPTION_FONT_ID) return null;

  const font = findFontById(id);
  if (!font) return null;

  const cssFamily = font.cssFamily || "sans-serif";

  // System faces are already installed; there is nothing to fetch or register.
  // `googleFontName` is what actually distinguishes the two shapes findFontById
  // returns — `isGoogle` is optional on both, so it cannot narrow the union.
  if (!("googleFontName" in font)) return cssFamily;

  try {
    const bytes = await fetchGoogleFontBytes(font, CAPTION_FONT_WEIGHT);
    const key = titleFontKey(cssFamily, CAPTION_FONT_WEIGHT, bytes?.length);
    return await ensureTitleFontFace(key, bytes, cssFamily);
  } catch {
    // The stylesheet may still have loaded the family even when the bytes did not.
    return cssFamily;
  }
}

/**
 * CSS family for the DOM-rendered caption in the Beat preview, which needs a stylesheet
 * rather than a registered FontFace. Returns null to leave the stylesheet's own face in
 * place, so the bundled default still applies.
 */
export function captionCssFamily(fontId: string | undefined): string | null {
  const id = fontId?.trim();
  if (!id || id === DEFAULT_CAPTION_FONT_ID) return null;
  ensureFontLoadedById(id);
  return findFontById(id)?.cssFamily || null;
}
