import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Beat, Clip, Cut, OverlayClip, Sticker, VoSegment } from "../../domain/types";

/**
 * GOLDEN MASTER for the per-Beat filtergraph (ADR-0016, Task 1).
 *
 * `exportCut` emits its graph as an argv to `runIsolated` and never returns it,
 * so ~860 lines of index arithmetic and `[v]` label chaining have never been
 * observable to a test — a wrong `[k+1:v]` surfaces only as a wasm ffmpeg error,
 * and a graph that succeeds with the wrong layer order surfaces only by watching
 * the output file.
 *
 * This freezes what the CURRENT code emits, so the refactor that follows can be
 * checked mechanically rather than by eye. A snapshot going red is a defect
 * until proven otherwise.
 *
 * It stubs only the boundaries that need a canvas or the engine. Everything that
 * decides the SHAPE of the graph — index assignment, label chaining, window
 * intersection, the retry ladders — runs for real.
 */

// --- boundary stubs ---------------------------------------------------------
// Fixed bytes: the graph is what is under test, not the pixels.
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);

const calls: { args: string[]; outputName: string }[] = [];

vi.mock("../../lib/ffmpegEngine", () => ({
  multithreadReady: () => false,
  runIsolated: vi.fn(async (_inputs: unknown, args: string[], outputName: string) => {
    calls.push({ args, outputName });
    // Long enough to survive the `bytes.length > 1000` sanity checks downstream.
    return new Uint8Array(2048);
  }),
}));

vi.mock("./captionCanvas", () => ({ renderCaptionToPng: async () => PNG }));

vi.mock("./titleCanvas", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  ensureTitleFontFace: async () => "sans-serif",
  renderTitleLayerToPng: async () => PNG,
}));

vi.mock("./stickerCanvas", async (orig) => ({
  // The pure window/resolution helpers must stay REAL — they decide the graph.
  ...(await orig<Record<string, unknown>>()),
  renderStickersToPng: async () => PNG,
}));

vi.mock("../../lib/frameSampler", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  renderStillContained: async () => PNG,
}));

vi.mock("../effects/ledMatrix", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  renderLedMatrixToPng: async () => PNG,
}));

const { exportCut } = await import("./export");
const { clearSegmentCache } = await import("./segmentCache");

// --- fixtures ---------------------------------------------------------------

const clip = (id: string, kind?: "still"): Clip => ({
  id,
  file: new File([new Uint8Array(16)], kind ? `${id}.jpg` : `${id}.mp4`),
  name: kind ? `${id}.jpg` : `${id}.mp4`,
  durationSec: 10,
  width: 3000,
  height: 2000,
  ...(kind ? { kind } : {}),
});

const beat = (over: Partial<Beat> = {}): Beat => ({
  id: "b1", clipId: "c1", inSec: 1, outSec: 5, durationSec: 4,
  scriptText: "", captionText: "", ...over,
});

const vo = (over: Partial<VoSegment> = {}): VoSegment => ({
  id: "v1", text: "A spoken line", startTimeSec: 0, durationSec: 3,
  captionVisible: true, ...over,
});

const overlay = (over: Partial<OverlayClip> = {}): OverlayClip => ({
  id: "o1", clipId: "c2", startTimeSec: 0.5, durationSec: 2,
  inSec: 0, outSec: 2, blendMode: "normal", opacity: 0.85, volume: 0, ...over,
});

const sticker = (over: Partial<Sticker> = {}): Sticker => ({
  id: "s1", fileName: "camera.svg", startTimeSec: 0.5, durationSec: 2,
  x: 0.5, y: 0.5, scale: 0.2, rotation: 0, opacity: 1, ...over,
});

const titleLayer = (over: Record<string, unknown> = {}) => ({
  id: "l1", enabled: true, text: "TITLE", sizePx: 120, color: "#ffffff",
  posX: 0, posY: -12, scope: "entire" as const, introSec: 3, weight: 700, ...over,
});

/** Render one Cut and return the argv of every Beat segment, in order. */
async function segmentArgs(cut: Cut, clips: Clip[], opts: Record<string, unknown> = {}): Promise<string[][]> {
  calls.length = 0;
  await exportCut(cut, clips, opts as never);
  return calls.filter((c) => c.outputName === "seg.mp4").map((c) => c.args);
}

beforeEach(() => {
  calls.length = 0;
  clearSegmentCache();
});

// --- the matrix -------------------------------------------------------------
// 2^4 presence combinations of the four Layer kinds, so every `isLast` /
// index-arithmetic path is pinned before any of it moves.

const LAYERS = ["caption", "title", "overlay", "sticker"] as const;
type LayerName = (typeof LAYERS)[number];

