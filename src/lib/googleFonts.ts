export interface GoogleFontOption {
  id: string;
  name: string;
  category: "sans-serif" | "serif" | "display" | "handwriting" | "monospace";
  googleFontName: string;
  cssFamily: string;
  weight?: string;
}

export const GOOGLE_TITLE_FONTS: GoogleFontOption[] = [
  { id: "outfit", name: "Outfit (Google Font)", category: "sans-serif", googleFontName: "Outfit", cssFamily: "'Outfit', sans-serif", weight: "400;600;700;800" },
  { id: "inter", name: "Inter (Google Font)", category: "sans-serif", googleFontName: "Inter", cssFamily: "'Inter', sans-serif", weight: "400;600;700;800" },
  { id: "roboto", name: "Roboto (Google Font)", category: "sans-serif", googleFontName: "Roboto", cssFamily: "'Roboto', sans-serif", weight: "400;700;900" },
  { id: "montserrat", name: "Montserrat (Google Font)", category: "sans-serif", googleFontName: "Montserrat", cssFamily: "'Montserrat', sans-serif", weight: "400;600;700;900" },
  { id: "oswald", name: "Oswald (Google Font)", category: "sans-serif", googleFontName: "Oswald", cssFamily: "'Oswald', sans-serif", weight: "400;600;700" },
  { id: "playfair", name: "Playfair Display (Google Font)", category: "serif", googleFontName: "Playfair+Display", cssFamily: "'Playfair Display', serif", weight: "400;600;700;900" },
  { id: "bebas", name: "Bebas Neue (Google Font)", category: "display", googleFontName: "Bebas+Neue", cssFamily: "'Bebas Neue', display", weight: "400" },
  { id: "space-grotesk", name: "Space Grotesk (Google Font)", category: "sans-serif", googleFontName: "Space+Grotesk", cssFamily: "'Space Grotesk', sans-serif", weight: "400;600;700" },
  { id: "poppins", name: "Poppins (Google Font)", category: "sans-serif", googleFontName: "Poppins", cssFamily: "'Poppins', sans-serif", weight: "400;600;700;800" },
  { id: "pacifico", name: "Pacifico (Google Font)", category: "handwriting", googleFontName: "Pacifico", cssFamily: "'Pacifico', cursive", weight: "400" },
  { id: "cinzel", name: "Cinzel (Google Font)", category: "serif", googleFontName: "Cinzel", cssFamily: "'Cinzel', serif", weight: "400;600;700;900" },
];

export const SYSTEM_TITLE_FONTS = [
  { id: "sans", name: "System Sans-serif", cssFamily: "system-ui, sans-serif" },
  { id: "serif", name: "System Serif", cssFamily: "Georgia, 'Times New Roman', serif" },
];

const loadedLinks = new Set<string>();

/** Inject Google Font stylesheet into document head if not already loaded. */
export function ensureGoogleFontLoaded(font: GoogleFontOption) {
  if (typeof document === "undefined") return;
  const href = `https://fonts.googleapis.com/css2?family=${font.googleFontName}:wght@${font.weight ?? "400;700"}&display=swap`;
  if (loadedLinks.has(href)) return;

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
  loadedLinks.add(href);
}

/** Find a font option by ID (Google Font or System Font). */
export function findFontById(id: string): (GoogleFontOption & { isGoogle?: boolean }) | { id: string; name: string; cssFamily: string; isGoogle?: boolean } | undefined {
  const gf = GOOGLE_TITLE_FONTS.find((f) => f.id === id);
  if (gf) return { ...gf, isGoogle: true };
  const sf = SYSTEM_TITLE_FONTS.find((f) => f.id === id);
  if (sf) return { ...sf, isGoogle: false };
  return undefined;
}

/** Fetch TTF binary bytes for FFmpeg drawtext encoding. */
export async function fetchGoogleFontBytes(font: GoogleFontOption, weight = 400): Promise<Uint8Array> {
  try {
    const cssUrl = `https://fonts.googleapis.com/css2?family=${font.googleFontName}:wght@${weight}&display=swap`;
    const cssRes = await fetch(cssUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    if (!cssRes.ok) throw new Error(`Google Font CSS error ${cssRes.status}`);
    const cssText = await cssRes.text();
    const match = cssText.match(/url\((https:\/\/[^)]+\.(?:ttf|woff2|otf))\)/) || cssText.match(/url\((https:\/\/[^)]+)\)/);
    if (!match) throw new Error("Font binary URL not found in CSS");

    const fontRes = await fetch(match[1]);
    if (!fontRes.ok) throw new Error(`Font download error ${fontRes.status}`);
    return new Uint8Array(await fontRes.arrayBuffer());
  } catch (err) {
    console.warn("[googleFonts] Falling back to default title-sans.ttf due to:", err);
    const fallbackRes = await fetch("/fonts/title-sans.ttf");
    return new Uint8Array(await fallbackRes.arrayBuffer());
  }
}
