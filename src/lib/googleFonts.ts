export interface GoogleFontOption {
  id: string;
  name: string;
  category: "sans-serif" | "serif" | "display" | "handwriting" | "monospace";
  googleFontName: string;
  fontsourceSlug?: string;
  cssFamily: string;
  weight?: string;
}

export const GOOGLE_TITLE_FONTS: GoogleFontOption[] = [
  { id: "outfit", name: "Outfit (Google Font)", category: "sans-serif", googleFontName: "Outfit", fontsourceSlug: "outfit", cssFamily: "'Outfit', sans-serif", weight: "400;600;700;800" },
  { id: "inter", name: "Inter (Google Font)", category: "sans-serif", googleFontName: "Inter", fontsourceSlug: "inter", cssFamily: "'Inter', sans-serif", weight: "400;600;700;800" },
  { id: "roboto", name: "Roboto (Google Font)", category: "sans-serif", googleFontName: "Roboto", fontsourceSlug: "roboto", cssFamily: "'Roboto', sans-serif", weight: "400;700;900" },
  { id: "montserrat", name: "Montserrat (Google Font)", category: "sans-serif", googleFontName: "Montserrat", fontsourceSlug: "montserrat", cssFamily: "'Montserrat', sans-serif", weight: "400;600;700;900" },
  { id: "oswald", name: "Oswald (Google Font)", category: "sans-serif", googleFontName: "Oswald", fontsourceSlug: "oswald", cssFamily: "'Oswald', sans-serif", weight: "400;600;700" },
  { id: "playfair", name: "Playfair Display (Google Font)", category: "serif", googleFontName: "Playfair+Display", fontsourceSlug: "playfair-display", cssFamily: "'Playfair Display', serif", weight: "400;600;700;900" },
  { id: "bebas", name: "Bebas Neue (Google Font)", category: "display", googleFontName: "Bebas+Neue", fontsourceSlug: "bebas-neue", cssFamily: "'Bebas Neue', display", weight: "400" },
  { id: "space-grotesk", name: "Space Grotesk (Google Font)", category: "sans-serif", googleFontName: "Space+Grotesk", fontsourceSlug: "space-grotesk", cssFamily: "'Space Grotesk', sans-serif", weight: "400;600;700" },
  { id: "poppins", name: "Poppins (Google Font)", category: "sans-serif", googleFontName: "Poppins", fontsourceSlug: "poppins", cssFamily: "'Poppins', sans-serif", weight: "400;600;700;800" },
  { id: "pacifico", name: "Pacifico (Google Font)", category: "handwriting", googleFontName: "Pacifico", fontsourceSlug: "pacifico", cssFamily: "'Pacifico', cursive", weight: "400" },
  { id: "cinzel", name: "Cinzel (Google Font)", category: "serif", googleFontName: "Cinzel", fontsourceSlug: "cinzel", cssFamily: "'Cinzel', serif", weight: "400;600;700;900" },
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
  // Tier 1: Try local bundled font file first (/fonts/<id>.ttf) for 0ms instant offline rendering
  try {
    const localUrl = `/fonts/${font.id}.ttf`;
    const localRes = await fetch(localUrl);
    if (localRes.ok && localRes.headers.get("content-type") !== "text/html") {
      const bytes = new Uint8Array(await localRes.arrayBuffer());
      if (bytes.length > 1000 && !(bytes[0] === 0x77 && bytes[1] === 0x4f)) {
        return bytes;
      }
    }
  } catch {}

  // Tier 2: Fetch uncompressed TTF bytes directly from Fontsource CDN via jsDelivr
  try {
    const slug = font.fontsourceSlug || font.id;
    const urls = [
      `https://cdn.jsdelivr.net/fontsource/fonts/${slug}@latest/latin-${weight}-normal.ttf`,
      `https://cdn.jsdelivr.net/fontsource/fonts/${slug}@latest/latin-400-normal.ttf`,
    ];
    for (const url of urls) {
      const fontRes = await fetch(url);
      const ct = fontRes.headers.get("content-type") || "";
      if (fontRes.ok && !ct.includes("text/html")) {
        const bytes = new Uint8Array(await fontRes.arrayBuffer());
        // Reject compressed WOFF / WOFF2 ('wOF' magic bytes)
        if (bytes.length > 1000 && !(bytes[0] === 0x77 && bytes[1] === 0x4f && bytes[2] === 0x46)) {
          return bytes;
        }
      }
    }
  } catch {}

  // Tier 3: Fetch uncompressed TTF bytes from Google Fonts API using legacy Firefox User-Agent
  try {
    const cssUrl = `https://fonts.googleapis.com/css2?family=${font.googleFontName}:wght@${weight}&display=swap`;
    const cssRes = await fetch(cssUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 6.1; WOW64; rv:27.0) Gecko/20100101 Firefox/27.0",
      },
    });
    if (cssRes.ok) {
      const cssText = await cssRes.text();
      const match = cssText.match(/url\((https:\/\/[^)]+\.(?:ttf|otf))\)/) || cssText.match(/url\((https:\/\/[^)]+)\)/);
      if (match) {
        const fontRes = await fetch(match[1]);
        if (fontRes.ok) {
          const bytes = new Uint8Array(await fontRes.arrayBuffer());
          // Reject compressed WOFF / WOFF2 ('wOF' magic bytes)
          if (bytes.length > 4 && !(bytes[0] === 0x77 && bytes[1] === 0x4f && bytes[2] === 0x46)) {
            return bytes;
          }
        }
      }
    }
  } catch {}

  // Tier 4: Guaranteed local fallback to title-sans.ttf or title-serif.ttf
  const fallbackUrls = [
    font.category === "serif" ? "/fonts/title-serif.ttf" : "/fonts/title-sans.ttf",
    "/caption-font.ttf",
  ];
  for (const url of fallbackUrls) {
    try {
      const res = await fetch(url);
      const ct = res.headers.get("content-type") || "";
      if (res.ok && !ct.includes("text/html")) {
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.length > 1000 && bytes[0] !== 0x3c) return bytes;
      }
    } catch {}
  }
  return new Uint8Array();
}

