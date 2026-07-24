import { describe, it, expect } from "vitest";
import type { ProjectState } from "../state/projectReducer";
import type { Beat, Cut } from "../domain/types";
import { collectTitleFonts, stripTitleFonts, reinjectTitleFonts, titleFontKeys } from "./titleFontPersist";

function makeLayer(id: string, fontFile: File | null) {
  return {
    id, enabled: true, text: "HELLO", fontId: "custom", fontFile,
    weight: 700, sizePx: 100, letterSpacing: 0, arcDeg: 0, shadow: true,
    color: "#fff", posX: 0, posY: 0, scope: "entire" as const, introSec: 3,
  };
}

function makeBeat(id: string, layers: ReturnType<typeof makeLayer>[]): Beat {
  return { id, clipId: "c1", inSec: 0, outSec: 1, durationSec: 1, scriptText: "", captionText: "", titleLayers: layers };
}

function makeState(beats: Beat[]): ProjectState {
  const cut: Cut = { beats, aspect: "16:9" };
  return { title: "t", clips: [], direction: "", cut };
}

const fontA = new File([new Uint8Array([1, 2, 3])], "a.ttf", { type: "font/ttf" });
const fontB = new File([new Uint8Array([4, 5])], "b.otf", { type: "font/otf" });

describe("titleFontPersist", () => {
  it("collects only uploaded File fonts with stable keys", () => {
    const state = makeState([
      makeBeat("b1", [makeLayer("l1", fontA), makeLayer("l2", null)]),
      makeBeat("b2", [makeLayer("l1", fontB)]),
    ]);
    const collected = collectTitleFonts(state);
    expect(collected.map((c) => c.key).sort()).toEqual(["b1:l1", "b2:l1"]);
    expect(collected.find((c) => c.key === "b1:l1")?.file).toBe(fontA);
  });

  it("strips fontFile to null for JSON safety without dropping other fields", () => {
    const state = makeState([makeBeat("b1", [makeLayer("l1", fontA)])]);
    const stripped = stripTitleFonts(state);
    const layer = stripped.cut!.beats[0].titleLayers![0];
    expect(layer.fontFile).toBeNull();
    expect(layer.text).toBe("HELLO");
    // original state untouched (no mutation)
    expect(state.cut!.beats[0].titleLayers![0].fontFile).toBe(fontA);
  });

  it("round-trips: strip → JSON → reinject restores the fonts by key", () => {
    const state = makeState([
      makeBeat("b1", [makeLayer("l1", fontA), makeLayer("l2", null)]),
      makeBeat("b2", [makeLayer("l1", fontB)]),
    ]);
    const fonts = new Map(collectTitleFonts(state).map(({ key, file }) => [key, file as Blob]));

    // simulate persistence: strip then serialize/deserialize
    const rehydrated = JSON.parse(JSON.stringify(stripTitleFonts(state))) as ProjectState;
    expect(rehydrated.cut!.beats[0].titleLayers![0].fontFile).toBeNull();

    const restored = reinjectTitleFonts(rehydrated, fonts);
    expect(restored.cut!.beats[0].titleLayers![0].fontFile).toBe(fontA);
    expect(restored.cut!.beats[0].titleLayers![1].fontFile).toBeNull();
    expect(restored.cut!.beats[1].titleLayers![0].fontFile).toBe(fontB);
  });

  it("lists font keys for all beat layers", () => {
    const state = makeState([makeBeat("b1", [makeLayer("l1", null), makeLayer("l2", null)])]);
    expect(titleFontKeys(state)).toEqual(["b1:l1", "b1:l2"]);
  });

  it("no-ops cleanly on a project with no cut or no titles", () => {
    const empty: ProjectState = { title: "t", clips: [], direction: "" };
    expect(collectTitleFonts(empty)).toEqual([]);
    expect(stripTitleFonts(empty)).toBe(empty);
    expect(reinjectTitleFonts(empty, new Map())).toBe(empty);
    expect(titleFontKeys(empty)).toEqual([]);
  });
});
