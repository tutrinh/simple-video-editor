import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Beat, Clip, Cut } from "../../domain/types";
import { PROJECT_FPS, BEAT_SPEED_STEPS } from "../../domain/types";
import { beatTiming, sourceOffsetAt } from "../../domain/beatTiming";

/**
 * PREVIEW/EXPORT PARITY for Speed and Fill (ADR-0019).
 *
 * StagePreview seeks a <video>; the export emits an ffmpeg filtergraph. Nothing
 * structural stops those two drifting, and when they do the Author only finds
 * out after a full export. So this reads the *real* emitted graph, reconstructs
 * which source frame it puts on screen at a given moment, and checks it against
 * what `sourceOffsetAt` — the function StagePreview drives its seeking from —
 * says for the same moment.
 *
 * A failure here means the preview is lying about the export.
 */

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
const calls: { args: string[]; outputName: string }[] = [];

vi.mock("../../lib/ffmpegEngine", () => ({
  multithreadReady: () => false,
  runIsolated: vi.fn(async (_inputs: unknown, args: string[], outputName: string) => {
    calls.push({ args, outputName });
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
  ...(await orig<Record<string, unknown>>()),
  renderStickersToPng: async () => PNG,
}));
vi.mock("../../lib/frameSampler", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  renderStillContained: async () => PNG,
}));

const { exportCut } = await import("./export");
const { clearSegmentCache } = await import("./segmentCache");

const clip = (id: string, durationSec: number): Clip => ({
  id,
  file: new File([new Uint8Array(16)], `${id}.mp4`),
  name: `${id}.mp4`,
  durationSec,
  width: 1920,
  height: 1080,
});

const beat = (over: Partial<Beat> = {}): Beat => ({
  id: "b1", clipId: "c1", inSec: 0, outSec: 4, durationSec: 4,
  scriptText: "", captionText: "", ...over,
});

beforeEach(() => {
  calls.length = 0;
  clearSegmentCache();
});

/** The video filter chain the export emitted for the single Beat in `cut`. */
async function videoChain(cut: Cut, clips: Clip[]): Promise<string> {
  calls.length = 0;
  // The cache keys on the argv, so two Cuts that emit the same graph share a
  // segment and the second never reaches runIsolated. Clear it per render.
  clearSegmentCache();
  await exportCut(cut, clips, {} as never);
  const seg = calls.find((c) => c.outputName === "seg.mp4");
  if (!seg) throw new Error("no Beat segment was rendered");
  const graphIdx = seg.args.findIndex((a) => a === "-filter_complex" || a === "-vf");
  if (graphIdx < 0) throw new Error("no filter graph in the segment argv");
  return seg.args[graphIdx + 1];
}