function cutWith(present: Set<LayerName>): { cut: Cut; clips: Clip[]; opts: Record<string, unknown> } {
  const cut: Cut = {
    aspect: "16:9",
    beats: [beat()],
    ...(present.has("caption") ? { voSegments: [vo()] } : {}),
    ...(present.has("overlay") ? { overlays: [overlay()] } : {}),
    ...(present.has("sticker") ? { stickers: [sticker()] } : {}),
  };
  return {
    cut,
    clips: [clip("c1"), clip("c2")],
    opts: present.has("title") ? { title: { layers: [titleLayer()] } } : {},
  };
}

describe("golden master — Layer presence matrix", () => {
  for (let mask = 0; mask < 16; mask++) {
    const present = new Set<LayerName>(LAYERS.filter((_, i) => mask & (1 << i)));
    const name = present.size ? [...present].join("+") : "bare";

    it(`emits a stable graph for: ${name}`, async () => {
      const { cut, clips, opts } = cutWith(present);
      const [args] = await segmentArgs(cut, clips, opts);
      expect(args.join(" ")).toMatchSnapshot();
    });
  }
});

describe("golden master — the base chain variants", () => {
  const base = { aspect: "16:9" as const };

  it("crops ordinary Beat footage to fill the selected aspect", async () => {
    const [args] = await segmentArgs({ ...base, beats: [beat()] }, [clip("c1")]);
    const graph = args[args.indexOf("-filter_complex") + 1];
    expect(graph).toContain("scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080");
    expect(graph).not.toContain("force_original_aspect_ratio=decrease,pad=1920:1080");
  });

  it("static Zoom", async () => {
    const [args] = await segmentArgs({ ...base, beats: [beat({ zoom: 1.5, zoomX: 20, zoomY: -10 })] }, [clip("c1")]);
    expect(args.join(" ")).toMatchSnapshot();
  });

  it("intro Zoom — the split/overlay fork", async () => {
    const [args] = await segmentArgs(
      { ...base, beats: [beat({ zoom: 1.5, zoomScope: "intro", zoomSec: 2 })] }, [clip("c1")]);
    expect(args.join(" ")).toMatchSnapshot();
  });

  it("rotation", async () => {
    const [args] = await segmentArgs({ ...base, beats: [beat({ rotation: 4 })] }, [clip("c1")]);
    expect(args.join(" ")).toMatchSnapshot();
  });

  it("Ken Burns on a Still — replaces scale/pad", async () => {
    const [args] = await segmentArgs(
      { ...base, beats: [beat({ clipId: "s1", framing: "kenBurns", kenBurns: { fromScale: 1, fromX: -8, fromY: -5, toScale: 1.2, toX: 8, toY: 5 } })] },
      [clip("s1", "still")]);
    expect(args.join(" ")).toMatchSnapshot();
  });

  it("a Still with no move — looped, not seeked", async () => {
    const [args] = await segmentArgs({ ...base, beats: [beat({ clipId: "s1" })] }, [clip("s1", "still")]);
    expect(args.join(" ")).toMatchSnapshot();
  });

  it("a global Grade — lut3d sidecar, consuming no input index", async () => {
    const [args] = await segmentArgs(
      { ...base, beats: [beat({ colorAdjustments: { exposure: 20, contrast: -10 } })] }, [clip("c1")]);
    expect(args.join(" ")).toMatchSnapshot();
  });

  it("pixelates footage with compression-safe mosaic blocks before authored layers", async () => {
    const [args] = await segmentArgs(
      { ...base, beats: [beat({ ledMatrixEffect: { enabled: true, shape: "pixelate", cellSizePx: 24 } })] },
      [clip("c1")],
    );
    const graph = args[args.indexOf("-filter_complex") + 1];

    expect(args.join(" ")).not.toContain("led_matrix_");
    expect(graph).toContain("scale=80:45:flags=area,scale=1920:1080:flags=neighbor");
  });

  it("masks sampled mosaic colors into large circles", async () => {
    const [args] = await segmentArgs(
      { ...base, beats: [beat({ ledMatrixEffect: { enabled: true, shape: "pixelate-circle" } })] },
      [clip("c1")],
    );
    const graph = args[args.indexOf("-filter_complex") + 1];

    expect(args.join(" ")).toContain("pixel_circle_24_000000.png");
    expect(graph).toContain("scale=80:45:flags=area,scale=1920:1080:flags=neighbor");
    expect(graph).toContain("format=rgba[led_texture_0]");
    expect(graph).toContain("overlay=x=0:y=0:eof_action=pass[v]");
    expect(graph).not.toContain("blend=all_mode=");
  });
});

