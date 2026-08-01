import type { Clip } from "../../domain/types";
import { renderPersonaBlock } from "../../domain/motivationalPersona";
import type {
  GenerateMotivationalStoryInput,
  MotivationalScriptLine,
  MotivationalShot,
  MotivationalStoryPlan,
} from "../../domain/motivationalStory";

// The old default ("overcoming doubt, building discipline, achieving greatness") was
// three abstractions and no noun you could photograph — it steered straight into the
// genre's centroid. The default now asks for one person and one incident instead.
export const DEFAULT_MOTIVATIONAL_PROMPT =
  "Tell one person's story about a single day they nearly quit and didn't — something specific enough to film.";

/**
 * Stock phrases of the motivational-reel genre. Banning them outright is cruder than
 * it looks but it works: they are the highest-probability continuations, so removing
 * them forces the model off the centroid and into the persona's actual world.
 */
export const BANNED_MOTIVATIONAL_PHRASES = [
  "they said I couldn't",
  "prove them wrong",
  "no excuses",
  "trust the process",
  "built different",
  "while you were sleeping",
  "rise and grind",
  "the grind never stops",
  "your only limit is you",
  "level up",
  "chase your dreams",
  "push past your limits",
  "one percent better",
  "nobody believed in me",
  "excuses or results",
  "success is a choice",
  "pain is temporary",
];

/** Abstraction-only lines are the failure mode the specificity contract tests for. */
export const ABSTRACT_NOUNS = [
  "doubt",
  "discipline",
  "greatness",
  "purpose",
  "mindset",
  "journey",
  "potential",
  "hustle",
  "grind",
  "destiny",
];

export type ReviewAuthorAdapter = (prompt: string, images?: string[]) => Promise<string>;

function genId(prefix: string): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function authorMotivationalPrompt(
  input: GenerateMotivationalStoryInput,
  clips: readonly Clip[],
): string {
  const promptText = input.prompt.trim() || DEFAULT_MOTIVATIONAL_PROMPT;
  const clipSummary = clips.length
    ? clips
        .map((clip) => {
          const tags = clip.tags?.length ? ` [tags: ${clip.tags.join(", ")}]` : "";
          const desc = clip.description?.subjectAction ? ` - "${clip.description.subjectAction}"` : "";
          return `- clipId: "${clip.id}", name: "${clip.name}", duration: ${clip.durationSec.toFixed(1)}s${tags}${desc}`;
        })
        .join("\n")
    : "(No uploaded clips available yet; plan assignable placeholders)";

  return `You are writing a ${input.targetDurationSec}-second short-form video: ONE person's specific story, told across 4-6 beats.

USER REQUEST:
"${promptText}"

${renderPersonaBlock(input.persona)}

TARGET DURATION: ~${input.targetDurationSec} seconds total. Beat durations must sum to roughly that.
TONE / VOICE: ${input.tone || "plain and grounded"}
FORMAT: ${input.scriptType || "Short-form motivational story"}
${input.creatorNotes ? `CREATOR NOTES:\n${input.creatorNotes}\n` : ""}
AVAILABLE MEDIA CLIPS:
${clipSummary}

HOW TO WRITE THIS — read all six rules before drafting:

1. ONE INCIDENT, NOT A MONTAGE.
   Pick a single incident from this person's life — one day, one decision, one ten-minute
   stretch — and tell THAT across every beat. Do not summarize a year and do not deliver a
   list of lessons. A reel about "discipline" is generic; a reel about one specific Tuesday
   in February cannot be. Name the incident you chose in the "incident" field.

2. EVERY LINE CARRIES A FILMABLE DETAIL.
   Each script line must contain at least one concrete thing — an object, a number, a time
   of day, a place, or a physical sensation — taken from this person's world. A line built
   only from abstractions (${ABSTRACT_NOUNS.join(", ")}) is a failed
   line: rewrite it before you return it. Name the detail you used in "concreteDetail".

3. NEVER USE THESE PHRASES, OR ANY VARIATION OF THEM:
   ${BANNED_MOTIVATIONAL_PHRASES.map((p) => `"${p}"`).join(", ")}.
   If a line you drafted could appear in any other motivational reel, it is wrong. Replace it
   with something only THIS person could say.

4. WRITE FROM THE FOOTAGE.
   Where a clip above fits a beat, use its name, tags and description as factual visual
   evidence and do not contradict what is actually shown — set "matchedClipId" to that clipId.
   Where nothing genuinely fits, OMIT "matchedClipId" and describe the shot that would need to
   be filmed; the editor gets a labelled empty slot for it. Never force a poor match: an
   honest empty slot is more useful than a clip that contradicts the line.

5. THE ARC. Assign each beat one "purpose", in this order, using 4-6 of them:
   - "hook": open INSIDE the incident, mid-action, on a concrete image. Not a thesis statement.
   - "struggle": the specific thing that made it hard — a cost, an hour, an obstacle with a name.
   - "shift": the exact moment the decision turned. One moment, not a realization about life.
   - "action": what was actually done, in specifics — reps, hours, dates, distances.
   - "climax": the concrete outcome or the hardest moment endured, shown not summarized.
   - "takeaway": what this person would say to the listener. Earned and small, not universal.

6. SAY IT ALOUD.
   These lines are spoken over video. Short sentences. Contractions. No line longer than a
   breath. Cut any word that would not survive being said out loud to one person.

Return ONLY valid JSON matching this schema (no markdown fences, no commentary):
{
  "title": "A short 3-5 word title, concrete not abstract",
  "persona": "One line naming who this is told as",
  "incident": "One line naming the single incident this reel tells",
  "hook": "The spoken opening line",
  "beats": [
    {
      "id": "beat-1",
      "purpose": "hook",
      "scriptText": "Spoken narration for beat 1",
      "concreteDetail": "The filmable detail this line is built on",
      "approxDurationSec": 5,
      "shotDescription": "What the camera sees",
      "capture": "action",
      "framing": "close-up",
      "matchedClipId": "clip-1"
    }
  ]
}`;
}

