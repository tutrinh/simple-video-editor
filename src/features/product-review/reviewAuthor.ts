import type {
  CreatorNoteField,
  CreatorNotes,
  ProductBrief,
  ReviewClipSummary,
  ReviewDurationSec,
  ReviewEvidenceRef,
  ReviewPlan,
  ReviewPurpose,
  ReviewScriptSegment,
  ReviewShot,
  ReviewShotCapture,
  ReviewShotFraming,
} from "../../domain/productReview";

export interface GenerateReviewPlanInput {
  brief: ProductBrief;
  creatorNotes: CreatorNotes;
  clips: ReviewClipSummary[];
  targetDurationSec: ReviewDurationSec;
  tone: string;
  includePrice: boolean;
  includeCta: boolean;
}

export type ReviewAuthorAdapter = (prompt: string) => Promise<string>;

const PURPOSES = new Set<ReviewPurpose>(["hook", "problem", "demo", "proof", "verdict", "cta"]);
const CAPTURES = new Set<ReviewShotCapture>(["talking-head", "product-beauty", "detail", "demo", "result", "b-roll"]);
const FRAMINGS = new Set<ReviewShotFraming>(["wide", "medium", "close-up", "macro", "overhead", "screen"]);
const CREATOR_FIELDS = new Set<CreatorNoteField>([
  "audience",
  "problem",
  "experience",
  "pros",
  "cons",
  "verdict",
  "callToAction",
  "disclosure",
]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function seconds(value: unknown, fallback = 3): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? Math.max(0.5, Math.min(60, number)) : fallback;
}

function newId(prefix: string): string {
  const id = typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
  return `${prefix}-${id}`;
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const unfenced = raw.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI output did not contain a JSON object.");
  const parsed = JSON.parse(unfenced.slice(start, end + 1));
  const value = record(parsed);
  if (!value) throw new Error("AI output was not a Review Plan object.");
  return value;
}

function creatorNoteHasValue(notes: CreatorNotes, field: CreatorNoteField): boolean {
  const value = notes[field];
  if (Array.isArray(value)) return value.some((item) => item.trim().length > 0);
  if (field === "disclosure") return value !== "unspecified";
  return typeof value === "string" && value.trim().length > 0;
}

function validEvidence(
  value: unknown,
  input: GenerateReviewPlanInput,
): ReviewEvidenceRef | null {
  const item = record(value);
  if (!item) return null;
  if (item.kind === "product-claim") {
    const claimId = text(item.claimId);
    return input.brief.features.some((claim) => claim.id === claimId)
      ? { kind: "product-claim", claimId }
      : null;
  }
  if (item.kind === "creator-note") {
    const field = text(item.field) as CreatorNoteField;
    return CREATOR_FIELDS.has(field) && creatorNoteHasValue(input.creatorNotes, field)
      ? { kind: "creator-note", field }
      : null;
  }
  return null;
}

function normalizeShots(raw: unknown, input: GenerateReviewPlanInput): ReviewShot[] {
  if (!Array.isArray(raw)) return [];
  const clipIds = new Set(input.clips.map((clip) => clip.id));
  const seen = new Set<string>();
  const shots: ReviewShot[] = [];
  for (const value of raw) {
    const item = record(value);
    if (!item) continue;
    const description = text(item.description);
    const capture = text(item.capture) as ReviewShotCapture;
    const framing = text(item.framing) as ReviewShotFraming;
    if (!description || !CAPTURES.has(capture) || !FRAMINGS.has(framing)) continue;
    let id = text(item.id) || newId("shot");
    if (seen.has(id)) id = newId("shot");
    seen.add(id);
    const matchedClipId = text(item.matchedClipId);
    shots.push({
      id,
      description,
      capture,
      framing,
      approxDurationSec: seconds(item.approxDurationSec),
      ...(clipIds.has(matchedClipId) ? { matchedClipId } : {}),
    });
  }
  return shots;
}

