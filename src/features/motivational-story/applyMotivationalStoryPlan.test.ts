import { describe, expect, it } from "vitest";
import type { Clip } from "../../domain/types";
import type { MotivationalStoryPlan } from "../../domain/motivationalStory";
import {
  applyMotivationalStoryPlan,
  fitMotivationalStoryVoiceoversToLength,
} from "./applyMotivationalStoryPlan";

const mockClips: Clip[] = [
  {
    id: "c1",
    file: new File([], "runner.mp4"),
    name: "Runner Clip",
    durationSec: 10,
    width: 1080,
    height: 1920,
  },
];

const mockPlan: MotivationalStoryPlan = {
  id: "p1",
  title: "Build Discipline",
  prompt: "Discipline reel",
  targetDurationSec: 30,
  hook: "Discipline over motivation.",
  createdAt: Date.now(),
  shots: [
    {
      id: "s1",
      description: "Runner lacing up shoes",
      capture: "action",
      framing: "close-up",
      approxDurationSec: 4,
      matchedClipId: "c1",
    },
    {
      id: "s2",
      description: "Sprint in the rain",
      capture: "action",
      framing: "wide",
      approxDurationSec: 5,
    },
  ],
  script: [
    {
      id: "l1",
      text: "Motivation gets you started. Discipline keeps you growing.",
      purpose: "hook",
      approxDurationSec: 4,
      shotId: "s1",
    },
    {
      id: "l2",
      text: "Show up even on the days you don't feel like it.",
      purpose: "action",
      approxDurationSec: 5,
      shotId: "s2",
    },
  ],
};

describe("applyMotivationalStoryPlan", () => {
  it("converts a plan into Story, Cut, and placeholder clips", () => {
    const applied = applyMotivationalStoryPlan(mockPlan, mockClips, "9:16");

    expect(applied.cut.beats.length).toBe(2);
    expect(applied.cut.voSegments?.length).toBe(2);
    expect(applied.placeholderClips.length).toBe(1);
    expect(applied.cut.beats[0].clipId).toBe("c1");
    expect(applied.cut.beats[1].clipId).toContain("placeholder");
    expect(applied.cut.voSegments?.[0].fitToBeat).toBe(true);
  });

  it("fits voiceover lengths to spoken narration concurrently", async () => {
    const applied = applyMotivationalStoryPlan(mockPlan, mockClips, "9:16");

    const fitted = await fitMotivationalStoryVoiceoversToLength(applied, async (text) => {
      if (text.includes("Motivation")) return { durationSec: 3.2 };
      return { durationSec: 4.8 };
    });

    expect(fitted.cut.beats[0].durationSec).toBe(3.2);
    expect(fitted.cut.beats[1].durationSec).toBe(4.8);
    expect(fitted.cut.voSegments?.[0].durationSec).toBe(3.2);
    expect(fitted.cut.voSegments?.[1].durationSec).toBe(4.8);
    expect(fitted.cut.voSegments?.[1].startTimeSec).toBe(3.2);
  });
});
