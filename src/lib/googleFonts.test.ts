import { describe, it, expect } from "vitest";
import { GOOGLE_TITLE_FONTS, findFontById } from "./googleFonts";

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
});
