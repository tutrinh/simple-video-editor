import { describe, expect, it } from "vitest";
import type { Beat, Cut } from "../../domain/types";
import { applyHookVariant, buildHookPrompt, generateHookVariants, parseHookVariants } from "./hookLab";

const hookInput = {
  brief: { audience: "new runners", goal: "saves" as const, promise: "a steadier first mile", evidence: "GPS split", callToAction: "save the drill" },
  logline: "A runner fixes their pacing.",
  beats: [{ label: "track", subjectAction: "Runner checks a watch", settingMood: "Focused", currentLine: "Start slower." }],
};

const validHooks = JSON.stringify({ hooks: [
  { mechanism: "question", spokenLine: "Why does mile one feel impossible?", onScreenText: "Mile one?", visualDirection: "Open on the watch", rationale: "Creates curiosity" },
  { mechanism: "tension", spokenLine: "Your first mile is stealing the finish.", onScreenText: "Start too fast?", visualDirection: "Show the first split", rationale: "Names the conflict" },
  { mechanism: "result-first", spokenLine: "This split made my finish steadier.", onScreenText: "A steadier finish", visualDirection: "Lead with the final split", rationale: "Shows the result" },
] });

const beat = (id: string, line: string): Beat => ({
  id,
  clipId: `clip-${id}`,
  inSec: 0,
  outSec: 3,
  durationSec: 3,
  scriptText: line,
  captionText: line,
});

describe("Hook Lab", () => {
  it("asks for distinct hooks grounded in the brief and available footage", () => {
    const prompt = buildHookPrompt(hookInput);
    expect(prompt).toContain("new runners");
    expect(prompt).toContain("Do not invent results");
    expect(prompt).toContain("result-first, question, contradiction, tension, visual-reveal");
  });

  it("parses valid hooks and rejects duplicate mechanisms", () => {
    const hooks = parseHookVariants(JSON.stringify({ hooks: [
      { mechanism: "question", spokenLine: "Why does mile one feel impossible?", onScreenText: "Mile one?", visualDirection: "Open on the watch", rationale: "Creates curiosity" },
      { mechanism: "question", spokenLine: "Duplicate", onScreenText: "", visualDirection: "", rationale: "" },
      { mechanism: "tension", spokenLine: "Your first mile is stealing the finish.", onScreenText: "Start too fast?", visualDirection: "Show the first split", rationale: "Names the conflict" },
      { mechanism: "result-first", spokenLine: "This split made my finish steadier.", onScreenText: "A steadier finish", visualDirection: "Lead with the final split", rationale: "Shows the result" },
    ] }));
    expect(hooks).toHaveLength(3);
    expect(hooks.map((hook) => hook.id)).toEqual(["hook-question", "hook-tension", "hook-result-first"]);
  });

  it("turns a plain-language model refusal into a useful Hook Lab error", () => {
    expect(() => parseHookVariants("I can't create hooks from that request.")).toThrow(
      "Hook Lab did not receive valid JSON from the Writer.",
    );
  });

  it("makes one repair attempt when the Writer returns prose instead of JSON", async () => {
    const prompts: string[] = [];
    const hooks = await generateHookVariants(hookInput, {}, async (prompt) => {
      prompts.push(prompt);
      return prompts.length === 1 ? "I can't create hooks from that request." : validHooks;
    });
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("Repair the following invalid Hook Lab response");
    expect(hooks).toHaveLength(3);
  });

  it("returns a stable error after the repair attempt also fails", async () => {
    let calls = 0;
    await expect(generateHookVariants(hookInput, {}, async () => {
      calls++;
      return "I can't create hooks from that request.";
    })).rejects.toThrow("Hook Lab could not generate valid hooks after one repair attempt");
    expect(calls).toBe(2);
  });

  it("changes only the opening beat and its matching seeded VO when a hook is applied", () => {
    const cut: Cut = {
      aspect: "9:16",
      beats: [beat("one", "Old hook"), beat("two", "Proof"), beat("three", "CTA")],
      voSegments: [
        { id: "opening-vo", text: "Old hook", startTimeSec: 0, durationSec: 3, captionVisible: true },
        { id: "manual-vo", text: "A manual aside", startTimeSec: 0, durationSec: 2, captionVisible: true },
        { id: "body-vo", text: "Proof", startTimeSec: 3, durationSec: 3, captionVisible: true },
      ],
    };
    const applied = applyHookVariant(cut, undefined, {
      id: "hook-question",
      mechanism: "question",
      spokenLine: "What if your first mile is the problem?",
      onScreenText: "First mile?",
      visualDirection: "Open on the watch",
      rationale: "Creates curiosity",
    });
    expect(applied.cut.beats.map((item) => item.scriptText)).toEqual([
      "What if your first mile is the problem?",
      "Proof",
      "CTA",
    ]);
    expect(applied.cut.beats[0].storyPurpose).toBe("hook");
    expect(applied.cut.beats[1]).toBe(cut.beats[1]);
    expect(applied.cut.voSegments?.map((segment) => segment.text)).toEqual([
      "What if your first mile is the problem?",
      "A manual aside",
      "Proof",
    ]);
    expect(applied.cut.voSegments?.[1]).toBe(cut.voSegments?.[1]);
  });
});
