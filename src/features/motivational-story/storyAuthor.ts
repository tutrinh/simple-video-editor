import type { Clip } from "../../domain/types";
import type {
  GenerateMotivationalStoryInput,
  MotivationalScriptLine,
  MotivationalShot,
  MotivationalStoryPlan,
} from "../../domain/motivationalStory";

export const DEFAULT_MOTIVATIONAL_PROMPT =
  "Create a short, powerful motivational story for a Reel about overcoming doubt, building discipline, and achieving greatness.";

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

  return `You are an expert short-form video director and motivational storyteller creating a viral ${input.targetDurationSec}s Reel script and shot list.

USER REQUEST:
"${promptText}"

TARGET DURATION: ~${input.targetDurationSec} seconds.
TONE / VOICE: ${input.tone || "Inspiring & Bold"}
FORMAT: ${input.scriptType || "Motivational reel"}
${input.creatorNotes ? `CREATOR NOTES:\n${input.creatorNotes}\n` : ""}

AVAILABLE MEDIA CLIPS:
${clipSummary}

INSTRUCTIONS:
1. Craft a high-impact motivational narrative broken into 4-6 distinct visual beats.
2. Narrative Arc:
   - "hook": Electrifying opening line that grabs attention in < 3 seconds.
   - "struggle": Acknowledge the barrier, doubt, or sacrifice.
   - "shift": Mindset shift / decision point.
   - "action": Relentless execution & building momentum.
   - "climax": Peak emotional breakthrough.
   - "takeaway": Final inspiring call to action or memorable closing statement.
3. For each beat, pair exactly ONE Script line with ONE Shot description.
4. If an available media clip matches a shot description, set "matchedClipId" to that clipId. Otherwise omit "matchedClipId".

Return ONLY valid JSON matching this schema (no markdown fences or commentary):
{
  "title": "A short 3-5 word title for this story",
  "hook": "Electrifying hook line",
  "beats": [
    {
      "id": "beat-1",
      "purpose": "hook",
      "scriptText": "Spoken narration text for beat 1",
      "approxDurationSec": 5,
      "shotDescription": "Cinematic visual description for shot 1",
      "capture": "action",
      "framing": "close-up",
      "matchedClipId": "clip-1"
    }
  ]
}`;
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
    hook?: string;
    beats?: Array<{
      id?: string;
      purpose?: string;
      scriptText?: string;
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

    let matchedClipId: string | undefined = undefined;
    if (b.matchedClipId && clips.some((c) => c.id === b.matchedClipId) && !usedClipIds.has(b.matchedClipId)) {
      matchedClipId = b.matchedClipId;
      usedClipIds.add(matchedClipId);
    } else if (clips[i] && !usedClipIds.has(clips[i].id)) {
      matchedClipId = clips[i].id;
      usedClipIds.add(matchedClipId);
    }

    const dur = typeof b.approxDurationSec === "number" && b.approxDurationSec > 0
      ? Math.round(b.approxDurationSec * 10) / 10
      : 5;

    const captureVal = (b.capture as MotivationalShot["capture"]) || "action";
    const framingVal = (b.framing as MotivationalShot["framing"]) || "close-up";
    const purposeVal = (b.purpose as MotivationalScriptLine["purpose"]) || (i === 0 ? "hook" : "action");

    shots.push({
      id: shotId,
      description: b.shotDescription?.trim() || `Motivational visual for beat ${i + 1}`,
      capture: captureVal,
      framing: framingVal,
      approxDurationSec: dur,
      matchedClipId,
    });

    script.push({
      id: lineId,
      text: b.scriptText?.trim() || (i === 0 ? hook : "Push past your limits today."),
      purpose: purposeVal,
      approxDurationSec: dur,
      shotId,
    });
  }

  // Fallback if AI returned 0 beats
  if (shots.length === 0) {
    const sId = genId("shot");
    shots.push({
      id: sId,
      description: "Close-up of determination and focus",
      capture: "close-up" as unknown as MotivationalShot["capture"],
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
