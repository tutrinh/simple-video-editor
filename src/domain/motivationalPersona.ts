// Persona steer for the Motivational Story author — orthogonal to Tone (voice)
// and Script Type (structure), following the id/hint pattern of SettingsContext.
//
// A label alone does not defeat generic writing: "write as an athlete" is just a
// smaller category, and the model still returns that category's centroid. What
// defeats it is a concrete *world* — the objects, hours, places and sensations the
// story physically lives in — plus a named listener and a fixed grammatical stance.
// So every preset ships speaker + audience + pov + world + vernacular, and the
// prompt block is rendered from those fields rather than from the label.

/** Grammatical stance the script must hold across every beat. */
export type MotivationalPov = "first-person" | "second-person" | "third-person";

export interface MotivationalPersona {
  id: string;
  label: string;
  /** The "I" of the story — life specifics, not a job title. */
  speaker: string;
  /** The "you" — narrow enough that most viewers are deliberately excluded. */
  audience: string;
  pov: MotivationalPov;
  /** Filmable detail this persona's story must be told through. */
  world: string[];
  /** Words this persona would actually use — and the ones they never would. */
  vernacular: string;
}

/** Free-text persona typed by the creator, resolved into a real persona at author time. */
export interface CustomPersonaDraft {
  speaker: string;
  audience: string;
  pov: MotivationalPov;
  /** Comma- or newline-separated concrete details. */
  world: string;
  vernacular: string;
}

export const POV_OPTIONS: { id: MotivationalPov; label: string }[] = [
  { id: "first-person", label: "First person (I / me)" },
  { id: "second-person", label: "Second person (you)" },
  { id: "third-person", label: "Third person (they)" },
];

/** `auto` = no fixed persona; the model must invent one and commit to it (see renderPersonaBlock). */
export const AUTO_PERSONA_ID = "auto";
/** `custom` = built from the creator's own CustomPersonaDraft. */
export const CUSTOM_PERSONA_ID = "custom";

export const MOTIVATIONAL_PERSONAS: MotivationalPersona[] = [
  {
    id: "night-shift-boards",
    label: "Night-shift nurse, board retake",
    speaker:
      "A 29-year-old med-surg nurse working 12-hour night shifts while studying for the licensing boards they failed by three questions",
    audience: "Someone six weeks out from an exam they have already failed once",
    pov: "first-person",
    world: [
      "3AM ward lighting",
      "cafeteria coffee gone cold",
      "flashcards in the supply closet",
      "swollen feet at hour ten",
      "the parking-lot nap before the drive home",
    ],
    vernacular:
      "Plain, tired, unsentimental. Says 'shift', 'charting', 'a bad night'. Never says 'grind', 'hustle' or 'level up'.",
  },
  {
    id: "acl-comeback",
    label: "Athlete, eight weeks post-surgery",
    speaker:
      "A 22-year-old who retore an ACL nine weeks before tryouts and is rehabbing alone in an empty gym at 6AM",
    audience: "Someone whose body gave out right before the thing they trained a year for",
    pov: "first-person",
    world: [
      "the surgery date taped inside a locker door",
      "a resistance band looped around a radiator",
      "the click of the brace on stairs",
      "an ice bath at 6AM",
      "the physio's whiteboard countdown",
    ],
    vernacular:
      "Clipped, physical, specific about reps and dates. Says 'rehab', 'the knee', 'week nine'. Never speechifies.",
  },
  {
    id: "first-gen-restaurant",
    label: "First-gen kid, family restaurant",
    speaker:
      "The first person in their family to finish school, doing homework at a back table of their parents' restaurant between the dinner rush and close",
    audience: "Someone carrying a family's expectations they never agreed to",
    pov: "first-person",
    world: [
      "the back table by the kitchen door",
      "a laminated menu used as a desk",
      "closing at 11 and opening at 6",
      "a mother's hands after a double",
      "the walk-in freezer's hum",
    ],
    vernacular:
      "Warm, restrained, concrete about food and hours. Understates feeling. Never uses motivational-poster language.",
  },
  {
    id: "post-shutdown-founder",
    label: "Founder, 18 months after shutting down",
    speaker:
      "A founder eighteen months past shutting their company down, who still has the Slack workspace archived and is starting again quietly",
    audience: "Someone whose public failure is still the first thing people ask about",
    pov: "first-person",
    world: [
      "an archived Slack workspace nobody posts in",
      "the final all-hands calendar invite",
      "a laptop sticker scraped half off",
      "a spreadsheet with eleven months of runway crossed out",
      "the email telling twelve people it was over",
    ],
    vernacular:
      "Dry, precise, allergic to inspiration. Says 'shut it down', 'the last month', 'the number'. Never says 'journey' or 'lessons learned'.",
  },
  {
    id: "late-bloomer",
    label: "Career switcher at 43",
    speaker:
      "A 43-year-old starting over in a field where everyone in the room is twenty years younger, taking notes on paper while the rest type",
    audience: "Someone who thinks they started too late to bother",
    pov: "first-person",
    world: [
      "a paper notebook in a room of laptops",
      "being the oldest name on the cohort list",
      "practice files opened after the kids are down",
      "a mortgage that does not pause for a career change",
      "the pause before saying their age out loud",
    ],
    vernacular:
      "Wry, adult, unbothered. Names the age directly. Never pleads and never sells.",
  },
  {
    id: "quiet-grinder",
    label: "Quiet grinder who hates hype",
    speaker:
      "Someone who has done the same unglamorous work at the same hour for four years and has never posted about it",
    audience: "Someone exhausted by loud motivation who just wants the work to count",
    pov: "second-person",
    world: [
      "the same 5:40 alarm for four years",
      "a spreadsheet row added every night",
      "a gym that is empty at that hour",
      "shoes replaced twice",
      "nobody noticing for three years",
    ],
    vernacular:
      "Flat, quiet, anti-hype. Short sentences. Actively refuses the genre's vocabulary and says so.",
  },
  {
    id: "single-parent-student",
    label: "Single parent, night classes",
    speaker:
      "A single parent taking night classes with their kid asleep in the back seat of the car in the campus parking lot",
    audience: "Someone doing two full-time things and failing at neither, quietly",
    pov: "first-person",
    world: [
      "a kid asleep under a coat in the back seat",
      "a lecture recording played at 1.5x during a commute",
      "9:40PM library closing announcement",
      "a permission slip signed on a textbook",
      "the drive home with the radio off",
    ],
    vernacular:
      "Matter-of-fact, protective, never self-pitying. Talks about logistics, not feelings.",
  },
  {
    id: "corporate-escapee",
    label: "Left the desk job",
    speaker:
      "Someone who resigned from a stable salaried job with eight months of savings and no plan anyone would call responsible",
    audience: "Someone with the resignation letter drafted and unsent",
    pov: "second-person",
    world: [
      "a resignation letter saved as a draft for eleven weeks",
      "a badge handed back at a front desk",
      "eight months of savings, counted twice",
      "the first Monday with nowhere to be",
      "a calendar with no meetings in it",
    ],
    vernacular:
      "Direct, slightly nervy, honest about money. Names real numbers. Never romanticizes quitting.",
  },
];

