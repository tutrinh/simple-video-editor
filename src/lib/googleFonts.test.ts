import { afterEach, describe, it, expect, vi } from "vitest";
import { fetchGoogleFontBytes, GOOGLE_TITLE_FONTS, findFontById, syntheticGoogleFont } from "./googleFonts";

afterEach(() => vi.unstubAllGlobals());

describe("googleFonts module", () => {
  it("includes Outfit font as the primary Google Font option", () => {
    const outfit = GOOGLE_TITLE_FONTS.find((f) => f.id === "outfit");
    expect(outfit).toBeDefined();
    expect(outfit?.googleFontName).toBe("Outfit");
    expect(outfit?.cssFamily).toContain("Outfit");
  });

  it("finds fonts by ID correctly", () => {
    const font = findFontById("outfit");
    expect(font).toBeDefined();
    expect(font?.name).toContain("Outfit");
  });

  it("includes Darumadrop One as its regular display face", () => {
    const font = findFontById("darumadrop-one");

    expect(font).toMatchObject({
      googleFontName: "Darumadrop+One",
      fontsourceSlug: "darumadrop-one",
      cssFamily: "'Darumadrop One', display",
      weight: "400",
      isGoogle: true,
    });
  });

  it("does not request an undeclared bold file for a regular-only typed family", async () => {
    const requestedUrls: string[] = [];
    const regularBytes = new Uint8Array(2000);
    regularBytes.set([0x00, 0x01, 0x00, 0x00]);
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      requestedUrls.push(url);
      const regular = url.includes("/latin-400-normal.ttf");
      return {
        ok: regular,
        headers: { get: () => regular ? "font/ttf" : "text/plain" },
        arrayBuffer: async () => (regular ? regularBytes : new Uint8Array()).buffer,
        text: async () => "",
      };
    }));

    const bytes = await fetchGoogleFontBytes(syntheticGoogleFont("Knewave"), 700);

    expect(bytes).toHaveLength(2000);
    expect(requestedUrls.some((url) => url.includes("knewave@latest/latin-700-normal.ttf"))).toBe(false);
  });
});
