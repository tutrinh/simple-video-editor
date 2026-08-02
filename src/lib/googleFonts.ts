import { appFontCssFamily, appFontFileName, ensureAppFontLoaded } from "./fontLibrary";

export interface GoogleFontOption {
  id: string;
  name: string;
  category: "sans-serif" | "serif" | "display" | "handwriting" | "monospace";
  googleFontName: string;
  fontsourceSlug?: string;
  /** Known downloadable Fontsource weights; independent of browser-synthesized preview weights. */
  fontsourceWeights?: string;
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
  { id: "darumadrop-one", name: "Darumadrop One (Google Font)", category: "display", googleFontName: "Darumadrop+One", fontsourceSlug: "darumadrop-one", cssFamily: "'Darumadrop One', display", weight: "400" },
  { id: "space-grotesk", name: "Space Grotesk (Google Font)", category: "sans-serif", googleFontName: "Space+Grotesk", fontsourceSlug: "space-grotesk", cssFamily: "'Space Grotesk', sans-serif", weight: "400;600;700" },
  { id: "poppins", name: "Poppins (Google Font)", category: "sans-serif", googleFontName: "Poppins", fontsourceSlug: "poppins", cssFamily: "'Poppins', sans-serif", weight: "400;600;700;800" },
  { id: "pacifico", name: "Pacifico (Google Font)", category: "handwriting", googleFontName: "Pacifico", fontsourceSlug: "pacifico", cssFamily: "'Pacifico', cursive", weight: "400" },
  { id: "cinzel", name: "Cinzel (Google Font)", category: "serif", googleFontName: "Cinzel", fontsourceSlug: "cinzel", cssFamily: "'Cinzel', serif", weight: "400;600;700;900" },
];

export const SYSTEM_TITLE_FONTS = [
  { id: "sans", name: "System Sans-serif", cssFamily: "system-ui, sans-serif" },
  { id: "serif", name: "System Serif", cssFamily: "Georgia, 'Times New Roman', serif" },
  { id: "sf-mono", name: "SF Mono", cssFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace" },
];

// --- Arbitrary Google families (ADR-0014) -----------------------------------
// A family typed by name rides inside the existing `fontId` as `google:Anton`
// rather than in a new field: fontId is already an opaque string that
// round-trips through .vidstr packages, title presets, the style clipboard and
// every per-beat layer, so encoding it there needs no schema change and no
// migration.

export const GOOGLE_FAMILY_PREFIX = "google:";

/** Extract a family from a Google Fonts specimen or CSS URL. */
export function parseGoogleFontUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase();

    if (host === "fonts.google.com") {
      const match = url.pathname.match(/^\/specimen\/([^/]+)/i);
      if (!match) return null;
      const family = decodeURIComponent(match[1]).replace(/\+/g, " ").trim();
      return family || null;
    }

    if (host === "fonts.googleapis.com") {
      const rawFamily = url.searchParams.get("family");
      if (!rawFamily) return null;
      const firstFamily = rawFamily.split("|")[0].split(":")[0].trim();
      return firstFamily || null;
    }
  } catch {
    return null;
  }

  return null;
}

/** `"Anton"` → `"google:Anton"`. */
export function googleFamilyId(family: string): string {
  return `${GOOGLE_FAMILY_PREFIX}${family.trim()}`;
}

/** `"google:Anton"` → `"Anton"`; anything else → null. */
export function parseGoogleFamilyId(id: string): string | null {
  if (typeof id !== "string" || !id.startsWith(GOOGLE_FAMILY_PREFIX)) return null;
  const family = id.slice(GOOGLE_FAMILY_PREFIX.length).trim();
  return family ? family : null;
}

/**
 * The Fontsource CDN slug: lowercased, whitespace collapsed to single hyphens,
 * punctuation dropped. "Playfair Display" → "playfair-display", matching the
 * `fontsourceSlug` values the built-in list already carries.
 */
