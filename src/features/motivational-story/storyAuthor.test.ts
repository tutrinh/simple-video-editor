import { describe, expect, it } from "vitest";
import type { Clip } from "../../domain/types";
import type { MotivationalStoryPlan } from "../../domain/motivationalStory";
import { personaById, resolvePersona } from "../../domain/motivationalPersona";
import {
  ABSTRACT_NOUNS,
  authorMotivationalPrompt,
  BANNED_MOTIVATIONAL_PHRASES,
  DEFAULT_MOTIVATIONAL_PROMPT,
  findGenericScriptLines,
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

describe("anti-generic prompt contract", () => {
  const basePrompt = () =>
    authorMotivationalPrompt({ prompt: "A gym comeback", targetDurationSec: 30 }, mockClips);

  it("requires one incident rather than a montage of lessons", () => {
    const prompt = basePrompt();
    expect(prompt).toMatch(/ONE INCIDENT, NOT A MONTAGE/);
    expect(prompt).toMatch(/Do not summarize a year/i);
    expect(prompt).toContain('"incident"');
  });

  it("states the specificity contract and asks the model to name the detail", () => {
    const prompt = basePrompt();
    expect(prompt).toMatch(/EVERY LINE CARRIES A FILMABLE DETAIL/);
    expect(prompt).toContain('"concreteDetail"');
    for (const noun of ABSTRACT_NOUNS) {
      expect(prompt).toContain(noun);
    }
  });

  it("bans the genre's stock phrases", () => {
    const prompt = basePrompt();
    for (const phrase of BANNED_MOTIVATIONAL_PHRASES) {
      expect(prompt).toContain(phrase);
    }
  });

  it("grounds shots in the actual footage and allows honest empty slots", () => {
    const prompt = basePrompt();
    expect(prompt).toMatch(/WRITE FROM THE FOOTAGE/);
    expect(prompt).toMatch(/do not contradict what is actually shown/i);
    expect(prompt).toMatch(/OMIT "matchedClipId"/);
  });

  it("drops the old viral/electrifying framing", () => {
    const prompt = basePrompt();
    expect(prompt).not.toMatch(/viral/i);
    expect(prompt).not.toMatch(/electrifying/i);
  });

  it("embeds a selected persona's speaker, listener, world and pov", () => {
    const persona = personaById("night-shift-boards");
    const prompt = authorMotivationalPrompt(
      { prompt: "Boards retake", targetDurationSec: 30, persona },
      mockClips
    );
    expect(prompt).toContain("med-surg nurse");
    expect(prompt).toContain("3AM ward lighting");
    expect(prompt).toContain("FIRST PERSON");
    expect(prompt).toMatch(/LISTENER/);
  });

  it("honours a pov override on a preset persona", () => {
    const persona = resolvePersona("night-shift-boards", undefined, "second-person");
    const prompt = authorMotivationalPrompt(
      { prompt: "Boards retake", targetDurationSec: 30, persona },
      mockClips
    );
    expect(prompt).toContain("SECOND PERSON");
    expect(prompt).not.toContain("FIRST PERSON");
  });

  it("makes the model invent a persona when none is selected", () => {
    const prompt = basePrompt();
    expect(prompt).toMatch(/invent ONE specific person/i);
    expect(prompt).toContain('"persona"');
  });
});

describe("plan parsing of persona fields", () => {
  const raw = JSON.stringify({
    title: "The Tape On My Locker",
    persona: "A 22-year-old rehabbing a retorn ACL",
    incident: "The first morning back in the empty 6AM gym",
    hook: "The surgery date is on a strip of tape inside my locker.",
    beats: [
      {
        purpose: "hook",
        scriptText: "The surgery date is on a strip of tape inside my locker.",
        concreteDetail: "strip of tape with the surgery date",
        approxDurationSec: 4,
        shotDescription: "Locker door swinging open",
        capture: "Close Up",
        framing: "closeup",
        matchedClipId: "c1",
      },
    ],
  });

  it("keeps persona, incident and per-line concreteDetail", () => {
    const plan = parseMotivationalStoryPlanJson(
      raw,
      { prompt: "ACL comeback", targetDurationSec: 30 },
      mockClips
    );
    expect(plan.persona).toBe("A 22-year-old rehabbing a retorn ACL");
    expect(plan.incident).toBe("The first morning back in the empty 6AM gym");
    expect(plan.script[0].concreteDetail).toBe("strip of tape with the surgery date");
  });

  it("coerces near-miss enum values instead of passing them through", () => {
    const plan = parseMotivationalStoryPlanJson(
      raw,
      { prompt: "ACL comeback", targetDurationSec: 30 },
      mockClips
    );
    // "Close Up" is not a capture value at all; "closeup" is a framing near-miss.
    expect(plan.shots[0].capture).toBe("action");
    expect(plan.shots[0].framing).toBe("close-up");
  });

  it("falls back to the selected persona's speaker when the model omits the field", () => {
    const plan = parseMotivationalStoryPlanJson(
      JSON.stringify({ title: "T", hook: "H", beats: [{ scriptText: "x", shotDescription: "y" }] }),
      {
        prompt: "p",
        targetDurationSec: 30,
        persona: personaById("acl-comeback"),
      },
      mockClips
    );
    expect(plan.persona).toMatch(/retore an ACL/);
  });

  it("leaves a shot unmatched when the model omits matchedClipId", () => {
    const plan = parseMotivationalStoryPlanJson(
      JSON.stringify({
        title: "T",
        hook: "H",
        beats: [
          { scriptText: "line one", shotDescription: "a shot nothing on hand fits" },
          { scriptText: "line two", shotDescription: "another", matchedClipId: "c2" },
        ],
      }),
      { prompt: "p", targetDurationSec: 30 },
      mockClips
    );
    // Previously beat 1 was silently assigned clips[0] by position.
    expect(plan.shots[0].matchedClipId).toBeUndefined();
    expect(plan.shots[1].matchedClipId).toBe("c2");
  });
});

describe("findGenericScriptLines", () => {
  function planWith(lines: { text: string; concreteDetail?: string }[]): MotivationalStoryPlan {
    return {
      id: "p",
      title: "t",
      prompt: "p",
      targetDurationSec: 30,
      hook: "h",
      createdAt: 0,
      shots: [],
      script: lines.map((l, i) => ({
        id: `l${i}`,
        text: l.text,
        purpose: "action" as const,
        approxDurationSec: 3,
        shotId: `s${i}`,
        concreteDetail: l.concreteDetail,
      })),
    };
  }

  it("flags a banned stock phrase", () => {
    const flags = findGenericScriptLines(planWith([{ text: "They said I couldn't do it." }]));
    expect(flags).toEqual([{ lineId: "l0", reason: "banned-phrase" }]);
  });

  it("flags an abstraction-only line with no concrete anchor", () => {
    const flags = findGenericScriptLines(planWith([{ text: "Discipline beats motivation." }]));
    expect(flags[0]?.reason).toBe("no-concrete-detail");
  });

  it("passes a line anchored by a number", () => {
    expect(findGenericScriptLines(planWith([{ text: "Week nine, and the brace still clicks." }]))).toEqual([]);
  });

  it("passes an abstract-sounding line that names a concrete detail", () => {
    const flags = findGenericScriptLines(
      planWith([{ text: "Discipline is quieter than that.", concreteDetail: "the 5:40 alarm" }])
    );
    expect(flags).toEqual([]);
  });

  it("ignores empty lines", () => {
    expect(findGenericScriptLines(planWith([{ text: "   " }]))).toEqual([]);
  });
});
