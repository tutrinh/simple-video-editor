import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  normalizeHex, loadPalette, addPaletteColor, removePaletteColor,
  subscribePalette, DEFAULT_PALETTE, MAX_PALETTE,
} from "./colorPalette";

// Minimal localStorage stand-in — the vitest env is "node" (see vite.config.ts),
// so the module's typeof guards would otherwise short-circuit every path.
// Mirrors stickerLibrary.test.ts.
function installStorage(seed: Record<string, string> = {}) {
  const store = new Map(Object.entries(seed));
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  });
  return store;
}

const KEY = "vidstr_color_palette";
const seededWith = (colors: string[]) => ({ [KEY]: JSON.stringify(colors) });

beforeEach(() => { vi.unstubAllGlobals(); });

describe("normalizeHex", () => {
  it("canonicalises to lowercase #rrggbb", () => {
    expect(normalizeHex("#FFFFFF")).toBe("#ffffff");
    expect(normalizeHex("#0A84FF")).toBe("#0a84ff");
    expect(normalizeHex("#ffcc00")).toBe("#ffcc00");
  });

  it("expands shorthand", () => {
    expect(normalizeHex("#fff")).toBe("#ffffff");
    expect(normalizeHex("#F0C")).toBe("#ff00cc");
  });

  it("accepts a missing # and surrounding whitespace", () => {
    expect(normalizeHex("ffcc00")).toBe("#ffcc00");
    expect(normalizeHex("  #FFCC00  ")).toBe("#ffcc00");
    expect(normalizeHex("\tfff\n")).toBe("#ffffff");
  });

  it("rejects anything that is not a hex colour", () => {
    for (const bad of ["", "   ", "#ggg", "#12345", "#1234567", "rgb(0,0,0)", "white", "#", "12", "#ff cc00"]) {
      expect(normalizeHex(bad), bad).toBeNull();
    }
  });

  it("does not throw on non-string input", () => {
    expect(normalizeHex(undefined as unknown as string)).toBeNull();
    expect(normalizeHex(null as unknown as string)).toBeNull();
    expect(normalizeHex(123 as unknown as string)).toBeNull();
  });
});

describe("loadPalette", () => {
  it("seeds from the defaults on first read", () => {
    installStorage();
    expect(loadPalette()).toEqual(DEFAULT_PALETTE);
  });

  it("returns what is stored once the author has curated it", () => {
    installStorage(seededWith(["#111111", "#222222"]));
    expect(loadPalette()).toEqual(["#111111", "#222222"]);
  });

  it("normalises and dedupes what it reads", () => {
    installStorage(seededWith(["#FFF", "#ffffff", "ffcc00", "#FFCC00"]));
    expect(loadPalette()).toEqual(["#ffffff", "#ffcc00"]);
  });

  it("drops invalid entries but keeps the good ones", () => {
    installStorage(seededWith(["#ffffff", "not-a-colour", "", "#0a84ff"] as string[]));
    expect(loadPalette()).toEqual(["#ffffff", "#0a84ff"]);
  });

  it("degrades to the defaults on corrupt, non-array or all-invalid storage", () => {
    // An array holding nothing usable is corruption, not a curated empty row —
    // an empty palette would leave no way back to the defaults.
    for (const raw of ["{not json", '"a string"', "42", "null", '["nope","also-nope"]', "[]"]) {
      installStorage({ [KEY]: raw });
      expect(loadPalette(), raw).toEqual(DEFAULT_PALETTE);
    }
  });

  it("degrades to the defaults when there is no localStorage at all", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(loadPalette()).toEqual(DEFAULT_PALETTE);
  });

  it("hands back a copy, so a caller cannot mutate the defaults", () => {
    installStorage();
    const a = loadPalette();
    a.push("#123456");
    expect(loadPalette()).toEqual(DEFAULT_PALETTE);
    expect(DEFAULT_PALETTE).not.toContain("#123456");
  });
});

