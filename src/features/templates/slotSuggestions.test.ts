import { describe, expect, it, vi } from "vitest";
import {
  applyTemplateSlotSuggestion,
  buildTemplateSlotSuggestionPrompt,
  generateTemplateSlotSuggestions,
  parseTemplateSlotSuggestions,
  templateSlotSuggestionMode,
} from "./slotSuggestions";
import type { Beat } from "../../domain/types";

describe("template slot AI suggestions", () => {
  it("grounds the prompt in the template and slot without inviting invented claims", () => {
    const prompt = buildTemplateSlotSuggestionPrompt({
      templateName: "Product Review Reel",
      templateTone: "Credible and creator-led",
      slotDescription: "Hook: show the product and name the problem",
      beatIndex: 0,
      beatCount: 7,
      durationSec: 3,
      projectDirection: "A review for frequent travelers",
    });

    expect(prompt).toContain("Product Review Reel");
    expect(prompt).toContain("Beat 1 of 7");
    expect(prompt).toContain("Hook: show the product and name the problem");
    expect(prompt).toContain("A review for frequent travelers");
    expect(prompt).toContain("Do not invent");
    expect(prompt).toContain("[product]");
    expect(prompt).toContain("spoken hook or on-screen opening line");
  });

  it("asks for visual execution ideas—not hooks or caption copy—for non-hook slots", () => {
    const prompt = buildTemplateSlotSuggestionPrompt({
      templateName: "Product Review Reel",
      templateTone: "Credible and creator-led",
      slotDescription: "Close-up detail or second feature",
      beatIndex: 3,
      beatCount: 7,
      durationSec: 4,
    });

    expect(prompt).toContain("shot or scene execution ideas");
    expect(prompt).toContain("Describe what to film");
    expect(prompt).toContain("Do not write hooks, captions, voiceover, or dialogue");
    expect(prompt).not.toContain("spoken or on-screen line");
  });

  it("parses JSON or line-based responses, deduplicates, and enforces concise output", () => {
    expect(parseTemplateSlotSuggestions('{"suggestions":["Wait—this fixed my [problem].","Worth the hype?","Worth the hype?"]}')).toEqual([
      "Wait—this fixed my [problem].",
      "Worth the hype?",
    ]);

    expect(parseTemplateSlotSuggestions(`
      1. First concise idea
      - Second concise idea
      This line is deliberately ${"too long ".repeat(30)}
    `)).toEqual(["First concise idea", "Second concise idea"]);
  });

  it("uses the configured local AI provider and rejects empty responses", async () => {
    const author = vi.fn().mockResolvedValue('["Hook one","Hook two","Hook three"]');
    const input = {
      templateName: "Lifestyle Vlog Reel",
      slotDescription: "Cold open",
      beatIndex: 0,
      beatCount: 8,
      durationSec: 3,
    };

    await expect(generateTemplateSlotSuggestions(input, {
      provider: "codex",
      codexModel: "gpt-5.6",
    }, author)).resolves.toEqual(["Hook one", "Hook two", "Hook three"]);
    expect(author).toHaveBeenCalledOnce();

    await expect(generateTemplateSlotSuggestions(input, {}, async () => "certainly")).rejects.toThrow(
      "AI did not return usable suggestions",
    );
  });

  it("applies hooks as copy but stores later shot ideas without changing the Beat line", () => {
    const beat: Beat = {
      id: "beat",
      clipId: "clip",
      inSec: 0,
      outSec: 4,
      durationSec: 4,
      scriptText: "Existing line",
      captionText: "Existing line",
      captionDurations: [4],
      templateSlotDescription: "Close-up detail or second feature",
    };

    expect(templateSlotSuggestionMode(0, "Opening hook")).toBe("hook");
    expect(templateSlotSuggestionMode(3, beat.templateSlotDescription)).toBe("shot");

    expect(applyTemplateSlotSuggestion(beat, "Macro shot of the controls in use.", "shot")).toMatchObject({
      scriptText: "Existing line",
      captionText: "Existing line",
      captionDurations: [4],
      templateSlotSuggestion: "Macro shot of the controls in use.",
    });

    const hookBeat = applyTemplateSlotSuggestion(beat, "Still dealing with [problem]?", "hook");
    expect(hookBeat.scriptText).toBe("Still dealing with [problem]?");
    expect(hookBeat.captionText).toBe("Still dealing with [problem]?");
    expect(hookBeat.captionDurations).toBeUndefined();
  });
});
