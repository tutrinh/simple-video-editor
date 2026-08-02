// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { STORY_STEPS } from "../features/story-practice/storyCoach";
import StoryPracticeView from "./StoryPracticeView";

afterEach(cleanup);

beforeEach(() => {
  let store: Record<string, string> = {};
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => { store[key] = value; },
      removeItem: (key: string) => { delete store[key]; },
      clear: () => { store = {}; },
      length: 0,
      key: () => null,
    },
    writable: true,
    configurable: true,
  });
});

const reviewResponse = JSON.stringify({
  overallScore: 84,
  confidenceMessage: "Your story has a specific, credible transformation.",
  summary: "The opening earns attention and the ending pays it off. Add one more difficult choice in the journey.",
  strongestMoment: "Recording twelve takes makes the struggle tangible.",
  highestLeverageImprovement: "Show the decision that finally made posting possible.",
  engagementForecast: "Viewers should stay through the problem; the journey needs one sharper turn.",
  stepFeedback: STORY_STEPS.map(({ id }) => ({
    step: id,
    score: 80,
    working: "The detail feels personal and specific.",
    improve: "The consequence could be clearer.",
    suggestion: "Add one concrete choice.",
    exampleRewrite: "I stopped chasing a perfect take and posted the honest one.",
  })),
  deliveryTips: ["Pause after the hook.", "Slow down at the decision.", "Land the final line cleanly."],
  practiceChallenge: "Retell the journey in three escalating sentences.",
});

describe("StoryPracticeView", () => {
  it("guides a full story arc and renders an AI Coach review", async () => {
    const coach = vi.fn(async () => reviewResponse);
    render(<StoryPracticeView coach={coach} />);

    expect(screen.getByText("Practice the story before you perform it.")).toBeTruthy();
    for (const step of STORY_STEPS) expect(screen.getAllByText(step.label).length).toBeGreaterThan(0);

    fireEvent.change(screen.getByPlaceholderText("Write your hook…"), {
      target: { value: "I recorded the same opening twelve times because I believed every sentence had to sound perfect before anyone could hear my real voice." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Analyze my story" }));

    await waitFor(() => expect(coach).toHaveBeenCalled());
    expect(await screen.findByRole("region", { name: "Coach Review" })).toBeTruthy();
    expect(screen.getByText("84")).toBeTruthy();
    expect(screen.getByText("Highest-leverage improvement")).toBeTruthy();
    expect(screen.getByText("Retell the journey in three escalating sentences.")).toBeTruthy();
  });

  it("keeps the selected AI engine and model visible to the author", () => {
    render(<StoryPracticeView coach={vi.fn()} />);
    expect((screen.getByLabelText("AI engine") as HTMLSelectElement).value).toBe("claude");
    fireEvent.change(screen.getByLabelText("AI engine"), { target: { value: "codex" } });
    expect((screen.getByLabelText("Model") as HTMLSelectElement).value).toBe("gpt-5.6");
  });

  it("reveals a random complete example and can load it into the practice fields", () => {
    render(<StoryPracticeView coach={vi.fn()} />);

    const disclosure = screen.getByText("See a complete example").closest("details");
    expect(disclosure?.hasAttribute("open")).toBe(false);
    fireEvent.click(screen.getByText("See a complete example"));
    expect(disclosure?.hasAttribute("open")).toBe(true);

    const displayedHook = within(disclosure!).getByText("Hook").closest("div")?.querySelector("p")?.textContent;
    fireEvent.click(screen.getByRole("button", { name: "Use this example" }));
    expect((screen.getByPlaceholderText("Write your hook…") as HTMLTextAreaElement).value).toBe(displayedHook);
    expect(screen.getByText(/words$/).textContent).not.toBe("0 words");
  });

  it("regenerates a different example", () => {
    render(<StoryPracticeView coach={vi.fn()} />);
    fireEvent.click(screen.getByText("See a complete example"));

    const disclosure = screen.getByText("See a complete example").closest("details")!;
    const firstTitle = within(disclosure).getByText("Example").nextElementSibling?.textContent;
    fireEvent.click(screen.getByRole("button", { name: "Regenerate example" }));
    const nextTitle = within(disclosure).getByText("Example").nextElementSibling?.textContent;

    expect(nextTitle).not.toBe(firstTitle);
  });
});
