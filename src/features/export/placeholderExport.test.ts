import { describe, expect, it, vi } from "vitest";
import type { Clip, Cut } from "../../domain/types";

const { runIsolated } = vi.hoisted(() => ({
  runIsolated: vi.fn(async (inputs: Array<{ name: string; data: Uint8Array }>) => {
    if (inputs.some((input) => input.name === "in.mp4" && input.data.byteLength === 0)) {
      throw new Error("FFmpeg processing failed (code 1): moov atom not found | in.mp4: Invalid data found when processing input");
    }
    return new Uint8Array([1]);
  }),
}));

vi.mock("../../lib/ffmpegEngine", () => ({
  runIsolated,
  multithreadReady: () => false,
}));

import { exportCut } from "./export";

describe("template placeholder export", () => {
  it("stops before FFmpeg instead of sending an empty in.mp4", async () => {
    const placeholder: Clip = {
      id: "template-slot-1",
      file: new File([], "empty-template-slot-1.mp4", { type: "video/mp4" }),
      name: "Empty · Close-up product detail",
      durationSec: 3,
      width: 1920,
      height: 1080,
      isTemplatePlaceholder: true,
      templateSlotDescription: "Close-up product detail",
    };
    const cut: Cut = {
      aspect: "16:9",
      beats: [{
        id: "beat-1",
        clipId: placeholder.id,
        inSec: 0,
        outSec: 3,
        durationSec: 3,
        scriptText: "",
        captionText: "",
        templateSlotDescription: "Close-up product detail",
      }],
    };

    await expect(exportCut(cut, [placeholder], { voiceover: false })).rejects.toThrow(
      "Fill all empty template slots before exporting",
    );
    expect(runIsolated).not.toHaveBeenCalled();
  });
});
