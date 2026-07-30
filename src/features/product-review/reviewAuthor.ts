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
  scriptType?: string;
  includePrice: boolean;
  includeCta: boolean;
}

export type ReviewAuthorAdapter = (prompt: string) => Promise<string>;

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

function sanitizeCapture(val: string): ReviewShotCapture {
  const clean = val.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (clean.includes("talking") || clean.includes("head") || clean.includes("creator") || clean.includes("person") || clean.includes("face")) return "talking-head";
  if (clean.includes("beauty") || clean.includes("product") || clean.includes("hero")) return "product-beauty";
  if (clean.includes("detail") || clean.includes("close") || clean.includes("macro")) return "detail";
  if (clean.includes("demo") || clean.includes("use") || clean.includes("using") || clean.includes("action")) return "demo";
  if (clean.includes("result") || clean.includes("after") || clean.includes("outcome") || clean.includes("proof")) return "result";
  if (clean.includes("broll") || clean.includes("cutaway") || clean.includes("background")) return "b-roll";
  return "product-beauty";
}

function sanitizeFraming(val: string): ReviewShotFraming {
  const clean = val.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (clean.includes("wide") || clean.includes("full")) return "wide";
  if (clean.includes("medium") || clean.includes("mid")) return "medium";
  if (clean.includes("close") || clean.includes("tight")) return "close-up";
  if (clean.includes("macro") || clean.includes("extreme")) return "macro";
  if (clean.includes("overhead") || clean.includes("top") || clean.includes("flat")) return "overhead";
  if (clean.includes("screen") || clean.includes("record")) return "screen";
  return "medium";
}

function sanitizePurpose(val: string, index: number): ReviewPurpose {
  const clean = val.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (clean.includes("hook") || clean.includes("intro")) return "hook";
  if (clean.includes("problem") || clean.includes("pain") || clean.includes("need")) return "problem";
  if (clean.includes("demo") || clean.includes("feature") || clean.includes("action")) return "demo";
  if (clean.includes("proof") || clean.includes("result") || clean.includes("reason")) return "proof";
  if (clean.includes("verdict") || clean.includes("opinion") || clean.includes("conclusion")) return "verdict";
  if (clean.includes("cta") || clean.includes("call") || clean.includes("buy")) return "cta";
  const defaults: ReviewPurpose[] = ["hook", "problem", "demo", "proof", "verdict", "cta"];
  return defaults[index % defaults.length];
}

function normalizeShots(raw: unknown, input: GenerateReviewPlanInput): ReviewShot[] {
  if (!Array.isArray(raw)) return [];
  const clipIds = new Set(input.clips.map((clip) => clip.id));
  const seen = new Set<string>();
  const shots: ReviewShot[] = [];
  for (const value of raw) {
    const item = record(value);
    if (!item) continue;
    const description = text(item.description) || text(item.shot) || text(item.summary) || text(item.title);
    if (!description) continue;
    const capture = sanitizeCapture(text(item.capture));
    const framing = sanitizeFraming(text(item.framing));
    let id = text(item.id) || newId("shot");
    if (seen.has(id)) id = newId("shot");
    seen.add(id);
    const matchedClipId = text(item.matchedClipId);
    shots.push({
      id,
      description,
      capture,
      framing,
      approxDurationSec: seconds(item.approxDurationSec) || 4,
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
  if (!Array.isArray(raw) || shots.length === 0) return [];
  const shotIds = new Set(shots.map((shot) => shot.id));
  const seen = new Set<string>();
  const script: ReviewScriptSegment[] = [];

  const defaultEvidence: ReviewEvidenceRef[] = input.brief.features.length > 0
    ? [{ kind: "product-claim", claimId: input.brief.features[0].id }]
    : [{ kind: "creator-note", field: "experience" }];

  for (let i = 0; i < raw.length; i++) {
    const item = record(raw[i]);
    if (!item) continue;
    const line = text(item.text) || text(item.line) || text(item.script);
    if (!line) continue;

    const purpose = sanitizePurpose(text(item.purpose), i);
    if (purpose === "cta" && !input.includeCta) continue;

    let shotId = text(item.shotId);
    if (!shotIds.has(shotId)) {
      shotId = shots[i % shots.length].id;
    }

    const evidence = Array.isArray(item.evidence)
      ? item.evidence.map((entry) => validEvidence(entry, input)).filter((entry): entry is ReviewEvidenceRef => entry !== null)
      : [];
    const firstPerson = /\b(?:i|i'm|i've|i'd|my|me|we|we've|our)\b/i.test(line);
    const hasCreatorEvidence = evidence.some((entry) => entry.kind === "creator-note");
    if (firstPerson && !hasCreatorEvidence) continue;

    const finalEvidence = evidence.length > 0 ? evidence : defaultEvidence;

    let id = text(item.id) || newId("script");
    if (seen.has(id)) id = newId("script");
    seen.add(id);

    script.push({
      id,
      text: line,
      purpose,
      approxDurationSec: seconds(item.approxDurationSec) || 5,
      evidence: finalEvidence,
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

export interface EnrichedProductDetails {
  features: string[];
  pros: string[];
  cons: string[];
}

export async function enrichProductDetails(
  productTitle: string,
  brand: string | undefined,
  author: ReviewAuthorAdapter,
): Promise<EnrichedProductDetails> {
  if (!productTitle.trim()) {
    return { features: [], pros: [], cons: [] };
  }
  const prompt = [
    "Analyze the following product and generate its top best-selling features, pros, and cons for a social media review.",
    `Product Title: ${productTitle}${brand ? ` (Brand: ${brand})` : ""}`,
    "Identify:",
    "1. Best selling features (4 to 6 concise key specifications/highlights).",
    "2. Pros (3 to 5 clear advantages and selling points).",
    "3. Cons (1 to 2 minor trade-offs or considerations).",
    "Return ONLY a JSON object formatted exactly as:",
    '{"features":["..."],"pros":["..."],"cons":["..."]}',
  ].join("\n\n");

  try {
    const raw = await author(prompt);
    const unfenced = raw.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
    const start = unfenced.indexOf("{");
    const end = unfenced.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const parsed = JSON.parse(unfenced.slice(start, end + 1));
      const features = Array.isArray(parsed.features)
        ? parsed.features.map((s: unknown) => String(s).trim()).filter(Boolean)
        : [];
      const pros = Array.isArray(parsed.pros)
        ? parsed.pros.map((s: unknown) => String(s).trim()).filter(Boolean)
        : [];
      const cons = Array.isArray(parsed.cons)
        ? parsed.cons.map((s: unknown) => String(s).trim()).filter(Boolean)
        : [];
      return { features, pros, cons };
    }
  } catch (err) {
    console.warn("Product details enrichment failed:", err);
  }
  return { features: [], pros: [], cons: [] };
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
    `Target duration: ${input.targetDurationSec} seconds. Tone: ${input.tone || "positive and enthusiastic"}.${input.scriptType ? ` Script format: ${input.scriptType}.` : ""}`,
    "ALWAYS SOUND POSITIVE: Write every script line in an upbeat, positive, and enthusiastic tone. Highlight the product's best-selling features and pros warmly and encouragingly.",
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

