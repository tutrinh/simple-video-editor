import { describe, expect, it } from "vitest";
import type { Clip } from "../../domain/types";
import type { ReviewPlan } from "../../domain/productReview";
import { activeVoCaption } from "../../lib/pacing";
import { exportedCaptionWindows } from "../export/captionWindows";
import { applyReviewPlan } from "./applyReviewPlan";

const clips: Clip[] = [{
  id: "clip-1",
  file: new File([], "demo.mp4", { type: "video/mp4" }),
  name: "demo.mp4",
  durationSec: 10,
  width: 1920,
  height: 1080,
}];

const plan: ReviewPlan = {
  id: "plan",
  productTitle: "Pocket Light",
  targetDurationSec: 15,
  hook: "Better light, less luggage.",
  createdAt: 1,
  shots: [
    { id: "a", description: "Demo", capture: "demo", framing: "close-up", approxDurationSec: 4, matchedClipId: "clip-1" },
    { id: "b", description: "Verdict", capture: "talking-head", framing: "medium", approxDurationSec: 3 },
  ],
  script: [
    { id: "sa", text: "This light fits in a side pocket.", purpose: "demo", approxDurationSec: 4, evidence: [{ kind: "product-claim", claimId: "c1" }], shotId: "a" },
    { id: "sb", text: "I would carry it again.", purpose: "verdict", approxDurationSec: 3, evidence: [{ kind: "creator-note", field: "verdict" }], shotId: "b" },
  ],
};

describe("Product Review preview/export parity", () => {
  it("shows and exports the same caption text at every generated Beat", () => {
    const { cut } = applyReviewPlan(plan, clips);
    let beatStart = 0;
    for (const beat of cut.beats) {
      const previewText = activeVoCaption(cut.voSegments, beatStart + beat.durationSec / 2);
      const exportWindows = exportedCaptionWindows(cut.voSegments, beatStart, beat.durationSec);
      expect(exportWindows).toEqual([{
        text: previewText,
        startSec: 0,
        endSec: beat.durationSec,
      }]);
      expect(previewText).toBe(beat.captionText);
      beatStart += beat.durationSec;
    }
  });

  it("does not leak one Beat's caption across the exact Beat boundary", () => {
    const { cut } = applyReviewPlan(plan, clips);
    const firstDuration = cut.beats[0].durationSec;
    expect(activeVoCaption(cut.voSegments, firstDuration - 0.001)).toBe(cut.beats[0].captionText);
    expect(activeVoCaption(cut.voSegments, firstDuration)).toBe(cut.beats[1].captionText);
    expect(exportedCaptionWindows(cut.voSegments, firstDuration, cut.beats[1].durationSec)[0].startSec).toBe(0);
  });
});