const CAPTURE_VALUES: MotivationalShot["capture"][] = [
  "action",
  "talking-head",
  "b-roll",
  "landscape",
  "demo",
  "abstract",
];
const FRAMING_VALUES: MotivationalShot["framing"][] = ["wide", "medium", "close-up"];
const PURPOSE_VALUES: MotivationalScriptLine["purpose"][] = [
  "hook",
  "struggle",
  "shift",
  "action",
  "climax",
  "takeaway",
];

// Models return near-misses for these enums ("closeup", "Close-Up", or a framing
// value in the capture slot), so coerce rather than cast — a bad value used to reach
// the Cut unchecked and break the shot-list UI's labelling.
function normalizeCapture(value: string | undefined): MotivationalShot["capture"] {
  const key = value?.trim().toLowerCase().replace(/[\s_]+/g, "-");
  return CAPTURE_VALUES.find((v) => v === key) ?? "action";
}

function normalizeFraming(value: string | undefined): MotivationalShot["framing"] {
  const key = value?.trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (key === "closeup") return "close-up";
  return FRAMING_VALUES.find((v) => v === key) ?? "close-up";
}

function normalizePurpose(value: string | undefined, index: number): MotivationalScriptLine["purpose"] {
  const key = value?.trim().toLowerCase();
  return PURPOSE_VALUES.find((v) => v === key) ?? (index === 0 ? "hook" : "action");
}

/**
 * The specificity contract, checked locally: a line fails if it carries no concrete
 * anchor (number, time, proper noun, or a named detail) or if it leans on a banned
 * stock phrase. Used to flag weak beats in the drawer before they reach the timeline
 * — advisory only, never blocking, since a short spoken line can be legitimately bare.
 */
export function findGenericScriptLines(
  plan: MotivationalStoryPlan,
): { lineId: string; reason: "banned-phrase" | "no-concrete-detail" }[] {
  const flags: { lineId: string; reason: "banned-phrase" | "no-concrete-detail" }[] = [];

  for (const line of plan.script) {
    const text = line.text.trim();
    if (!text) continue;
    const lower = text.toLowerCase();

    if (BANNED_MOTIVATIONAL_PHRASES.some((phrase) => lower.includes(phrase.toLowerCase()))) {
      flags.push({ lineId: line.id, reason: "banned-phrase" });
      continue;
    }

    const hasNumber = /\d/.test(text);
    const hasProperNoun = /(?!^)\b[A-Z][a-z]{2,}/.test(text);
    const hasNamedDetail = Boolean(line.concreteDetail?.trim());
    const abstractCount = ABSTRACT_NOUNS.filter((noun) =>
      new RegExp(`\\b${noun}\\b`, "i").test(lower)
    ).length;

    if (!hasNumber && !hasProperNoun && !hasNamedDetail && abstractCount > 0) {
      flags.push({ lineId: line.id, reason: "no-concrete-detail" });
    }
  }

  return flags;
}