describe("Beat audio boundaries", () => {
  it("ramps source audio to zero at both edges before Beats are concatenated", async () => {
    const args = await segmentArgs(
      {
        aspect: "16:9",
        beats: [
          beat({ id: "b1", clipId: "c1", inSec: 0, outSec: 4 }),
          beat({ id: "b2", clipId: "c2", inSec: 0, outSec: 4, volume: 0.8 }),
        ],
      },
      [clip("c1"), clip("c2")],
    );

    expect(args).toHaveLength(2);
    for (const segment of args) {
      const graph = segment.join(" ");
      expect(graph).toContain("afade=t=in:st=0:d=0.015");
      expect(graph).toContain("afade=t=out:st=3.985:d=0.015");
    }
  });

  it("re-encodes one continuous Cut audio stream instead of copying per-Beat AAC joins", async () => {
    await segmentArgs(
      {
        aspect: "16:9",
        beats: [
          beat({ id: "b1", clipId: "c1", inSec: 0, outSec: 4 }),
          beat({ id: "b2", clipId: "c2", inSec: 0, outSec: 4, volume: 0.8 }),
        ],
      },
      [clip("c1"), clip("c2")],
      { music: new File([new Uint8Array(16)], "bed.mp3", { type: "audio/mpeg" }) },
    );

    const concat = calls.find((call) => call.outputName === "video.mp4");
    expect(concat).toBeDefined();
    const concatArgs = concat?.args.join(" ") ?? "";
    expect(concatArgs).toContain("-c:v copy");
    expect(concatArgs).toContain("-c:a aac");
    expect(concatArgs).not.toContain("-c copy");
  });
});

describe("first-pass fades", () => {
  it("applies a fade after an RGB blend Overlay has composited", async () => {
    const first = beat({ id: "b1", clipId: "c1", inSec: 0, outSec: 4, durationSec: 4 });
    const second = beat({
      id: "b2",
      clipId: "c2",
      inSec: 0,
      outSec: 4,
      durationSec: 4,
      transition: "fadeblack",
      transitionSec: 0.5,
      transitionPosition: "start",
    });
    const cut: Cut = {
      aspect: "16:9",
      beats: [first, second],
      overlays: [overlay({ clipId: "c3", startTimeSec: 0, durationSec: 2, blendMode: "multiply" })],
    };

    const argsList = await segmentArgs(cut, [clip("c1"), clip("c2"), clip("c3")]);
    const firstArgs = argsList.find((args) => args.join(" ").includes("blend=all_mode=multiply"));
    expect(firstArgs).toBeDefined();
    const graph = firstArgs![firstArgs!.indexOf("-filter_complex") + 1];

    expect(graph.indexOf("blend=all_mode=multiply")).toBeGreaterThanOrEqual(0);
    expect(graph.indexOf("fade=t=out")).toBeGreaterThan(graph.indexOf("blend=all_mode=multiply"));
  });
});

describe("video title mask ordering", () => {
  it("masks the completed blend Overlay while leaving Captions above the matte", async () => {
    const cut: Cut = {
      aspect: "16:9",
      beats: [beat({ id: "b1", clipId: "c1", inSec: 0, outSec: 4, durationSec: 4 })],
      overlays: [overlay({ clipId: "c2", startTimeSec: 0, durationSec: 2, blendMode: "multiply" })],
      voSegments: [vo({ startTimeSec: 0, durationSec: 3, captionVisible: true })],
    };
    const opts = { title: { layers: [titleLayer({ maskMode: "video" })] } };

    const argsList = await segmentArgs(cut, [clip("c1"), clip("c2")], opts);
    const args = argsList.find((candidate) => candidate.join(" ").includes("blend=all_mode=multiply"));
    expect(args).toBeDefined();
    const graph = args![args!.indexOf("-filter_complex") + 1];
    const blendAt = graph.indexOf("blend=all_mode=multiply");
    const titleAt = graph.indexOf("format=rgba[ovt_0]");
    const captionAt = graph.lastIndexOf("overlay=x=0:y=0");

    expect(titleAt).toBeGreaterThan(blendAt);
    expect(captionAt).toBeGreaterThan(titleAt);
  });
});

