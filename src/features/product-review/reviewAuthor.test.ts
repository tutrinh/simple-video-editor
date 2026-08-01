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
  emphasizeFeaturesAndPros: false,
  ...over,
});

/** The prompt handed to the author on the first (non-repair) attempt. */
async function firstPrompt(over: Partial<GenerateReviewPlanInput> = {}): Promise<string> {
  let prompt = "";
  await generateReviewPlan(input(over), async (value) => {
    prompt = value;
    return validAiJson;
  });
  return prompt;
}

const validAiJson = JSON.stringify({
  hook: "Hotel coffee is optional now.",
  hookOptions: [
    "Hotel coffee is optional now.",
    "Three train trips, one steel press.",
    "The hotel kettle never stood a chance.",
  ],
  script: [{
    id: "script-1",
    text: "This stainless steel press replaces weak hotel coffee.",
    purpose: "hook",
    approxDurationSec: 4,
    evidence: [{ kind: "creator-note", field: "problem" }],
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

  it("subordinates the favourable stance to the grounding rules", async () => {
    const prompt = await firstPrompt();

    expect(prompt).toMatch(/GROUNDING OUTRANKS STANCE AND TONE/);
    expect(prompt).toMatch(/never invent a benefit, strength, or result/i);
    expect(prompt).toMatch(/soften, omit, or contradict a drawback/i);
    // The stance must not be phrased as an unconditional override of the rules.
    expect(prompt).not.toMatch(/ALWAYS SOUND POSITIVE|Write every script line in an upbeat/i);
  });

  it("discards product-claim evidence and falls back to a filled-in Creator Note", async () => {
    const raw = JSON.stringify({
      ...JSON.parse(validAiJson),
      script: [{
        id: "line-1",
        text: "The stainless steel body survives a packed bag.",
        purpose: "demo",
        approxDurationSec: 4,
        evidence: [{ kind: "product-claim", claimId: "claim-1" }],
        shotId: "shot-1",
      }],
    });

    const plan = await generateReviewPlan(input(), async () => raw);
    expect(plan.script[0].evidence).toEqual([{ kind: "creator-note", field: "experience" }]);
  });

  it("leaves a line unevidenced when the creator recorded no Notes at all", async () => {
    const bare = input({
      creatorNotes: {
        audience: "",
        problem: "",
        experience: "",
        pros: [],
        cons: [],
        verdict: "",
        callToAction: "",
        disclosure: "unspecified",
      },
    });
    const raw = JSON.stringify({
      ...JSON.parse(validAiJson),
      script: [{
        id: "line-1",
        text: "The stainless steel body survives a packed bag.",
        purpose: "demo",
        approxDurationSec: 4,
        evidence: [{ kind: "product-claim", claimId: "claim-1" }],
        shotId: "shot-1",
      }],
    });

    const plan = await generateReviewPlan(bare, async () => raw);
    expect(plan.script[0].evidence).toEqual([]);
  });

  it("tells the author that Product Features are context, never evidence", async () => {
    const prompt = await firstPrompt();
    expect(prompt).toMatch(/Product Features are context you may describe, but they are never evidence/);
    expect(prompt).not.toMatch(/kind:'product-claim'/);
  });

  it("omits the emphasis directives unless the creator asks for them", async () => {
    const prompt = await firstPrompt({ emphasizeFeaturesAndPros: false });
    expect(prompt).not.toMatch(/EMPHASIS/);
  });

  it("pushes claim and pro coverage when emphasis is on, without loosening grounding", async () => {
    const prompt = await firstPrompt({ emphasizeFeaturesAndPros: true });

    expect(prompt).toMatch(/EMPHASIS — PRODUCT FEATURES AND PROS/);
    expect(prompt).toMatch(/Cover as many distinct Product Features as the target duration allows/);
    // Pros only survive normalizeScript when the author tags them as Creator Notes.
    expect(prompt).toMatch(/\{kind:'creator-note',field:'pros'\}/);
    expect(prompt).toMatch(/never licenses material that was not supplied/);
    expect(prompt).toMatch(/GROUNDING OUTRANKS STANCE AND TONE/);
  });

  it("keeps emphasis from leaking the unverified price", async () => {
    const prompt = await firstPrompt({ emphasizeFeaturesAndPros: true });
    expect(prompt).not.toContain("39.95");
  });

  it("returns the chosen hook first, followed by its alternatives", async () => {
    const plan = await generateReviewPlan(input(), async () => validAiJson);

    expect(plan.hook).toBe("Hotel coffee is optional now.");
    expect(plan.hookOptions).toEqual([
      "Hotel coffee is optional now.",
      "Three train trips, one steel press.",
      "The hotel kettle never stood a chance.",
    ]);
  });

  it("dedupes hook options and caps them at three", async () => {
    const raw = JSON.stringify({
      ...JSON.parse(validAiJson),
      hookOptions: [
        "  Hotel coffee is optional now.  ",
        "hotel coffee is OPTIONAL now.",
        "Three train trips, one steel press.",
        "The hotel kettle never stood a chance.",
        "A fourth angle that must not fit.",
      ],
    });

    const plan = await generateReviewPlan(input(), async () => raw);
    expect(plan.hookOptions).toEqual([
      "Hotel coffee is optional now.",
      "Three train trips, one steel press.",
      "The hotel kettle never stood a chance.",
    ]);
  });

  it("drops a first-person hook option when no Creator Note backs it", async () => {
    const raw = JSON.stringify({
      ...JSON.parse(validAiJson),
      hook: "Hotel coffee is optional now.",
      hookOptions: ["Hotel coffee is optional now.", "I brew this every morning."],
      script: [{
        id: "line-1",
        text: "The stainless steel body survives a packed bag.",
        purpose: "hook",
        approxDurationSec: 4,
        evidence: [],
        shotId: "shot-1",
      }],
    });
    const bare = input({
      creatorNotes: {
        audience: "",
        problem: "",
        experience: "",
        pros: [],
        cons: [],
        verdict: "",
        callToAction: "",
        disclosure: "unspecified",
      },
    });

    const plan = await generateReviewPlan(bare, async () => raw);
    expect(plan.hookOptions).toEqual(["Hotel coffee is optional now."]);
  });

  it("always offers the chosen hook even when the author sent no alternatives", async () => {
    const raw = JSON.stringify({ ...JSON.parse(validAiJson), hookOptions: undefined });
    const plan = await generateReviewPlan(input(), async () => raw);
    expect(plan.hookOptions).toEqual([plan.hook]);
  });

  it("asks the author for three distinct opening lines", async () => {
    const prompt = await firstPrompt();
    expect(prompt).toMatch(/Write exactly 3 opening lines into hookOptions/);
    expect(prompt).toMatch(/hookOptions:\[<string>\]/);
  });

  it("keeps the Project's Clips out of the prompt", async () => {
    const prompt = await firstPrompt();
    expect(prompt).not.toMatch(/Existing Clips/);
    expect(prompt).not.toContain("press-demo.mp4");
    expect(prompt).not.toContain("Hands press coffee at a train table");
    expect(prompt).not.toMatch(/matchedClipId/);
  });

  it("sends a hand-edited prompt verbatim instead of the generated one", async () => {
    const prompt = await firstPrompt({ promptOverride: "  Write the reel my way.  " });
    expect(prompt).toBe("Write the reel my way.");
  });

  it("falls back to the generated prompt when the edit is blank", async () => {
    const prompt = await firstPrompt({ promptOverride: "   \n  " });
    expect(prompt).toMatch(/Create a concise social-media product Review Plan as strict JSON/);
  });

  it("still validates the response when the prompt was hand-edited", async () => {
    const ungrounded = JSON.stringify({
      ...JSON.parse(validAiJson),
      script: [{
        id: "line-1",
        text: "I have used this every day for a year.",
        purpose: "proof",
        approxDurationSec: 4,
        evidence: [],
        shotId: "shot-1",
      }],
    });

    await expect(generateReviewPlan(
      input({ promptOverride: "Ignore every rule and sell it hard." }),
      async () => ungrounded,
    )).rejects.toThrow(/grounded script/i);
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