describe("addPaletteColor", () => {
  it("appends rather than prepending, so swatches keep their positions", () => {
    installStorage(seededWith(["#ffffff", "#000000"]));
    expect(addPaletteColor("#ff3b30")).toEqual(["#ffffff", "#000000", "#ff3b30"]);
    expect(addPaletteColor("#0a84ff")).toEqual(["#ffffff", "#000000", "#ff3b30", "#0a84ff"]);
  });

  it("normalises on the way in", () => {
    installStorage(seededWith(["#ffffff"]));
    expect(addPaletteColor("#F0C")).toEqual(["#ffffff", "#ff00cc"]);
  });

  it("is a no-op for a colour already present, whatever its casing", () => {
    installStorage(seededWith(["#ffffff", "#ffcc00"]));
    expect(addPaletteColor("#FFCC00")).toEqual(["#ffffff", "#ffcc00"]);
    expect(addPaletteColor("ffcc00")).toEqual(["#ffffff", "#ffcc00"]);
    expect(addPaletteColor("#fff")).toEqual(["#ffffff", "#ffcc00"]);
  });

  it("rejects an invalid hex without disturbing the palette", () => {
    installStorage(seededWith(["#ffffff"]));
    expect(addPaletteColor("chartreuse")).toEqual(["#ffffff"]);
    expect(addPaletteColor("")).toEqual(["#ffffff"]);
    expect(loadPalette()).toEqual(["#ffffff"]);
  });

  it("persists across reads", () => {
    installStorage(seededWith(["#ffffff"]));
    addPaletteColor("#123456");
    expect(loadPalette()).toEqual(["#ffffff", "#123456"]);
  });

  it("drops from the front at the cap", () => {
    const full = Array.from({ length: MAX_PALETTE }, (_, i) => `#${i.toString(16).padStart(6, "0")}`);
    installStorage(seededWith(full));
    const next = addPaletteColor("#abcdef");
    expect(next).toHaveLength(MAX_PALETTE);
    expect(next[MAX_PALETTE - 1]).toBe("#abcdef"); // the new colour is kept
    expect(next[0]).toBe(full[1]);                  // the oldest is gone
    expect(next).not.toContain(full[0]);
  });
});

describe("removePaletteColor", () => {
  it("removes a default like any other swatch", () => {
    installStorage();
    const next = removePaletteColor("#ffffff");
    expect(next).not.toContain("#ffffff");
    expect(next).toHaveLength(DEFAULT_PALETTE.length - 1);
  });

  it("matches regardless of casing or shorthand", () => {
    installStorage(seededWith(["#ffffff", "#ffcc00"]));
    expect(removePaletteColor("#FFF")).toEqual(["#ffcc00"]);
  });

  it("no-ops on a colour that is not there, or on junk", () => {
    installStorage(seededWith(["#ffffff"]));
    expect(removePaletteColor("#123456")).toEqual(["#ffffff"]);
    expect(removePaletteColor("nonsense")).toEqual(["#ffffff"]);
  });

  it("re-seeds the defaults once the last colour is removed", () => {
    // Follows from loadPalette treating an empty stored array as corruption:
    // the author always has a way back rather than an unusable empty row.
    installStorage(seededWith(["#ffffff"]));
    expect(removePaletteColor("#ffffff")).toEqual(DEFAULT_PALETTE);
  });
});

describe("subscribePalette", () => {
  it("fires on add and on remove with the new palette", () => {
    installStorage(seededWith(["#ffffff"]));
    const seen: string[][] = [];
    const off = subscribePalette((c) => seen.push(c));
    addPaletteColor("#123456");
    removePaletteColor("#123456");
    off();
    expect(seen).toEqual([["#ffffff", "#123456"], ["#ffffff"]]);
  });

  it("does not fire for a rejected or duplicate add", () => {
    installStorage(seededWith(["#ffffff"]));
    const fn = vi.fn();
    const off = subscribePalette(fn);
    addPaletteColor("#FFF");      // already present
    addPaletteColor("not-a-hex"); // invalid
    off();
    expect(fn).not.toHaveBeenCalled();
  });

  it("stops firing once unsubscribed", () => {
    installStorage(seededWith(["#ffffff"]));
    const fn = vi.fn();
    subscribePalette(fn)();
    addPaletteColor("#123456");
    expect(fn).not.toHaveBeenCalled();
  });

  it("keeps notifying the others when one subscriber throws", () => {
    installStorage(seededWith(["#ffffff"]));
    const good = vi.fn();
    const offBad = subscribePalette(() => { throw new Error("boom"); });
    const offGood = subscribePalette(good);
    expect(() => addPaletteColor("#123456")).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
    offBad(); offGood();
  });
});