export function parseMotivationalStoryPlanJson(
  jsonText: string,
  input: GenerateMotivationalStoryInput,
  clips: readonly Clip[],
): MotivationalStoryPlan {
  let cleaned = jsonText.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  }

  let parsed: {
    title?: string;
    persona?: string;
    incident?: string;
    hook?: string;
    beats?: Array<{
      id?: string;
      purpose?: string;
      scriptText?: string;
      concreteDetail?: string;
      approxDurationSec?: number;
      shotDescription?: string;
      capture?: string;
      framing?: string;
      matchedClipId?: string;
    }>;
  };

  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // If strict JSON parsing fails, extract raw JSON object
    const match = /\{[\s\S]*\}/.exec(cleaned);
    if (match) {
      parsed = JSON.parse(match[0]);
    } else {
      throw new Error("Could not parse AI response as valid JSON plan.");
    }
  }

  const title = parsed.title?.trim() || "Motivational Reel";
  const hook = parsed.hook?.trim() || "Keep going when everyone else quits.";
  const rawBeats = Array.isArray(parsed.beats) ? parsed.beats : [];

  const shots: MotivationalShot[] = [];
  const script: MotivationalScriptLine[] = [];

  const usedClipIds = new Set<string>();

  for (let i = 0; i < rawBeats.length; i++) {
    const b = rawBeats[i];
    const shotId = `motivational-shot-${i + 1}-${genId("s")}`;
    const lineId = `motivational-line-${i + 1}-${genId("l")}`;

    // Only honour an explicit match. The previous positional fallback (clips[i])
    // assigned footage by index whenever the model deliberately left matchedClipId
    // out, so "no clip fits this shot" silently became an arbitrary clip and the
    // labelled empty slot the shot list exists to surface never appeared.
    let matchedClipId: string | undefined = undefined;
    if (b.matchedClipId && clips.some((c) => c.id === b.matchedClipId) && !usedClipIds.has(b.matchedClipId)) {
      matchedClipId = b.matchedClipId;
      usedClipIds.add(matchedClipId);
    }

    const dur = typeof b.approxDurationSec === "number" && b.approxDurationSec > 0
      ? Math.round(b.approxDurationSec * 10) / 10
      : 5;

    shots.push({
      id: shotId,
      description: b.shotDescription?.trim() || `Motivational visual for beat ${i + 1}`,
      capture: normalizeCapture(b.capture),
      framing: normalizeFraming(b.framing),
      approxDurationSec: dur,
      matchedClipId,
    });

    script.push({
      id: lineId,
      text: b.scriptText?.trim() || (i === 0 ? hook : "Push past your limits today."),
      purpose: normalizePurpose(b.purpose, i),
      approxDurationSec: dur,
      shotId,
      concreteDetail: b.concreteDetail?.trim() || undefined,
    });
  }

  // Fallback if AI returned 0 beats
  if (shots.length === 0) {
    const sId = genId("shot");
    shots.push({
      id: sId,
      description: "Close-up of determination and focus",
      capture: "action",
      framing: "close-up",
      approxDurationSec: 5,
      matchedClipId: clips[0]?.id,
    });
    script.push({
      id: genId("line"),
      text: hook,
      purpose: "hook",
      approxDurationSec: 5,
      shotId: sId,
    });
  }

  return {
    id: genId("plan"),
    title,
    prompt: input.prompt.trim() || DEFAULT_MOTIVATIONAL_PROMPT,
    targetDurationSec: input.targetDurationSec,
    hook,
    createdAt: Date.now(),
    shots,
    script,
    persona: parsed.persona?.trim() || input.persona?.speaker,
    incident: parsed.incident?.trim() || undefined,
  };
}

export async function generateMotivationalStoryPlan(
  input: GenerateMotivationalStoryInput,
  clips: readonly Clip[],
  author: ReviewAuthorAdapter,
): Promise<MotivationalStoryPlan> {
  const prompt = authorMotivationalPrompt(input, clips);
  const rawText = await author(prompt);
  return parseMotivationalStoryPlanJson(rawText, input, clips);
}