/** What the emitted graph does to time, read back out of the filter string. */
function retimingFromGraph(graph: string) {
  const setpts = /setpts=([0-9.]+)\*PTS/.exec(graph);
  const tpad = /tpad=stop_duration=([0-9.]+)/.exec(graph);
  return {
    ptsFactor: setpts ? Number(setpts[1]) : 1,
    holdSec: tpad ? Number(tpad[1]) : 0,
    loops: /(^|[,;[])loop=loop=-1/.test(graph),
  };
}

/**
 * The source offset the exported picture shows at `elapsed`, derived only from
 * the graph — deliberately NOT from the shared helper, so agreement is evidence
 * rather than tautology.
 */
function exportOffsetAt(graph: string, elapsed: number, windowSec: number): number {
  const { ptsFactor, loops } = retimingFromGraph(graph);
  // setpts=k*PTS plays the source k times slower, so consumed = elapsed / k.
  const consumed = elapsed / ptsFactor;
  if (consumed < windowSec) return consumed;
  return loops ? consumed % windowSec : windowSec;
}

const SAMPLES = [0, 0.5, 1, 1.75, 2.5, 3.25, 3.9];

describe("Speed and Fill — preview and export agree frame for frame", () => {
  const cases: { name: string; beat: Beat; clipSec: number }[] = [
    { name: "untouched Beat", beat: beat(), clipSec: 10 },
    { name: "0.5x slow motion", beat: beat({ speed: 0.5 }), clipSec: 10 },
    { name: "0.25x slow motion", beat: beat({ speed: 0.25 }), clipSec: 10 },
    { name: "footage short of the Beat, holding", beat: beat({ fill: "hold" }), clipSec: 3 },
    { name: "footage short of the Beat, looping", beat: beat({ fill: "loop" }), clipSec: 3 },
    { name: "slowed AND short, holding", beat: beat({ speed: 0.5, fill: "hold" }), clipSec: 1.5 },
    { name: "2x fast motion, holding the tail", beat: beat({ speed: 2, fill: "hold" }), clipSec: 10 },
    { name: "2x fast motion, looping the tail", beat: beat({ speed: 2, fill: "loop" }), clipSec: 10 },
    { name: "1.5x fast motion", beat: beat({ speed: 1.5, fill: "hold" }), clipSec: 10 },
    { name: "0.75x slow motion", beat: beat({ speed: 0.75 }), clipSec: 10 },
  ];

  for (const testCase of cases) {
    it(`agrees for: ${testCase.name}`, async () => {
      const clips = [clip("c1", testCase.clipSec)];
      const cut: Cut = { aspect: "16:9", beats: [testCase.beat] };
      const graph = await videoChain(cut, clips);
      const timing = beatTiming(testCase.beat, testCase.clipSec);

      for (const elapsed of SAMPLES) {
        if (elapsed >= timing.timelineSec) continue;
        const preview = sourceOffsetAt(timing, elapsed).offsetSec;
        const exported = exportOffsetAt(graph, elapsed, timing.windowSec);
        expect(
          Math.abs(preview - exported),
          `${testCase.name} @ ${elapsed}s — preview ${preview.toFixed(3)}s vs export ${exported.toFixed(3)}s`,
        ).toBeLessThan(0.001);
      }
    });
  }
});

describe("the emitted graph matches the plan the preview is built from", () => {
  it("adds no retiming filters to an untouched Beat", async () => {
    const graph = await videoChain({ aspect: "16:9", beats: [beat()] }, [clip("c1", 10)]);
    expect(retimingFromGraph(graph)).toEqual({ ptsFactor: 1, holdSec: 0, loops: false });
  });

  it("stretches presentation stamps by the inverse of Speed", async () => {
    const graph = await videoChain({ aspect: "16:9", beats: [beat({ speed: 0.5 })] }, [clip("c1", 10)]);
    expect(retimingFromGraph(graph).ptsFactor).toBeCloseTo(2, 3);
  });

  it("emits no Fill work — a Beat is sized to its footage (ADR-0020)", async () => {
    // Trim asks for 4s of a 3s Clip. The Beat is simply 3s; nothing to pad.
    for (const fill of ["hold", "loop"] as const) {
      const graph = await videoChain({ aspect: "16:9", beats: [beat({ fill })] }, [clip("c1", 3)]);
      const retiming = retimingFromGraph(graph);
      expect(retiming.holdSec).toBe(0);
      expect(retiming.loops).toBe(false);
    }
  });

  it("cuts a retimed stream to the Beat's derived length", async () => {
    // 4s of window at 0.5x IS an 8s Beat now, so that is what the trim reads.
    const graph = await videoChain({ aspect: "16:9", beats: [beat({ speed: 0.5 })] }, [clip("c1", 10)]);
    expect(graph).toMatch(/trim=duration=8\.000/);
  });

  it("shortens the segment when a Beat is sped up", async () => {
    const graph = await videoChain({ aspect: "16:9", beats: [beat({ speed: 2 })] }, [clip("c1", 10)]);
    expect(graph).toMatch(/trim=duration=2\.000/);
  });

  it("encodes at the project frame rate", async () => {
    calls.length = 0;
    await exportCut({ aspect: "16:9", beats: [beat({ speed: 0.5 })] }, [clip("c1", 10)], {} as never);
    const seg = calls.find((c) => c.outputName === "seg.mp4")!;
    const rIdx = seg.args.lastIndexOf("-r");
    expect(seg.args[rIdx + 1]).toBe(String(PROJECT_FPS));
  });

  it("slows the picture BEFORE conforming to the frame rate, so 60fps stays smooth", async () => {
    // The whole 60fps requirement rests on ordering: `-r` is an OUTPUT option
    // applied after filtering, and no `fps=` filter precedes setpts in the
    // chain. Were it the other way round, half a 60fps source's frames would be
    // discarded and then duplicated back — judder instead of slow motion.
    const graph = await videoChain({ aspect: "16:9", beats: [beat({ speed: 0.5 })] }, [clip("c1", 10)]);
    const setptsIdx = graph.indexOf("setpts=2.0000*PTS");
    expect(setptsIdx).toBeGreaterThan(-1);
    const fpsFilter = /(^|[,;[])fps=/.exec(graph);
    if (fpsFilter) expect(fpsFilter.index).toBeGreaterThan(setptsIdx);
  });

  it("time-stretches the Beat's own audio to match the picture", async () => {
    const graph = await videoChain({ aspect: "16:9", beats: [beat({ speed: 0.5 })] }, [clip("c1", 10)]);
    expect(graph).toMatch(/atempo=0\.5000/);
  });

  it("chains atempo below its 0.5 floor", async () => {
    const graph = await videoChain({ aspect: "16:9", beats: [beat({ speed: 0.25 })] }, [clip("c1", 10)]);
    expect(graph.match(/atempo=0\.5000/g)?.length).toBe(2);
  });

  it("compresses stamps and speeds audio for fast motion", async () => {
    const graph = await videoChain({ aspect: "16:9", beats: [beat({ speed: 2 })] }, [clip("c1", 10)]);
    expect(retimingFromGraph(graph).ptsFactor).toBeCloseTo(0.5, 3);
    expect(graph).toMatch(/atempo=2\.0000/);
  });

  it("leaves no tail for a fast Beat to fill", async () => {
    // 4s of window at 2x is a 2s Beat — the window ends exactly with it.
    const graph = await videoChain(
      { aspect: "16:9", beats: [beat({ speed: 2, fill: "hold" })] },
      [clip("c1", 10)],
    );
    expect(retimingFromGraph(graph).holdSec).toBe(0);
  });

  it("emits a single in-range atempo for every offered Speed", async () => {
    for (const speed of BEAT_SPEED_STEPS) {
      const graph = await videoChain({ aspect: "16:9", beats: [beat({ speed })] }, [clip("c1", 10)]);
      const factors = [...graph.matchAll(/atempo=([0-9.]+)/g)].map((m) => Number(m[1]));
      if (speed === 1) {
        expect(factors).toHaveLength(0);
        continue;
      }
      // Every offered step is reachable in one instance — none needs chaining.
      expect(factors).toHaveLength(1);
      expect(factors[0]).toBeGreaterThanOrEqual(0.5);
      expect(factors[0]).toBeLessThanOrEqual(2);
      expect(factors[0]).toBeCloseTo(speed, 4);
    }
  });
});
