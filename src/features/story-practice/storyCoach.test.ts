import { describe, expect, it, vi } from "vitest";
import { buildStoryCoachPrompt, emptyPracticeStory, parseCoachReview, reviewPracticeStory, STORY_STEPS } from "./storyCoach";

const story = {
  ...emptyPracticeStory(),
  audience: "new creators",
  objective: "make starting feel possible",
  steps: {
    hook: "I almost quit before I posted my first video.",
    beginning: "I had recorded the same introduction twelve times.",
    problem: "I thought every sentence had to sound expert, so none sounded like me.",
    journey: "I posted one imperfect take, read the comments, and tried again the next day.",
    resolution: "The honest version connected because people recognized the fear.",
    ending: "Your first post does not prove your talent; it starts your practice.",
  },
};

const response = JSON.stringify({
  overallScore: 82,
  confidenceMessage: "You already have a clear transformation worth telling.",
  summary: "Specific and emotionally credible. The middle can carry more friction.",
  strongestMoment: "Twelve takes makes the fear tangible.",
  highestLeverageImprovement: "Add one failed attempt before the breakthrough.",
  engagementForecast: "The hook retains; the journey needs another turn.",
  stepFeedback: STORY_STEPS.map(({ id }, index) => ({ step: id, score: 70 + index, working: "Specific.", improve: "More tension.", suggestion: "Add a choice.", exampleRewrite: "Try this." })),
  deliveryTips: ["Pause after the hook.", "Stress twelve times.", "Slow down at the takeaway."],
  practiceChallenge: "Tell the journey in three escalating sentences.",
});

describe("Story Coach", () => {
  it("builds a social coaching prompt without asking AI to replace the Author", () => {
    const prompt = buildStoryCoachPrompt(story);
    expect(prompt).toContain("build the Author's skill and confidence");
    expect(prompt).toContain("Do not invent personal experiences or facts");
    expect(prompt).toContain("PROBLEM:");
    expect(prompt).toContain(story.steps.journey);
  });

  it("parses fenced reviews, clamps scores, and orders every Story Step", () => {
    const parsed = parseCoachReview(`\`\`\`json\n${response.replace('"overallScore":82', '"overallScore":120')}\n\`\`\``);
    expect(parsed.overallScore).toBe(100);
    expect(parsed.stepFeedback.map((item) => item.step)).toEqual(STORY_STEPS.map((item) => item.id));
  });

  it("reviews through the provider-neutral Coach interface", async () => {
    const coach = vi.fn(async () => response);
    const review = await reviewPracticeStory(story, { provider: "codex", codexModel: "gpt-5.6" }, coach);
    expect(review.overallScore).toBe(82);
    expect(coach).toHaveBeenCalledWith(expect.stringContaining("new creators"), expect.objectContaining({ provider: "codex" }));
  });

  it("asks for enough material to provide useful feedback", async () => {
    await expect(reviewPracticeStory(emptyPracticeStory(), {}, async () => response)).rejects.toThrow("20 words");
  });
});
