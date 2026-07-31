import { describe, expect, it } from "vitest";
import type { Clip } from "../../domain/types";
import {
  authorMotivationalPrompt,
  DEFAULT_MOTIVATIONAL_PROMPT,
  generateMotivationalStoryPlan,
  parseMotivationalStoryPlanJson,
} from "./storyAuthor";

const mockClips: Clip[] = [
  {
    id: "c1",
    file: new File([], "gym.mp4"),
    name: "Gym Workout",
    durationSec: 10,
    width: 1080,
    height: 1920,
    tags: ["gym", "fitness"],
  },
  {
    id: "c2",
    file: new File([], "sunrise.mp4"),
    name: "Sunrise Run",
    durationSec: 8,
    width: 1080,
    height: 1920,
    tags: ["running", "nature"],
  },
];

describe("storyAuthor", () => {
  it("generates a structured prompt including user prompt and clip summary", () => {
    const prompt = authorMotivationalPrompt(
      { prompt: "Create a gym motivation reel", targetDurationSec: 30 },
      mockClips
    );

    expect(prompt).toContain("Create a gym motivation reel");
    expect(prompt).toContain("TARGET DURATION: ~30 seconds");
    expect(prompt).toContain("Gym Workout");
    expect(prompt).toContain("Sunrise Run");
  });

  it("parses valid JSON responses into MotivationalStoryPlan", () => {
    const rawJson = JSON.stringify({
      title: "Unstoppable Mindset",
      hook: "No excuses today.",
      beats: [
        {
          id: "b1",
          purpose: "hook",
          scriptText: "When you want to quit, remember why you started.",
          approxDurationSec: 5,
          shotDescription: "Close up of tied running shoes",
          capture: "close-up",
          framing: "close-up",
          matchedClipId: "c1",
        },
        {
          id: "b2",
          purpose: "action",
          scriptText: "Push through the pain.",
          approxDurationSec: 6,
          shotDescription: "Heavy squats",
          capture: "action",
          framing: "medium",
          matchedClipId: "c2",
        },
      ],
    });

    const plan = parseMotivationalStoryPlanJson(
      rawJson,
      { prompt: "Gym motivation", targetDurationSec: 30 },
      mockClips
    );

    expect(plan.title).toBe("Unstoppable Mindset");
    expect(plan.hook).toBe("No excuses today.");
    expect(plan.script.length).toBe(2);
    expect(plan.shots.length).toBe(2);
    expect(plan.shots[0].matchedClipId).toBe("c1");
    expect(plan.shots[1].matchedClipId).toBe("c2");
  });

  it("handles Markdown fences and JSON recovery", async () => {
    const markdownResponse = `\`\`\`json
{
  "title": "Rise Again",
  "hook": "They doubted you.",
  "beats": [
    {
      "purpose": "hook",
      "scriptText": "Prove them wrong.",
      "approxDurationSec": 5,
      "shotDescription": "Sunrise over city skyline"
    }
  ]
}
\`\`\``;

    const plan = await generateMotivationalStoryPlan(
      { prompt: "Rise again", targetDurationSec: 15 },
      mockClips,
      async () => markdownResponse
    );

    expect(plan.title).toBe("Rise Again");
    expect(plan.script[0].text).toBe("Prove them wrong.");
  });

  it("falls back to default prompt if input is empty", () => {
    const prompt = authorMotivationalPrompt(
      { prompt: "", targetDurationSec: 30 },
      []
    );
    expect(prompt).toContain(DEFAULT_MOTIVATIONAL_PROMPT);
  });
});
