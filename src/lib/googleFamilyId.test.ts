import { describe, it, expect } from "vitest";
import {
  googleFamilyId, parseGoogleFamilyId, slugifyFamily, syntheticGoogleFont,
  GOOGLE_FAMILY_PREFIX, GOOGLE_TITLE_FONTS, findFontById, looksLikeFontBytes,
  parseGoogleFontUrl,
} from "./googleFonts";

// A family typed by name rides inside `fontId` as `google:Anton` (ADR-0014).
// These are the pure parts of that encoding.

describe("googleFamilyId / parseGoogleFamilyId", () => {
  it("round-trips a family", () => {
    for (const family of ["Anton", "Playfair Display", "Noto Sans JP", "IBM Plex Mono"]) {
      expect(parseGoogleFamilyId(googleFamilyId(family))).toBe(family);
    }
  });

  it("trims on the way in and out", () => {
    expect(googleFamilyId("  Anton  ")).toBe("google:Anton");
    expect(parseGoogleFamilyId("google:  Anton  ")).toBe("Anton");
  });

  it("rejects ids that are not a google family", () => {
    for (const id of ["outfit", "custom", "sans", "sf-mono", "", "googleAnton", "Google:Anton"]) {
      expect(parseGoogleFamilyId(id), id).toBeNull();
    }
  });

  it("rejects the bare prefix with no family", () => {
    expect(parseGoogleFamilyId(GOOGLE_FAMILY_PREFIX)).toBeNull();
    expect(parseGoogleFamilyId("google:   ")).toBeNull();
  });

  it("does not throw on non-string input", () => {
    expect(parseGoogleFamilyId(undefined as unknown as string)).toBeNull();
    expect(parseGoogleFamilyId(null as unknown as string)).toBeNull();
  });

  it("survives a family containing the delimiter", () => {
    // slice() past the first prefix, so the rest is kept verbatim.
    expect(parseGoogleFamilyId(googleFamilyId("Odd:Name"))).toBe("Odd:Name");
  });

  it("never collides with a built-in font id", () => {
    for (const f of GOOGLE_TITLE_FONTS) {
      expect(parseGoogleFamilyId(f.id), f.id).toBeNull();
    }
  });
});

describe("parseGoogleFontUrl", () => {
  it("reads a Google Fonts specimen URL", () => {
    expect(parseGoogleFontUrl(
      "https://fonts.google.com/specimen/Darumadrop+One",
    )).toBe("Darumadrop One");
  });

  it("reads an encoded specimen URL with preview parameters", () => {
    expect(parseGoogleFontUrl(
      "https://fonts.google.com/specimen/Playfair%2BDisplay?preview.text=Hello",
    )).toBe("Playfair Display");
  });

  it("reads a Google Fonts CSS URL", () => {
    expect(parseGoogleFontUrl(
      "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;700&display=swap",
    )).toBe("Space Grotesk");
  });

  it("rejects unrelated and malformed URLs", () => {
    expect(parseGoogleFontUrl("https://example.com/specimen/Roboto")).toBeNull();
    expect(parseGoogleFontUrl("not a url")).toBeNull();
    expect(parseGoogleFontUrl("https://fonts.google.com/")).toBeNull();
  });
});

describe("slugifyFamily", () => {
  it("matches the Fontsource slug convention", () => {
    expect(slugifyFamily("Anton")).toBe("anton");
    expect(slugifyFamily("Playfair Display")).toBe("playfair-display");
    expect(slugifyFamily("Space Grotesk")).toBe("space-grotesk");
    expect(slugifyFamily("Bebas Neue")).toBe("bebas-neue");
  });

  it("agrees with every slug the built-in list already declares", () => {
    // The built-ins were slugged by hand; this is the regression guard that the
    // derived slug would have produced the same thing.
    for (const f of GOOGLE_TITLE_FONTS) {
      if (!f.fontsourceSlug) continue;
      const bare = f.name.replace(/\s*\(Google Font\)$/i, "");
      expect(slugifyFamily(bare), f.name).toBe(f.fontsourceSlug);
    }
  });

  it("collapses whitespace and case", () => {
    expect(slugifyFamily("  NOTO   sans   JP ")).toBe("noto-sans-jp");
    expect(slugifyFamily("Roboto\tSlab")).toBe("roboto-slab");
  });

  it("drops punctuation rather than encoding it", () => {
    expect(slugifyFamily("M PLUS 1p")).toBe("m-plus-1p");
    expect(slugifyFamily("Libre Baskerville!")).toBe("libre-baskerville");
    expect(slugifyFamily("--Anton--")).toBe("anton");
  });

  it("keeps digits", () => {
    expect(slugifyFamily("Press Start 2P")).toBe("press-start-2p");
  });
});

