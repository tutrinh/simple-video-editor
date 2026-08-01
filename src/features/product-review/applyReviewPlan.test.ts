import { describe, expect, it } from "vitest";
import type { Clip } from "../../domain/types";
import type { ReviewPlan } from "../../domain/productReview";
import { applyReviewPlan, fitReviewPlanVoiceoversToLength } from "./applyReviewPlan";

const clip = (id: string, durationSec = 12): Clip => ({
  id,
  file: new File([], `${id}.mp4`, { type: "video/mp4" }),
  name: `${id}.mp4`,
  durationSec,
  width: 1920,
  height: 1080,
});

const plan = (): ReviewPlan => ({
  id: "plan-1",
  productTitle: "Trail Press",
  targetDurationSec: 30,
  hook: "Hotel coffee is optional.",
  hookOptions: ["Hotel coffee is optional."],
  createdAt: 1,
  shots: [{
    id: "shot-demo",
    description: "Press coffee at a train table",
    capture: "demo",
    framing: "close-up",
    approxDurationSec: 6,
    matchedClipId: "clip-1",
  }, {
    id: "shot-verdict",
    description: "Deliver the verdict to camera",
    capture: "talking-head",
    framing: "medium",
    approxDurationSec: 4,
  }],
  script: [{
    id: "line-demo",
    text: "The steel press replaces weak hotel coffee.",
    purpose: "demo",
    approxDurationSec: 6,
    evidence: [],
    shotId: "shot-demo",
  }, {
    id: "line-verdict",
    text: "I would pack it again.",
    purpose: "verdict",
    approxDurationSec: 4,
    evidence: [{ kind: "creator-note", field: "verdict" }],
    shotId: "shot-verdict",
  }],
});

describe("applyReviewPlan", () => {
  it("turns matched Shots into a captioned 9:16 Story and Cut", () => {
    const result = applyReviewPlan(plan(), [clip("clip-1")]);

    expect(result.cut.aspect).toBe("9:16");
    expect(result.story.logline).toBe("Hotel coffee is optional.");
    expect(result.cut.beats[0]).toMatchObject({
      clipId: "clip-1",
      durationSec: 6,
      scriptText: "The steel press replaces weak hotel coffee.",
      captionText: "The steel press replaces weak hotel coffee.",
      templateSlotDescription: "Press coffee at a train table",
    });
    expect(result.cut.voSegments?.[0]).toMatchObject({
      text: "The steel press replaces weak hotel coffee.",
      startTimeSec: 0,
      durationSec: 6,
      captionVisible: true,
    });
  });

  it("creates assignable placeholders for missing footage without inventing Clips", () => {
    const result = applyReviewPlan(plan(), [clip("clip-1")]);

    expect(result.placeholderClips).toHaveLength(1);
    expect(result.placeholderClips[0]).toMatchObject({
      id: "review-placeholder-shot-verdict",
      isTemplatePlaceholder: true,
      templateSlotDescription: "Deliver the verdict to camera",
      durationSec: 4,
      width: 1080,
      height: 1920,
    });
    expect(result.cut.beats[1]).toMatchObject({
      clipId: "review-placeholder-shot-verdict",
      durationSec: 4,
      inSec: 0,
      outSec: 4,
    });
  });

  it("does not reuse one Clip across multiple Shots", () => {
    const duplicate = plan();
    duplicate.shots[1].matchedClipId = "clip-1";
    const result = applyReviewPlan(duplicate, [clip("clip-1")]);
    expect(result.cut.beats.map((beat) => beat.clipId)).toEqual([
      "clip-1",
      "review-placeholder-shot-verdict",
    ]);
  });

  it("combines multiple Script segments assigned to one Shot into one Beat", () => {
    const combined = plan();
    combined.script.splice(1, 0, {
      id: "line-proof",
      text: "It fits beside a water bottle.",
      purpose: "proof",
      approxDurationSec: 2,
      evidence: [{ kind: "creator-note", field: "pros" }],
      shotId: "shot-demo",
    });
    const result = applyReviewPlan(combined, [clip("clip-1")]);
    expect(result.cut.beats).toHaveLength(2);
    expect(result.cut.beats[0]).toMatchObject({
      durationSec: 8,
      scriptText: "The steel press replaces weak hotel coffee. It fits beside a water bottle.",
    });
  });

  it("clamps a matched Beat to available source duration and keeps Cut clocks aligned", () => {
    const result = applyReviewPlan(plan(), [clip("clip-1", 3)]);
    expect(result.cut.beats[0]).toMatchObject({ inSec: 0, outSec: 3, durationSec: 3 });
    expect(result.cut.voSegments?.map((segment) => [segment.startTimeSec, segment.durationSec])).toEqual([
      [0, 3],
      [3, 4],
    ]);
  });

  it("does not mutate the Review Plan or existing Clips", () => {
    const sourcePlan = plan();
    const clips = [clip("clip-1")];
    const beforePlan = JSON.stringify(sourcePlan);
    const beforeClip = clips[0];
    applyReviewPlan(sourcePlan, clips);
    expect(JSON.stringify(sourcePlan)).toBe(beforePlan);
    expect(clips[0]).toBe(beforeClip);
  });

  it("fits all AI voiceovers and beats to exact spoken narration duration", async () => {
    const raw = applyReviewPlan(plan(), [clip("clip-1")]);
    const synthMock = async (text: string) => {
      if (text.includes("steel press")) return { durationSec: 2.8 };
      return { durationSec: 4.5 };
    };

    const fitted = await fitReviewPlanVoiceoversToLength(raw, synthMock);

    expect(fitted.cut.beats[0].durationSec).toBe(2.8);
    expect(fitted.cut.beats[0].outSec).toBe(fitted.cut.beats[0].inSec + 2.8);
    expect(fitted.cut.voSegments?.[0]).toMatchObject({
      startTimeSec: 0,
      durationSec: 2.8,
      fitToBeat: true,
    });

    expect(fitted.cut.beats[1].durationSec).toBe(4.5);
    expect(fitted.cut.voSegments?.[1]).toMatchObject({
      startTimeSec: 2.8,
      durationSec: 4.5,
      fitToBeat: true,
    });
  });
});