export function slugifyFamily(family: string): string {
  return family
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * A `GoogleFontOption` for a family that is not in the built-in list, so the
 * existing loader and byte-fetcher work on it unchanged.
 */
export function syntheticGoogleFont(family: string): GoogleFontOption {
  const name = family.trim();
  return {
    id: googleFamilyId(name),
    name,
    category: "sans-serif",
    // The Google CSS API takes `+` for spaces.
    googleFontName: name.replace(/\s+/g, "+"),
    fontsourceSlug: slugifyFamily(name),
    cssFamily: `'${name}', sans-serif`,
    // The browser may synthesize the editor's weight ladder, but a typed family
    // has not supplied downloadable axis metadata. Regular is the safe TTF.
    weight: "300;400;600;700;800",
    fontsourceWeights: "400",
  };
}

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

/**
 * Does a fetched body look like real, uncompressed font outlines? Split out from
 * the fetch so it can be tested without the network, and shared with
 * fetchGoogleFontBytes's tier-2 checks: HTML means a 404 page dressed as a 200,
 * `wOF` magic means a compressed web font that ffmpeg cannot read, and a tiny
 * body means neither.
 */
export function looksLikeFontBytes(ok: boolean, contentType: string, bytes: Uint8Array): boolean {
  if (!ok) return false;
  if (contentType.includes("text/html")) return false;
  if (bytes.length <= 1000) return false;
  if (bytes[0] === 0x77 && bytes[1] === 0x4f && bytes[2] === 0x46) return false; // 'wOF'
  if (bytes[0] === 0x3c) return false; // '<' — an HTML body with the wrong content-type
  return true;
}

/**
 * Whether a family name actually resolves to a font.
 *
 * Needed because fetchGoogleFontBytes ends in a guaranteed title-sans.ttf
 * fallback, so a misspelled family cannot be detected from its result — it
 * silently renders in the wrong face. The picker probes first and reports.
 */
export async function probeGoogleFamily(family: string): Promise<boolean> {
  const slug = slugifyFamily(family);
  if (!slug) return false;
  try {
    const res = await fetch(`https://cdn.jsdelivr.net/fontsource/fonts/${slug}@latest/latin-400-normal.ttf`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    return looksLikeFontBytes(res.ok, res.headers.get("content-type") || "", bytes);
  } catch {
    return false;
  }
}

/**
 * Load whatever stylesheet a font id needs, listed or typed by name. The
 * callers used to look the id up in GOOGLE_TITLE_FONTS themselves, which meant
 * a `google:` family got no stylesheet and previewed in the fallback face.
 */
export function ensureFontLoadedById(fontId: string): void {
  const appFile = appFontFileName(fontId);
  if (appFile) { ensureAppFontLoaded(appFile); return; }
  const gf = GOOGLE_TITLE_FONTS.find((f) => f.id === fontId);
  if (gf) { ensureGoogleFontLoaded(gf); return; }
  const family = parseGoogleFamilyId(fontId);
  if (family) ensureGoogleFontLoaded(syntheticGoogleFont(family));
}

/** Find a font option by ID (Google Font or System Font). */
export function findFontById(id: string): (GoogleFontOption & { isGoogle?: boolean }) | { id: string; name: string; cssFamily: string; isGoogle?: boolean } | undefined {
  const appFile = appFontFileName(id);
  if (appFile) return { id, name: appFile.replace(/\.[^.]+$/, ""), cssFamily: appFontCssFamily(appFile), isGoogle: false };
  const gf = GOOGLE_TITLE_FONTS.find((f) => f.id === id);
  if (gf) return { ...gf, isGoogle: true };
  // A family typed by name (ADR-0014) — synthesised rather than listed.
  const family = parseGoogleFamilyId(id);
  if (family) return { ...syntheticGoogleFont(family), isGoogle: true };
  const sf = SYSTEM_TITLE_FONTS.find((f) => f.id === id);
  if (sf) return { ...sf, isGoogle: false };
  return undefined;
}

/** Fetch TTF binary bytes for FFmpeg drawtext encoding. */
export async function fetchGoogleFontBytes(font: GoogleFontOption, weight = 400): Promise<Uint8Array> {
  const declaredWeights = (font.fontsourceWeights ?? font.weight ?? "")
    .split(";")
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0);
  const resolvedWeight = declaredWeights.length
    ? declaredWeights.reduce((closest, candidate) =>
        Math.abs(candidate - weight) < Math.abs(closest - weight) ? candidate : closest,
      declaredWeights[0])
    : weight;

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
    const weights = [...new Set([resolvedWeight, ...(declaredWeights.includes(400) ? [400] : [])])];
    const urls = weights.map(
      (candidate) => `https://cdn.jsdelivr.net/fontsource/fonts/${slug}@latest/latin-${candidate}-normal.ttf`,
    );
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
    const cssUrl = `https://fonts.googleapis.com/css2?family=${font.googleFontName}:wght@${resolvedWeight}&display=swap`;
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
