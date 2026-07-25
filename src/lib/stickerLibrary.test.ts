import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  stickerFileUrl, loadFavorites, toggleFavorite, isFavorite, sortByFavorite,
} from "./stickerLibrary";

// Minimal localStorage stand-in — the vitest env is "node" (see vite.config.ts),
// so the module's typeof guards would otherwise short-circuit every path.
function installStorage(seed: Record<string, string> = {}) {
  const store = new Map(Object.entries(seed));
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  });
  return store;
}

const KEY = "vidstr_sticker_favorites";

beforeEach(() => { vi.unstubAllGlobals(); });

describe("stickerFileUrl", () => {
  it("routes through the dev library endpoint", () => {
    expect(stickerFileUrl("star.png")).toBe("/api/stickers/file?name=star.png");
  });

  it("encodes names with spaces and symbols", () => {
    expect(stickerFileUrl("my sticker (1).png")).toBe("/api/stickers/file?name=my%20sticker%20(1).png");
  });

  it("encodes a name that would otherwise traverse", () => {
    expect(stickerFileUrl("../secret.png")).toContain("..%2Fsecret.png");
  });
});

describe("favorites", () => {
  it("is empty with no storage at all", () => {
    expect(loadFavorites()).toEqual([]);
  });

  it("round-trips through storage", () => {
    installStorage();
    toggleFavorite("star.png");
    expect(loadFavorites()).toEqual(["star.png"]);
  });

  it("toggles off again", () => {
    installStorage({ [KEY]: JSON.stringify(["star.png", "heart.svg"]) });
    expect(toggleFavorite("star.png")).toEqual(["heart.svg"]);
    expect(isFavorite("star.png")).toBe(false);
    expect(isFavorite("heart.svg")).toBe(true);
  });

  it("degrades to empty on corrupt storage", () => {
    installStorage({ [KEY]: "{not json" });
    expect(loadFavorites()).toEqual([]);
  });

  it("ignores non-string entries", () => {
    installStorage({ [KEY]: JSON.stringify(["ok.png", 42, null, { a: 1 }]) });
    expect(loadFavorites()).toEqual(["ok.png"]);
  });

  it("survives a storage that throws on write", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => { throw new Error("quota exceeded"); },
    });
    expect(() => toggleFavorite("star.png")).not.toThrow();
  });
});

describe("sortByFavorite", () => {
  const files = ["zebra.png", "apple.png", "moon.svg", "banana.webp"];

  it("puts favourites first, each group alphabetical", () => {
    expect(sortByFavorite(files, ["moon.svg", "zebra.png"]))
      .toEqual(["moon.svg", "zebra.png", "apple.png", "banana.webp"]);
  });

  it("is plain alphabetical with no favourites", () => {
    expect(sortByFavorite(files, [])).toEqual(["apple.png", "banana.webp", "moon.svg", "zebra.png"]);
  });

  it("ignores favourites that are no longer in the folder", () => {
    expect(sortByFavorite(["a.png", "b.png"], ["deleted.png"])).toEqual(["a.png", "b.png"]);
  });

  it("does not mutate the input", () => {
    const input = [...files];
    sortByFavorite(input, ["zebra.png"]);
    expect(input).toEqual(files);
  });
});
