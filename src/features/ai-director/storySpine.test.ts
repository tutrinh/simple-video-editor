import { describe, expect, it } from "vitest";
import type { Beat, Cut } from "../../domain/types";
import {
  analyzeStorySpine,
  applyRegionRewrite,
  applyStorySpine,
  buildStorySpinePrompt,
  generateStorySpine,
  parseStorySpine,
} from "./storySpine";

const beat = (id: string, scriptText: string, storyPurpose?: Beat["storyPurpose"]): Beat => ({
  id,
  clipId: `clip-${id}`,
  inSec: 0,
  outSec: 3,
  durationSec: 3,
  scriptText,
  captionText: scriptText,
  storyPurpose,
});

const input = {
  brief: { audience: "new runners", goal: "saves" as const, promise: "a steadier mile", evidence: "GPS split", callToAction: "save this" },
  logline: "Fix the first mile.",
  beats: [
    { beatId: "a", scriptText: "You start too fast.", subjectAction: "Runner checks watch", settingMood: "Focused", storyPurpose: "hook" as const },
    { beatId: "b", scriptText: "Use this split.", subjectAction: "Watch shows split", settingMood: "Clear", storyPurpose: "proof" as const },
  ],
};

describe("Story Spine", () => {
  it("defines purpose as editorial structure without permitting Cut changes", () => {
    const prompt = buildStorySpinePrompt(input);
    expect(prompt).toContain("Allowed purposes: hook, problem, proof, payoff, cta");
    expect(prompt).toContain("Do not add, remove, merge, rewrite, or reorder Beats");
  });

  it("parses every Beat once in original order", () => {
    const assignments = parseStorySpine('{"purposes":[{"beatId":"b","purpose":"proof"},{"beatId":"a","purpose":"hook"}]}', ["a", "b"]);
    expect(assignments).toEqual([{ beatId: "a", purpose: "hook" }, { beatId: "b", purpose: "proof" }]);
    expect(() => parseStorySpine('{"purposes":[{"beatId":"a","purpose":"hook"}]}', ["a", "b"])).toThrow("1 of 2");
  });

  it("repairs malformed Writer output once", async () => {
    const calls: string[] = [];
    const assignments = await generateStorySpine(input, {}, async (prompt) => {
      calls.push(prompt);
      return calls.length === 1
        ? "I cannot format that."
        : '{"purposes":[{"beatId":"a","purpose":"hook"},{"beatId":"b","purpose":"proof"}]}';
    });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain("Repair the following invalid Story Spine response");
    expect(assignments).toHaveLength(2);
  });

  it("applies assignments without touching Beat order or Script", () => {
    const cut: Cut = { aspect: "9:16", beats: [beat("a", "A"), beat("b", "B")] };
    const applied = applyStorySpine(cut, [{ beatId: "a", purpose: "hook" }, { beatId: "b", purpose: "proof" }]);
    expect(applied.beats.map((item) => [item.id, item.scriptText, item.storyPurpose])).toEqual([
      ["a", "A", "hook"], ["b", "B", "proof"],
    ]);
  });

  it("reports explainable structural gaps without a score", () => {
    const issues = analyzeStorySpine([beat("a", "A", "problem"), beat("b", "B", "payoff"), beat("c", "C", "proof")]);
    expect(issues.map((issue) => issue.code)).toEqual(["missing-hook", "missing-cta", "late-proof"]);
  });

  it("rewrites only target Beats and matching seeded VO text", () => {
    const cut: Cut = {
      aspect: "9:16",
      beats: [beat("a", "Hook", "hook"), beat("b", "Old proof", "proof"), beat("c", "CTA", "cta")],
      voSegments: [
        { id: "a-vo", text: "Hook", startTimeSec: 0, durationSec: 3, captionVisible: true },
        { id: "b-vo", text: "Old proof", startTimeSec: 3, durationSec: 3, captionVisible: true },
        { id: "manual", text: "Manual", startTimeSec: 3, durationSec: 1, captionVisible: true },
      ],
    };
    const applied = applyRegionRewrite(cut, undefined, [{ beatId: "b", scriptText: "Visible proof" }]);
    expect(applied.cut.beats.map((item) => item.scriptText)).toEqual(["Hook", "Visible proof", "CTA"]);
    expect(applied.cut.voSegments?.map((item) => item.text)).toEqual(["Hook", "Visible proof", "Manual"]);
    expect(applied.cut.beats[0]).toBe(cut.beats[0]);
  });
});
