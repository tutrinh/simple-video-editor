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
  /** Spend the duration on the supplied Product Features and recorded pros. */
  emphasizeFeaturesAndPros: boolean;
  /**
   * A hand-edited Author Prompt, used verbatim in place of the generated one.
   * Blank or absent falls back to `buildAuthorPrompt`. The response is validated
   * the same way either way — editing the prompt cannot loosen the grounding.
   */
  promptOverride?: string;
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
  if (!item || item.kind !== "creator-note") return null;
  const field = text(item.field) as CreatorNoteField;
  return CREATOR_FIELDS.has(field) && creatorNoteHasValue(input.creatorNotes, field)
    ? { kind: "creator-note", field }
    : null;
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
  // The author is no longer shown the Project's Clips, so it should not be
  // proposing matches. Anything it invents anyway is dropped here; real matches
  // come from the creator picking one per Shot on the plan review step.
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

const FIRST_PERSON = /\b(?:i|i'm|i've|i'd|my|me|we|we've|our)\b/i;

/** How many opening lines the creator gets to choose between. */
export const HOOK_OPTION_COUNT = 3;

// Most substantive Note first. A line the author left unevidenced is pinned to
// whichever of these the creator actually filled in; with no Notes at all there
// is nothing left to cite, so the line carries none.
const FALLBACK_EVIDENCE_FIELDS: CreatorNoteField[] = [
  "experience",
  "verdict",
  "pros",
  "problem",
  "audience",
  "cons",
];

function fallbackEvidence(notes: CreatorNotes): ReviewEvidenceRef[] {
  const field = FALLBACK_EVIDENCE_FIELDS.find((candidate) => creatorNoteHasValue(notes, candidate));
  return field ? [{ kind: "creator-note", field }] : [];
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

  const defaultEvidence = fallbackEvidence(input.creatorNotes);

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
    // First person must be earned by an explicit Note, never by the fallback.
    if (FIRST_PERSON.test(line) && evidence.length === 0) continue;

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

/**
 * The chosen hook first, then the author's alternatives — deduped, capped, and
 * held to the same first-person rule as a Script line, since whichever the
 * creator picks becomes the spoken opening line.
 */
function normalizeHookOptions(
  raw: unknown,
  chosen: string,
  input: GenerateReviewPlanInput,
): string[] {
  const canSpeakFirstPerson = fallbackEvidence(input.creatorNotes).length > 0;
  const seen = new Set<string>();
  const options: string[] = [];

  const add = (value: unknown) => {
    if (options.length >= HOOK_OPTION_COUNT) return;
    const line = text(value);
    const key = line.toLowerCase();
    if (!line || seen.has(key)) return;
    if (FIRST_PERSON.test(line) && !canSpeakFirstPerson) return;
    seen.add(key);
    options.push(line);
  };

  add(chosen);
  if (Array.isArray(raw)) for (const value of raw) add(value);
  return options;
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
    hookOptions: normalizeHookOptions(parsed.hookOptions, hook, input),
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

/** The Brief as the author sees it — price is withheld until the creator confirms it. */
function briefForPrompt(input: GenerateReviewPlanInput): ProductBrief {
  return {
    ...input.brief,
    ...(input.includePrice ? {} : { priceText: undefined }),
  };
}

// Opt-in coverage push. Left to itself the author spends a short duration on
// narrative beats and gestures at the product in general terms, so the listed
// features and recorded pros never reach the Script. This raises how much of the
// supplied material gets used; it does not loosen what may be said about it.
function emphasisDirectives(input: GenerateReviewPlanInput): string[] {
  if (!input.emphasizeFeaturesAndPros) return [];
  return [
    [
      "EMPHASIS — PRODUCT FEATURES AND PROS: make the listed features and recorded pros the substance of the Script, not background colour.",
      "- Name Product Features explicitly and specifically. Do not reduce a feature to vague praise.",
      "- Cover as many distinct Product Features as the target duration allows, strongest first, spread across the Demonstration and Proof lines rather than stacked into one.",
      "- Give each pro the creator recorded in their Notes its own beat where the duration allows, carrying evidence {kind:'creator-note',field:'pros'}. A pro written in first person without that evidence is discarded.",
      "- Give every feature or pro you feature a Shot that visibly shows it.",
      "- This widens how much supplied material is used. It never licenses material that was not supplied, and the grounding rules above still bind every line.",
    ].join("\n"),
  ];
}

/**
 * The Author Prompt for these inputs. Exported so the Generate step can show it,
 * let the creator edit it, and hand the edit back as `promptOverride`.
 */
export function buildAuthorPrompt(input: GenerateReviewPlanInput): string {
  return [
    "Create a concise social-media product Review Plan as strict JSON.",
    `Target duration: ${input.targetDurationSec} seconds. Tone: ${input.tone || "positive and enthusiastic"}.${input.scriptType ? ` Script format: ${input.scriptType}.` : ""}`,
    `Include CTA: ${input.includeCta ? "yes" : "no"}.`,
    // Stance steers wording only. Stating the precedence explicitly keeps a
    // favourable read from being taken as licence to embellish or bury a con.
    "GROUNDING OUTRANKS STANCE AND TONE: the rules below decide what a line may say; stance and tone decide only how it is worded.",
    "Use only the Product Features and Creator Notes supplied below.",
    "Never infer ownership, use, results, price, sponsorship, or recommendation.",
    "Stance: keep the review favourable — lead with the strongest supplied features and pros, and deliver them in the Tone above.",
    "A favourable stance may never invent a benefit, strength, or result that is absent from the supplied material, restate a Product Feature as your own recommendation, or soften, omit, or contradict a drawback the creator recorded in their Notes. State a recorded drawback plainly and stay warm about the rest.",
    ...emphasisDirectives(input),
    "Evidence cites the creator's own Notes only: {kind:'creator-note',field:<field>}. Product Features are context you may describe, but they are never evidence.",
    "First-person language requires evidence. A first-person line with no Creator Note behind it is discarded.",
    "Every Script line must point to a Shot. Describe each Shot as something the creator can film on a phone.",
    "Structure: Hook, Problem, Demonstration, Proof, Verdict, CTA.",
    `Write exactly ${HOOK_OPTION_COUNT} opening lines into hookOptions, each a genuinely different angle on the same grounded material — not a rewording of the others. Set hook to the strongest one and open the Script with it. Every option must obey the rules above, because the creator picks which one is spoken.`,
    "Return exactly: {hook,hookOptions:[<string>],script:[{id,text,purpose,approxDurationSec,evidence,shotId}],shots:[{id,description,capture,framing,approxDurationSec}]}",
    `Product Brief:\n${JSON.stringify(briefForPrompt(input))}`,
    `Creator Notes:\n${JSON.stringify(input.creatorNotes)}`,
  ].join("\n\n");
}

export async function generateReviewPlan(
  input: GenerateReviewPlanInput,
  author: ReviewAuthorAdapter,
): Promise<ReviewPlan> {
  const prompt = input.promptOverride?.trim() || buildAuthorPrompt(input);
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

