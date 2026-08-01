import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CAPTION_FONT_WEIGHT,
  DEFAULT_CAPTION_FONT_ID,
  resolveCaptionFontFamily,
} from "./captionFont";

vi.mock("../../lib/googleFonts", () => ({
  findFontById: vi.fn(),
  fetchGoogleFontBytes: vi.fn(),
}));

vi.mock("./titleCanvas", () => ({
  titleFontKey: (cssFamily: string, weight: number) => `${cssFamily}-${weight}`,
  ensureTitleFontFace: vi.fn(),
}));

const { findFontById, fetchGoogleFontBytes } = await import("../../lib/googleFonts");
const { ensureTitleFontFace } = await import("./titleCanvas");

afterEach(() => {
  vi.mocked(findFontById).mockReset();
  vi.mocked(fetchGoogleFontBytes).mockReset();
  vi.mocked(ensureTitleFontFace).mockReset();
});

describe("resolveCaptionFontFamily", () => {
  it("returns null for the default id, meaning the bundled caption face", async () => {
    expect(await resolveCaptionFontFamily(DEFAULT_CAPTION_FONT_ID)).toBeNull();
    expect(await resolveCaptionFontFamily(undefined)).toBeNull();
    expect(await resolveCaptionFontFamily("   ")).toBeNull();
    expect(findFontById).not.toHaveBeenCalled();
  });

  it("falls back to the bundled face when the id is unknown", async () => {
    vi.mocked(findFontById).mockReturnValue(undefined);
    // A font dropped from the list must not blank the caption.
    expect(await resolveCaptionFontFamily("gone")).toBeNull();
  });

  it("uses a system face directly, with nothing to fetch", async () => {
    vi.mocked(findFontById).mockReturnValue({
      id: "georgia", name: "Georgia", cssFamily: "Georgia, serif", isGoogle: false,
    });

    expect(await resolveCaptionFontFamily("georgia")).toBe("Georgia, serif");
    expect(fetchGoogleFontBytes).not.toHaveBeenCalled();
    expect(ensureTitleFontFace).not.toHaveBeenCalled();
  });

  it("registers a Google face from its bytes, at the caption weight", async () => {
    vi.mocked(findFontById).mockReturnValue({
      id: "montserrat", name: "Montserrat", cssFamily: "Montserrat", isGoogle: true,
      category: "sans-serif", googleFontName: "Montserrat",
    });
    vi.mocked(fetchGoogleFontBytes).mockResolvedValue(new Uint8Array([1, 2, 3]));
    vi.mocked(ensureTitleFontFace).mockResolvedValue("'title-Montserrat-700'");

    expect(await resolveCaptionFontFamily("montserrat")).toBe("'title-Montserrat-700'");
    expect(fetchGoogleFontBytes).toHaveBeenCalledWith(expect.anything(), CAPTION_FONT_WEIGHT);
    expect(ensureTitleFontFace).toHaveBeenCalledWith(
      "Montserrat-700",
      new Uint8Array([1, 2, 3]),
      "Montserrat",
    );
  });

  it("falls back to the CSS family when the bytes cannot be fetched", async () => {
    vi.mocked(findFontById).mockReturnValue({
      id: "montserrat", name: "Montserrat", cssFamily: "Montserrat", isGoogle: true,
      category: "sans-serif", googleFontName: "Montserrat",
    });
    vi.mocked(fetchGoogleFontBytes).mockRejectedValue(new Error("offline"));

    // The stylesheet may have loaded the family even when the byte fetch did not.
    expect(await resolveCaptionFontFamily("montserrat")).toBe("Montserrat");
  });

  it("falls back to sans-serif when a font carries no css family", async () => {
    vi.mocked(findFontById).mockReturnValue({
      id: "odd", name: "Odd", cssFamily: "", isGoogle: false,
    });
    expect(await resolveCaptionFontFamily("odd")).toBe("sans-serif");
  });
});
