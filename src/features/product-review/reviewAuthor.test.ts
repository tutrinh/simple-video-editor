import { describe, expect, it } from "vitest";
import type { GenerateReviewPlanInput } from "./reviewAuthor";
import { generateReviewPlan } from "./reviewAuthor";

const input = (over: Partial<GenerateReviewPlanInput> = {}): GenerateReviewPlanInput => ({
  brief: {
    source: { kind: "amazon", asin: "B0ABC12345" },
    title: "Trail Press",
    features: [{ id: "claim-1", text: "Stainless steel body", source: "listing" }],
    priceText: "USD 39.95",
  },
  creatorNotes: {
    audience: "travel vloggers",
    problem: "weak hotel coffee",
    experience: "I used it on three train trips.",
    pros: ["compact"],
    cons: ["hand wash only"],
    verdict: "I would pack it again.",
    callToAction: "Save this for your next trip.",
    disclosure: "purchased",
  },
  clips: [{
    id: "clip-1",
    name: "press-demo.mp4",
    description: {
      subjectAction: "Hands press coffee at a train table",
      settingMood: "bright train carriage",
      usability: 5,
      model: "test",
      raw: "",
    },
  }],
  targetDurationSec: 30,
  tone: "conversational",
  includePrice: false,
  includeCta: true,
  ...over,
});

const validAiJson = JSON.stringify({
  hook: "Hotel coffee is optional now.",
  script: [{
    id: "script-1",
    text: "This stainless steel press replaces weak hotel coffee.",
    purpose: "hook",
    approxDurationSec: 4,
    evidence: [{ kind: "product-claim", claimId: "claim-1" }],
    shotId: "shot-1",
  }, {
    id: "script-2",
    text: "I used it on three train trips and would pack it again.",
    purpose: "verdict",
    approxDurationSec: 5,
    evidence: [
      { kind: "creator-note", field: "experience" },
      { kind: "creator-note", field: "verdict" },
    ],
    shotId: "shot-1",
  }],
  shots: [{
    id: "shot-1",
    description: "Press coffee at a train table",
    capture: "demo",
    framing: "close-up",
    approxDurationSec: 9,
    matchedClipId: "clip-1",
  }],
});

describe("generateReviewPlan", () => {
  it("returns a grounded, duration-constrained Review Plan from an AI adapter", async () => {
    const plan = await generateReviewPlan(input(), async () => `\`\`\`json\n${validAiJson}\n\`\`\``);

    expect(plan).toMatchObject({
      productTitle: "Trail Press",
      targetDurationSec: 30,
      hook: "Hotel coffee is optional now.",
      script: [
        expect.objectContaining({ id: "script-1", shotId: "shot-1" }),
        expect.objectContaining({ id: "script-2", shotId: "shot-1" }),
      ],
      shots: [expect.objectContaining({ id: "shot-1", matchedClipId: "clip-1" })],
    });
    expect(plan.script.flatMap((segment) => segment.evidence)).toHaveLength(3);
  });

  it("does not expose price to the author adapter unless the author confirms it", async () => {
    let prompt = "";
    await generateReviewPlan(input(), async (value) => {
      prompt = value;
      return validAiJson;
    });
    expect(prompt).not.toContain("39.95");

    await generateReviewPlan(input({ includePrice: true }), async (value) => {
      prompt = value;
      return validAiJson;
    });
    expect(prompt).toContain("USD 39.95");
  });

  it("rejects first-person claims backed by an empty Creator Notes field", async () => {
    const unsafe = JSON.stringify({
      ...JSON.parse(validAiJson),
      script: [{
        id: "unsafe",
        text: "I use this every single day.",
        purpose: "proof",
        approxDurationSec: 4,
        evidence: [{ kind: "creator-note", field: "experience" }],
        shotId: "shot-1",
      }],
    });
    const noExperience = input({
      creatorNotes: { ...input().creatorNotes, experience: "" },
    });

    await expect(generateReviewPlan(noExperience, async () => unsafe)).rejects.toThrow(/grounded script/i);
  });

  it("removes matched Clip ids that are not present in the Project", async () => {
    const raw = JSON.stringify({
      ...JSON.parse(validAiJson),
      shots: [{
        ...JSON.parse(validAiJson).shots[0],
        matchedClipId: "invented-clip",
      }],
    });
    const plan = await generateReviewPlan(input(), async () => raw);
    expect(plan.shots[0].matchedClipId).toBeUndefined();
  });

  it("makes one repair attempt for malformed output and then validates the repair", async () => {
    const prompts: string[] = [];
    const plan = await generateReviewPlan(input(), async (prompt) => {
      prompts.push(prompt);
      return prompts.length === 1 ? "not json" : validAiJson;
    });
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("Repair");
    expect(plan.script).toHaveLength(2);
  });

  it("rejects output after the single repair attempt is exhausted", async () => {
    let calls = 0;
    await expect(generateReviewPlan(input(), async () => {
      calls++;
      return "{}";
    })).rejects.toThrow(/review plan/i);
    expect(calls).toBe(2);
  });
});
