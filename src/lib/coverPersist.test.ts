import { describe, expect, it } from "vitest";
import type { Cover, CoverTitle } from "../domain/types";
import type { ProjectState } from "../state/projectReducer";
import { collectCoverFiles, coverKeys, reinjectCoverFiles, stripCoverFiles } from "./coverPersist";

const frame = (name = "cover-frame.jpg") =>
  new File([new Uint8Array([1, 2, 3])], name, { type: "image/jpeg" });

function title(over: Partial<CoverTitle> = {}): CoverTitle {
  return {
    id: "t1", enabled: true, text: "HELLO", fontId: "app-font:Inter.ttf", fontFile: null,
    weight: 700, sizePx: 90, letterSpacing: 0, arcDeg: 0, shadow: true,
    color: "#ffffff", posX: 0, posY: 0, ...over,
  };
}

function cover(over: Partial<Cover> = {}): Cover {
  return {
    id: "cv1", frame: frame(), sourceLabel: "Beat 2 @ 1.4s", aspect: "9:16",
    zoom: 1.4, zoomX: 10, zoomY: -5, grade: { exposure: 12 },
    stickers: [], titles: [], ...over,
  };
}

function state(over: Partial<ProjectState> = {}): ProjectState {
  return { title: "T", clips: [], direction: "", ...over };
}

describe("collectCoverFiles", () => {
  it("keys each frame by its Cover id", () => {
    const s = state({ covers: [cover({ id: "a" }), cover({ id: "b" })] });
    expect(collectCoverFiles(s).map((e) => e.key)).toEqual(["a", "b"]);
  });

  it("is empty for a project with no Covers", () => {
    expect(collectCoverFiles(state())).toEqual([]);
  });

  it("skips a Cover whose frame is not a Blob", () => {
    // Exactly the shape a project loaded from JSON has before reinjection.
    const s = state({ covers: [{ ...cover(), frame: undefined as unknown as File }] });
    expect(collectCoverFiles(s)).toEqual([]);
  });
});

describe("coverKeys", () => {
  it("lists every Cover id, including ones with no frame yet", () => {
    const s = state({ covers: [cover({ id: "a" }), { ...cover({ id: "b" }), frame: undefined as unknown as File }] });
    expect(coverKeys(s)).toEqual(["a", "b"]);
  });
});

describe("stripCoverFiles", () => {
  it("removes the frame and leaves everything else intact", () => {
    const s = state({ covers: [cover()] });
    const out = stripCoverFiles(s).covers![0];
    expect("frame" in out).toBe(false);
    expect(out.sourceLabel).toBe("Beat 2 @ 1.4s");
    expect(out.zoom).toBe(1.4);
    expect(out.grade).toEqual({ exposure: 12 });
    expect(out.aspect).toBe("9:16");
  });

  it("leaves no File anywhere JSON.stringify can reach", () => {
    const s = state({ covers: [cover({ titles: [title({ fontFile: frame("Inter.ttf") })] })] });
    const json = JSON.stringify(stripCoverFiles(s));
    // A File that survives to stringify becomes `{}` — truthy, and therefore
    // worse than absent, since the reloaded Title would carry a font file that
    // is not one.
    expect(json).not.toContain("cover-frame.jpg");
    expect(JSON.parse(json).covers[0].titles[0].fontFile).toBeNull();
  });

  it("does not disturb a title that never had an uploaded font", () => {
    const t = title();
    const s = state({ covers: [cover({ titles: [t] })] });
    expect(stripCoverFiles(s).covers![0].titles[0]).toBe(t);
  });

  it("is a no-op on a project that predates Covers", () => {
    const s = state();
    expect(stripCoverFiles(s)).toBe(s);
  });
});

describe("reinjectCoverFiles", () => {
  it("restores the frame by id", () => {
    const stripped = stripCoverFiles(state({ covers: [cover()] }));
    const restored = reinjectCoverFiles(stripped, new Map([["cv1", frame()]]));
    expect(restored.covers![0].frame).toBeInstanceOf(File);
    expect(restored.covers![0].sourceLabel).toBe("Beat 2 @ 1.4s");
  });

  it("wraps a bare Blob into a named File", () => {
    const stripped = stripCoverFiles(state({ covers: [cover()] }));
    const restored = reinjectCoverFiles(stripped, new Map([["cv1", new Blob([new Uint8Array([9])], { type: "image/jpeg" })]]));
    const f = restored.covers![0].frame;
    expect(f).toBeInstanceOf(File);
    expect(f.name).toBe("cv1.jpg");
    expect(f.type).toBe("image/jpeg");
  });

  it("drops a Cover whose pixels did not come back", () => {
    // A Cover with no picture has nothing to render and no useful broken state
    // to show, so it is not kept as an empty entry.
    const stripped = stripCoverFiles(state({ covers: [cover({ id: "a" }), cover({ id: "b" })] }));
    const restored = reinjectCoverFiles(stripped, new Map([["a", frame()]]));
    expect(restored.covers!.map((c) => c.id)).toEqual(["a"]);
  });

  it("is a no-op on a project that predates Covers", () => {
    const s = state();
    expect(reinjectCoverFiles(s, new Map())).toBe(s);
  });
});

describe("the full round trip", () => {
  it("survives strip → JSON → parse → reinject unchanged", () => {
    const original = state({
      covers: [cover({
        id: "cv1",
        veil: { mode: "linear", color: "#000000", opacity: 0, toColor: "#000000", toOpacity: 0.8, direction: "down" },
        stickers: [{ id: "sk1", fileName: "arrow.png", x: 0.5, y: 0.8, scale: 0.2, rotation: 12, opacity: 1 }],
        titles: [title({ text: "NEVER AGAIN" })],
      })],
    });

    const parsed: ProjectState = JSON.parse(JSON.stringify(stripCoverFiles(original)));
    const restored = reinjectCoverFiles(parsed, new Map([["cv1", frame()]]));
    const out = restored.covers![0];

    expect(out.frame).toBeInstanceOf(File);
    expect(out.veil).toEqual(original.covers![0].veil);
    expect(out.stickers).toEqual(original.covers![0].stickers);
    expect(out.titles[0].text).toBe("NEVER AGAIN");
    expect(out.grade).toEqual({ exposure: 12 });
    expect([out.zoom, out.zoomX, out.zoomY]).toEqual([1.4, 10, -5]);
    expect(out.aspect).toBe("9:16");
    expect(out.sourceLabel).toBe("Beat 2 @ 1.4s");
  });

  it("leaves a pre-Cover project completely untouched", () => {
    const legacy = state({ title: "Old" });
    const parsed: ProjectState = JSON.parse(JSON.stringify(stripCoverFiles(legacy)));
    expect(parsed.covers).toBeUndefined();
    expect(reinjectCoverFiles(parsed, new Map()).covers).toBeUndefined();
  });
});
