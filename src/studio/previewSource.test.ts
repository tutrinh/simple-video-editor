import { describe, expect, it } from "vitest";
import type { Clip } from "../domain/types";
import { previewFileForClip } from "./previewSource";

describe("previewFileForClip", () => {
  it("preserves the original source quality for every preview slot", () => {
    const original = new File(["original"], "source.mov", { type: "video/quicktime" });
    const normalized = new File(["normalized"], "source.mp4", { type: "video/mp4" });
    const clip = { id: "clip-2", name: "source.mov", file: original, normalized, durationSec: 5, width: 1920, height: 1080, kind: "video" } as Clip;

    expect(previewFileForClip(clip)).toBe(original);
  });
});