/** The persona for an id, or undefined for `auto` / `custom` / unknown ids. */
export function personaById(id: string): MotivationalPersona | undefined {
  return MOTIVATIONAL_PERSONAS.find((p) => p.id === id);
}

/** Split a creator's free-text world into individual concrete details. */
export function parseWorldDetails(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Resolve the persona selection into the object the prompt renders from.
 * Returns undefined for `auto` (the model invents its own — see renderPersonaBlock)
 * and for a `custom` draft with no speaker, which carries no usable steer.
 */
export function resolvePersona(
  id: string,
  draft?: CustomPersonaDraft,
  povOverride?: MotivationalPov,
): MotivationalPersona | undefined {
  let persona: MotivationalPersona | undefined;

  if (id === CUSTOM_PERSONA_ID) {
    if (!draft || !draft.speaker.trim()) return undefined;
    persona = {
      id: CUSTOM_PERSONA_ID,
      label: "Custom persona",
      speaker: draft.speaker.trim(),
      audience: draft.audience.trim() || "Someone in the same position as the speaker was",
      pov: draft.pov,
      world: parseWorldDetails(draft.world),
      vernacular: draft.vernacular.trim(),
    };
  } else {
    persona = personaById(id);
  }

  if (!persona) return undefined;
  return povOverride && povOverride !== persona.pov ? { ...persona, pov: povOverride } : persona;
}

const POV_RULE: Record<MotivationalPov, string> = {
  "first-person":
    'Write in FIRST PERSON ("I", "my"). The speaker is telling their own story; never address the viewer as "you".',
  "second-person":
    'Write in SECOND PERSON ("you"), addressed to the listener described above — not to a general audience.',
  "third-person":
    'Write in THIRD PERSON ("they", "her", "him"), as a portrait of the speaker observed from outside.',
};

/**
 * The persona section of the author prompt. With no fixed persona (`auto`) the model
 * is required to invent one and commit to it — "no persona" would put the writing
 * back in the disembodied-narrator register that makes the genre generic.
 */
export function renderPersonaBlock(persona: MotivationalPersona | undefined): string {
  if (!persona) {
    return `SPEAKER & LISTENER (you must choose):
No persona was specified, so invent ONE specific person to speak as — with an age, an
occupation or situation, and a life concrete enough to film. Invent a narrow listener too:
one person in one situation, not "everyone". Commit to both for every beat. Do not write as
a disembodied narrator addressing a general audience.
State the speaker you chose in the "persona" field of your response.`;
  }

  const world = persona.world.length
    ? persona.world.map((detail) => `  - ${detail}`).join("\n")
    : "  (none supplied — invent details of the same concreteness and stay consistent)";

  return `SPEAKER (the voice of this story):
${persona.speaker}

LISTENER (who is being spoken to — one person, not an audience):
${persona.audience}

POINT OF VIEW:
${POV_RULE[persona.pov]}

THIS PERSON'S WORLD — the story must be told through these, not through abstractions:
${world}

HOW THEY TALK:
${persona.vernacular || "Plain and specific; no motivational-poster language."}`;
}