describe("timed title ranges", () => {
  it("gates a cut-level title to its exact Cut-time range", async () => {
    const [args] = await segmentArgs(
      { aspect: "16:9", beats: [beat()] },
      [clip("c1")],
      {
        title: {
          layers: [titleLayer({
            scope: "range",
            startSec: 1,
            durationSec: 1.5,
            animation: "none",
          })],
        },
      },
    );
    const graph = args[args.indexOf("-filter_complex") + 1];

    expect(graph).toContain("enable='between(t+0.000,1.000,2.500)'");
  });

  it("gates a Beat title using Beat-local time", async () => {
    const [args] = await segmentArgs(
      { aspect: "16:9", beats: [beat()] },
      [clip("c1")],
      {
        beatTitles: {
          b1: [titleLayer({
            scope: "range",
            startSec: 0.75,
            durationSec: 1.25,
            animation: "none",
          })],
        },
      },
    );
    const graph = args[args.indexOf("-filter_complex") + 1];

    expect(graph).toContain("enable='between(t,0.750,2.000)'");
  });

  it("omits the alpha fade when fade out is disabled", async () => {
    const [args] = await segmentArgs(
      { aspect: "16:9", beats: [beat()] },
      [clip("c1")],
      {
        title: {
          layers: [titleLayer({
            scope: "range",
            startSec: 1,
            durationSec: 1.5,
            animation: "none",
            fadeOut: false,
          })],
        },
      },
    );
    const graph = args[args.indexOf("-filter_complex") + 1];

    expect(graph).not.toContain("alpha=1");
    expect(graph).toContain("enable='between(t+0.000,1.000,2.500)'");
  });
});

describe("golden master — the widest members", () => {
  it("a blended Overlay drives the gbrp retry", async () => {
    const [args] = await segmentArgs(
      { aspect: "16:9", beats: [beat()], overlays: [overlay({ blendMode: "screen" })] },
      [clip("c1"), clip("c2")]);
    expect(args.join(" ")).toMatchSnapshot();
  });

  it("per-Beat titles use segment-local time, cut-level titles use cut time", async () => {
    const [args] = await segmentArgs(
      { aspect: "16:9", beats: [beat()] },
      [clip("c1")],
      {
        title: { layers: [titleLayer({ text: "CUT" })] },
        beatTitles: { b1: [titleLayer({ id: "bl1", text: "BEAT" })] },
      });
    expect(args.join(" ")).toMatchSnapshot();
  });

  it("everything at once — the case with the most index arithmetic", async () => {
    const [args] = await segmentArgs(
      {
        aspect: "16:9",
        beats: [beat({ zoom: 1.4, rotation: 3 })],
        voSegments: [vo()],
        overlays: [overlay({ blendMode: "screen" })],
        stickers: [sticker(), sticker({ id: "s2", startTimeSec: 1 })],
      },
      [clip("c1"), clip("c2")],
      {
        title: { layers: [titleLayer({ text: "CUT" })] },
        beatTitles: { b1: [titleLayer({ id: "bl1", text: "BEAT" })] },
      });
    expect(args.join(" ")).toMatchSnapshot();
  });

  it("a second Beat shifts every window into segment-local time", async () => {
    const all = await segmentArgs(
      {
        aspect: "16:9",
        beats: [beat({ id: "b1" }), beat({ id: "b2", inSec: 0, outSec: 3, durationSec: 3 })],
        voSegments: [vo({ startTimeSec: 3, durationSec: 3 })],
        stickers: [sticker({ startTimeSec: 4.5 })],
      },
      [clip("c1")]);
    expect(all).toHaveLength(2);
    expect(all.map((a) => a.join(" ")).join("\n---\n")).toMatchSnapshot();
  });
});

describe("golden master — invariants the refactor must preserve", () => {
  it("exactly one chain emits [v], in every combination", async () => {
    for (let mask = 0; mask < 16; mask++) {
      const present = new Set<LayerName>(LAYERS.filter((_, i) => mask & (1 << i)));
      const { cut, clips, opts } = cutWith(present);
      const [args] = await segmentArgs(cut, clips, opts);
      const fc = args[args.indexOf("-filter_complex") + 1];
      const emitters = fc.split(";").filter((c) => /\[v\]$/.test(c.trim()));
      expect(emitters, `mask ${mask} (${[...present].join("+") || "bare"})`).toHaveLength(1);
    }
  });

  it("every referenced input index exists in the argv", async () => {
    // The failure this pins: a hand-derived offset pointing past the -i list.
    for (let mask = 0; mask < 16; mask++) {
      const present = new Set<LayerName>(LAYERS.filter((_, i) => mask & (1 << i)));
      const { cut, clips, opts } = cutWith(present);
      const [args] = await segmentArgs(cut, clips, opts);
      const inputCount = args.filter((a) => a === "-i").length;
      const fc = args[args.indexOf("-filter_complex") + 1];
      for (const m of fc.matchAll(/\[(\d+):[va]\]/g)) {
        expect(Number(m[1]), `mask ${mask}: ${m[0]} but only ${inputCount} inputs`).toBeLessThan(inputCount);
      }
    }
  });
});