function normalizeScript(
  raw: unknown,
  shots: ReviewShot[],
  input: GenerateReviewPlanInput,
): ReviewScriptSegment[] {
  if (!Array.isArray(raw)) return [];
  const shotIds = new Set(shots.map((shot) => shot.id));
  const seen = new Set<string>();
  const script: ReviewScriptSegment[] = [];
  for (const value of raw) {
    const item = record(value);
    if (!item) continue;
    const line = text(item.text);
    const purpose = text(item.purpose) as ReviewPurpose;
    const shotId = text(item.shotId);
    if (!line || !PURPOSES.has(purpose) || !shotIds.has(shotId)) continue;
    if (purpose === "cta" && !input.includeCta) continue;
    const evidence = Array.isArray(item.evidence)
      ? item.evidence.map((entry) => validEvidence(entry, input)).filter((entry): entry is ReviewEvidenceRef => entry !== null)
      : [];
    const firstPerson = /\b(?:i|i'm|i've|i'd|my|me|we|we've|our)\b/i.test(line);
    const hasCreatorEvidence = evidence.some((entry) => entry.kind === "creator-note");
    if (firstPerson && !hasCreatorEvidence) continue;
    if (purpose !== "cta" && evidence.length === 0) continue;
    let id = text(item.id) || newId("script");
    if (seen.has(id)) id = newId("script");
    seen.add(id);
    script.push({
      id,
      text: line,
      purpose,
      approxDurationSec: seconds(item.approxDurationSec),
      evidence,
      shotId,
    });
  }
  const total = script.reduce((sum, segment) => sum + segment.approxDurationSec, 0);
  if (total > input.targetDurationSec && total > 0) {
    const scale = input.targetDurationSec / total;
    return script.map((segment) => ({
      ...segment,
      approxDurationSec: Math.max(0.5, Math.round(segment.approxDurationSec * scale * 10) / 10),
    }));
  }
  return script;
}

function validatePlan(raw: string, input: GenerateReviewPlanInput): ReviewPlan {
  const parsed = parseJsonObject(raw);
  const shots = normalizeShots(parsed.shots, input);
  if (shots.length === 0) throw new Error("Review Plan has no valid Shot List.");
  const script = normalizeScript(parsed.script, shots, input);
  if (script.length === 0) throw new Error("Review Plan has no grounded Script lines.");
  const hook = text(parsed.hook) || script.find((segment) => segment.purpose === "hook")?.text || script[0].text;
  return {
    id: newId("review-plan"),
    productTitle: input.brief.title,
    targetDurationSec: input.targetDurationSec,
    hook,
    script,
    shots,
    ...(input.creatorNotes.disclosure === "unspecified"
      ? { disclosureReminder: "Choose a product disclosure before recording or publishing." }
      : {}),
    createdAt: Date.now(),
  };
}

function authorPrompt(input: GenerateReviewPlanInput): string {
  const brief = {
    ...input.brief,
    ...(input.includePrice ? {} : { priceText: undefined }),
  };
  const clips = input.clips.map((clip) => ({
    id: clip.id,
    name: clip.name,
    subjectAction: clip.description?.subjectAction,
    settingMood: clip.description?.settingMood,
    usability: clip.description?.usability,
    tags: clip.tags,
  }));
  return [
    "Create a concise social-media product Review Plan as strict JSON.",
    `Target duration: ${input.targetDurationSec} seconds. Tone: ${input.tone || "natural"}.`,
    `Include CTA: ${input.includeCta ? "yes" : "no"}.`,
    "Use only the Product Claims and Creator Notes supplied below.",
    "Never infer ownership, use, results, price, sponsorship, or recommendation.",
    "First-person language requires evidence {kind:'creator-note',field:<field>}.",
    "Product facts require evidence {kind:'product-claim',claimId:<id>}.",
    "Match matchedClipId only when the Clip Description visibly supports the Shot.",
    "Every Script line must point to a Shot. Request phone-filmable shots for missing footage.",
    "Structure: Hook, Problem, Demonstration, Proof, Verdict, CTA.",
    "Return exactly: {hook,script:[{id,text,purpose,approxDurationSec,evidence,shotId}],shots:[{id,description,capture,framing,approxDurationSec,matchedClipId?}]}",
    `Product Brief:\n${JSON.stringify(brief)}`,
    `Creator Notes:\n${JSON.stringify(input.creatorNotes)}`,
    `Existing Clips:\n${JSON.stringify(clips)}`,
  ].join("\n\n");
}

export async function generateReviewPlan(
  input: GenerateReviewPlanInput,
  author: ReviewAuthorAdapter,
): Promise<ReviewPlan> {
  const prompt = authorPrompt(input);
  const first = await author(prompt);
  try {
    return validatePlan(first, input);
  } catch (firstError) {
    const message = firstError instanceof Error ? firstError.message : String(firstError);
    const repairPrompt = [
      "Repair the following invalid product Review Plan.",
      `Validation error: ${message}`,
      "Return only corrected JSON using the original required contract and evidence rules.",
      `Invalid output:\n${first.slice(0, 20_000)}`,
      `Original requirements:\n${prompt}`,
    ].join("\n\n");
    const repaired = await author(repairPrompt);
    try {
      return validatePlan(repaired, input);
    } catch (repairError) {
      const repairMessage = repairError instanceof Error ? repairError.message : String(repairError);
      throw new Error(`Could not generate a valid Review Plan: ${repairMessage}`);
    }
  }
}

