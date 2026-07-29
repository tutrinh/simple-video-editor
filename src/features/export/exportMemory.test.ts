import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Beat, Clip, Cut } from "../../domain/types";

const state = vi.hoisted(() => ({
  sourceReads: 0,
  readsAtFirstEngineStart: -1,
  engineOutputs: [] as string[],
  engineArgs: [] as string[][],
}));

vi.mock("../../lib/ffmpegEngine", () => ({
  multithreadReady: () => false,
  runIsolated: vi.fn(async (_inputs: unknown, args: string[], outputName: string) => {
    if (state.readsAtFirstEngineStart < 0) state.readsAtFirstEngineStart = state.sourceReads;
    state.engineOutputs.push(outputName);
    state.engineArgs.push(args);
    return new Uint8Array(2048);
  }),
}));

vi.mock("./captionCanvas", () => ({ renderCaptionToPng: async () => null }));
vi.mock("./stickerCanvas", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  renderStickersToPng: async () => null,
}));

const { exportConcurrency, exportCut } = await import("./export");
const { clearSegmentCache } = await import("./segmentCache");

describe("export source memory", () => {
  beforeEach(() => {
    clearSegmentCache();
    state.sourceReads = 0;
    state.readsAtFirstEngineStart = -1;
    state.engineOutputs.length = 0;
    state.engineArgs.length = 0;
  });
  afterEach(() => vi.unstubAllGlobals());

  it("starts the first isolated render without preloading every Clip", async () => {
    vi.stubGlobal("navigator", { deviceMemory: 4, hardwareConcurrency: 12 });
    const clips: Clip[] = [];
    const beats: Beat[] = [];
    for (let i = 0; i < 25; i++) {
      const file = new File([new Uint8Array(16)], `clip-${i}.mp4`, { type: "video/mp4" });
      vi.spyOn(file, "arrayBuffer").mockImplementation(async () => {
        state.sourceReads++;
        return new ArrayBuffer(16);
      });
      clips.push({
        id: `clip-${i}`,
        file,
        name: file.name,
        durationSec: 2,
        width: 1920,
        height: 1080,
      });
      beats.push({
        id: `beat-${i}`,
        clipId: `clip-${i}`,
        inSec: 0,
        outSec: 2,
        durationSec: 2,
        scriptText: "",
        captionText: "",
      });
    }
    const cut: Cut = { aspect: "16:9", beats };

    await exportCut(cut, clips, { voiceover: false });

    expect(state.readsAtFirstEngineStart).toBe(1);
  });

  it("reuses a bit-identical Beat segment on re-export", async () => {
    const file = new File([new Uint8Array(16)], "clip.mp4", { type: "video/mp4" });
    const clip: Clip = {
      id: "clip",
      file,
      name: file.name,
      durationSec: 2,
      width: 1920,
      height: 1080,
    };
    const cut: Cut = {
      aspect: "16:9",
      beats: [{
        id: "beat",
        clipId: clip.id,
        inSec: 0,
        outSec: 2,
        durationSec: 2,
        scriptText: "",
        captionText: "",
      }],
    };

    await exportCut(cut, [clip], { voiceover: false });
    await exportCut(cut, [clip], { voiceover: false });

    expect(state.engineOutputs.filter((name) => name === "seg.mp4")).toHaveLength(1);
  });

  it("bakes fade transitions into Beat renders and stream-copies the join", async () => {
    const clips: Clip[] = ["a", "b"].map((id) => ({
      id,
      file: new File([new Uint8Array(16)], `${id}.mp4`, { type: "video/mp4" }),
      name: `${id}.mp4`,
      durationSec: 2,
      width: 1920,
      height: 1080,
    }));
    const cut: Cut = {
      aspect: "16:9",
      beats: [
        { id: "ba", clipId: "a", inSec: 0, outSec: 2, durationSec: 2, scriptText: "", captionText: "" },
        {
          id: "bb", clipId: "b", inSec: 0, outSec: 2, durationSec: 2,
          scriptText: "", captionText: "", transition: "fadeblack",
          transitionSec: 0.5, transitionPosition: "start",
        },
      ],
    };

    await exportCut(cut, clips, { voiceover: false });

    expect(state.engineArgs.some((args) => args.includes("-c") && args.includes("copy"))).toBe(true);
    expect(state.engineArgs.some((args) => args.some((arg) => arg.includes("xfade=")))).toBe(false);
  });

  it("keeps the second-pass graph for cross-Beat wipes", async () => {
    const clips: Clip[] = ["a", "b"].map((id) => ({
      id,
      file: new File([new Uint8Array(16)], `${id}.mp4`, { type: "video/mp4" }),
      name: `${id}.mp4`,
      durationSec: 2,
      width: 1920,
      height: 1080,
    }));
    const cut: Cut = {
      aspect: "16:9",
      beats: [
        { id: "ba", clipId: "a", inSec: 0, outSec: 2, durationSec: 2, scriptText: "", captionText: "" },
        {
          id: "bb", clipId: "b", inSec: 0, outSec: 2, durationSec: 2,
          scriptText: "", captionText: "", transition: "wipeleft",
          transitionSec: 0.5, transitionPosition: "start",
        },
      ],
    };

    await exportCut(cut, clips, { voiceover: false });

    expect(state.engineArgs.some((args) => args.some((arg) => arg.includes("xfade=transition=wipeleft")))).toBe(true);
  });
});

describe("export concurrency", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses four isolated ST workers on high-memory 12-core machines", () => {
    vi.stubGlobal("navigator", { deviceMemory: 8, hardwareConcurrency: 12 });
    expect(exportConcurrency()).toBe(4);
  });

  it("uses one worker on memory-constrained machines", () => {
    vi.stubGlobal("navigator", { deviceMemory: 4, hardwareConcurrency: 12 });
    expect(exportConcurrency()).toBe(1);
  });
});