describe("syntheticGoogleFont", () => {
  it("quotes the family so a multi-word name is one CSS family", () => {
    expect(syntheticGoogleFont("Playfair Display").cssFamily).toBe("'Playfair Display', sans-serif");
  });

  it("+-encodes the name for the Google CSS API", () => {
    expect(syntheticGoogleFont("Noto Sans JP").googleFontName).toBe("Noto+Sans+JP");
    expect(syntheticGoogleFont("Anton").googleFontName).toBe("Anton");
  });

  it("carries the slug slugifyFamily would produce", () => {
    for (const family of ["Anton", "Playfair Display", "M PLUS 1p"]) {
      expect(syntheticGoogleFont(family).fontsourceSlug).toBe(slugifyFamily(family));
    }
  });

  it("its id parses back to the family", () => {
    const f = syntheticGoogleFont("  Space Grotesk  ");
    expect(f.name).toBe("Space Grotesk");
    expect(parseGoogleFamilyId(f.id)).toBe("Space Grotesk");
  });

  it("requests a weight range wide enough for the weight ladder", () => {
    // The picker offers 300–800; the stylesheet has to ask for them.
    const w = syntheticGoogleFont("Anton").weight ?? "";
    for (const weight of [300, 400, 600, 700, 800]) {
      expect(w.split(";"), String(weight)).toContain(String(weight));
    }
  });
});

describe("findFontById — the CSS-family seam", () => {
  it("resolves a typed family to its quoted CSS family", () => {
    const f = findFontById(googleFamilyId("Anton"));
    expect(f?.cssFamily).toBe("'Anton', sans-serif");
    expect(f?.name).toBe("Anton");
  });

  it("still resolves the built-in Google fonts", () => {
    const f = findFontById("outfit");
    expect(f?.cssFamily).toBe("'Outfit', sans-serif");
  });

  it("still resolves the system fonts", () => {
    expect(findFontById("sans")?.cssFamily).toBe("system-ui, sans-serif");
    expect(findFontById("serif")?.cssFamily).toContain("Georgia");
  });

  it("prefers a built-in over the synthetic path", () => {
    // A built-in id can never look like a family id, but assert the order
    // anyway — the built-in carries a hand-tuned weight list.
    const f = findFontById("playfair");
    expect(f && "fontsourceSlug" in f ? f.fontsourceSlug : null).toBe("playfair-display");
  });

  it("returns undefined for an id that is neither", () => {
    expect(findFontById("custom")).toBeUndefined();
    expect(findFontById("nonsense")).toBeUndefined();
    expect(findFontById("")).toBeUndefined();
  });
});

describe("looksLikeFontBytes", () => {
  const body = (n: number, head: number[] = []) => {
    const u = new Uint8Array(n);
    head.forEach((b, i) => { u[i] = b; });
    return u;
  };
  const TTF = [0x00, 0x01, 0x00, 0x00]; // sfnt version 1.0
  const OTF = [0x4f, 0x54, 0x54, 0x4f]; // 'OTTO'

  it("accepts a real TTF or OTF body", () => {
    expect(looksLikeFontBytes(true, "font/ttf", body(20000, TTF))).toBe(true);
    expect(looksLikeFontBytes(true, "application/octet-stream", body(20000, OTF))).toBe(true);
  });

  it("rejects a non-ok response", () => {
    expect(looksLikeFontBytes(false, "font/ttf", body(20000, TTF))).toBe(false);
  });

  it("rejects an HTML error page served as 200", () => {
    expect(looksLikeFontBytes(true, "text/html; charset=utf-8", body(20000, TTF))).toBe(false);
    // ...and one whose content-type lies, caught by the leading '<'.
    expect(looksLikeFontBytes(true, "font/ttf", body(20000, [0x3c, 0x21, 0x44]))).toBe(false);
  });

  it("rejects WOFF and WOFF2 — ffmpeg cannot read compressed outlines", () => {
    expect(looksLikeFontBytes(true, "font/woff", body(20000, [0x77, 0x4f, 0x46, 0x46]))).toBe(false);
    expect(looksLikeFontBytes(true, "font/woff2", body(20000, [0x77, 0x4f, 0x46, 0x32]))).toBe(false);
  });

  it("rejects a body too short to be a font", () => {
    expect(looksLikeFontBytes(true, "font/ttf", body(1000, TTF))).toBe(false);
    expect(looksLikeFontBytes(true, "font/ttf", body(0))).toBe(false);
  });
});
