import { useMemo, useState } from "react";
import type {
  CreatorNotes,
  ProductBrief,
  ReviewDurationSec,
  ReviewPlan,
  ReviewScriptSegment,
  ReviewShot,
} from "../domain/productReview";
import { emptyCreatorNotes } from "../domain/productReview";
import { useProject } from "../state/ProjectContext";
import { toneHint, useSettings } from "../state/SettingsContext";
import { callClaude } from "../lib/claudeClient";
import {
  createAmazonProductSource,
  createManualProductBrief,
  type ProductSource,
} from "../features/product-review/productSource";
import {
  generateReviewPlan,
  type ReviewAuthorAdapter,
} from "../features/product-review/reviewAuthor";
import { applyReviewPlan } from "../features/product-review/applyReviewPlan";
import Button from "../design-system/Button";
import Badge from "../design-system/Badge";
import SegmentedControl from "../design-system/SegmentedControl";
import Switch from "../design-system/Switch";
import { SelectField, TextareaField, TextField } from "../design-system/Field";
import { ProgressNotice } from "../design-system/Feedback";
import Modal from "../design-system/Modal";

type ReviewStep = "import" | "verify" | "generate" | "review";
type DurationOption = "15" | "30" | "45" | "60";

interface ProductForm {
  title: string;
  brand: string;
  category: string;
  description: string;
  featureText: string;
  priceText: string;
  imageUrl: string;
}

interface Props {
  productSource?: ProductSource;
  author?: ReviewAuthorAdapter;
  onApplied?: (firstBeatId: string | null) => void;
}

const DEFAULT_PRODUCT_SOURCE = createAmazonProductSource();
const DURATION_OPTIONS: Array<{ value: DurationOption; label: string }> = [
  { value: "15", label: "15s" },
  { value: "30", label: "30s" },
  { value: "45", label: "45s" },
  { value: "60", label: "60s" },
];

function formFromBrief(brief?: ProductBrief): ProductForm {
  return {
    title: brief?.title ?? "",
    brand: brief?.brand ?? "",
    category: brief?.category ?? "",
    description: brief?.description ?? "",
    featureText: brief?.features.map((claim) => claim.text).join("\n") ?? "",
    priceText: brief?.priceText ?? "",
    imageUrl: brief?.imageUrl ?? "",
  };
}

function lines(value: string): string[] {
  return [...new Set(value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))];
}

function briefFromForm(form: ProductForm, previous?: ProductBrief, sourceUrl?: string): ProductBrief {
  const manual = createManualProductBrief({
    ...form,
    sourceUrl: sourceUrl ?? previous?.source.url,
  });
  if (!previous) return manual;
  const priorByText = new Map(previous.features.map((claim) => [claim.text, claim]));
  return {
    ...manual,
    source: previous.source,
    features: manual.features.map((claim) => priorByText.get(claim.text) ?? claim),
  };
}

function notesHaveContent(notes: CreatorNotes): boolean {
  return Boolean(
    notes.audience.trim()
    || notes.problem.trim()
    || notes.experience.trim()
    || notes.pros.length
    || notes.cons.length
    || notes.verdict.trim()
    || notes.callToAction?.trim(),
  );
}

export default function ProductReviewView({
  productSource = DEFAULT_PRODUCT_SOURCE,
  author,
  onApplied,
}: Props) {
  const { state, dispatch } = useProject();
  const { settings } = useSettings();
  const workspace = state.productReview;
  const [step, setStep] = useState<ReviewStep>(workspace?.plan ? "review" : workspace?.brief ? "verify" : "import");
  const [sourceUrl, setSourceUrl] = useState(workspace?.brief?.source.url ?? "");
  const [form, setForm] = useState<ProductForm>(() => formFromBrief(workspace?.brief));
  const [creatorNotes, setCreatorNotes] = useState<CreatorNotes>(() => workspace?.creatorNotes ?? emptyCreatorNotes());
  const [duration, setDuration] = useState<DurationOption>("30");
  const [includePrice, setIncludePrice] = useState(false);
  const [includeCta, setIncludeCta] = useState(true);
  const [busy, setBusy] = useState<"import" | "generate" | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [replaceOpen, setReplaceOpen] = useState(false);

  const brief = workspace?.brief;
  const plan = workspace?.plan;
  const clipSummaries = useMemo(
    () => state.clips.filter((clip) => !clip.isTemplatePlaceholder).map((clip) => ({
      id: clip.id,
      name: clip.name,
      description: clip.description,
      tags: clip.tags,
    })),
    [state.clips],
  );
  const missingShotCount = plan?.shots.filter((shot) => !shot.matchedClipId).length ?? 0;
  const duplicateClipMatches = useMemo(() => {
    const counts = new Map<string, number>();
    for (const shot of plan?.shots ?? []) {
      if (shot.matchedClipId) counts.set(shot.matchedClipId, (counts.get(shot.matchedClipId) ?? 0) + 1);
    }
    return [...counts.entries()].filter(([, count]) => count > 1).map(([clipId]) => clipId);
  }, [plan?.shots]);

  function updateForm<K extends keyof ProductForm>(key: K, value: ProductForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateNotes<K extends keyof CreatorNotes>(key: K, value: CreatorNotes[K]) {
    setCreatorNotes((current) => ({ ...current, [key]: value }));
  }

  async function importProduct() {
    setError("");
    setBusy("import");
    const result = await productSource.import({ url: sourceUrl.trim() });
    setBusy(null);
    if (!result.ok) {
      const seed: ProductBrief = {
        source: { kind: "manual", url: sourceUrl.trim() },
        title: "",
        features: [],
        ...result.manualSeed,
      };
      dispatch({ type: "SET_PRODUCT_BRIEF", brief: seed, importWarnings: [result.message] });
      setForm(formFromBrief(seed));
      setError(result.message);
      setStep("verify");
      return;
    }
    dispatch({ type: "SET_PRODUCT_BRIEF", brief: result.brief, importWarnings: result.warnings });
    setForm(formFromBrief(result.brief));
    setStep("verify");
  }

  function enterManually() {
    const nextBrief: ProductBrief = {
      source: { kind: "manual", ...(sourceUrl.trim() ? { url: sourceUrl.trim() } : {}) },
      title: "",
      features: [],
    };
    dispatch({ type: "SET_PRODUCT_BRIEF", brief: nextBrief });
    setForm(formFromBrief(nextBrief));
    setError("");
    setStep("verify");
  }

  function saveVerifiedInputs(): ProductBrief | null {
    const nextBrief = briefFromForm(form, brief, sourceUrl);
    if (!nextBrief.title) {
      setError("Add a product title before continuing.");
      return null;
    }
    if (nextBrief.features.length === 0 && !notesHaveContent(creatorNotes)) {
      setError("Add at least one product feature or one Creator Note.");
      return null;
    }
    dispatch({ type: "SET_PRODUCT_BRIEF", brief: nextBrief, importWarnings: workspace?.importWarnings });
    dispatch({ type: "SET_CREATOR_NOTES", creatorNotes });
    setError("");
    return nextBrief;
  }

  function continueToGeneration() {
    if (!saveVerifiedInputs()) return;
    setStep("generate");
  }

  async function generatePlan() {
    const nextBrief = saveVerifiedInputs();
    if (!nextBrief) return;
    setBusy("generate");
    setError("");
    setStatus("");
    try {
      const nextPlan = await generateReviewPlan({
        brief: nextBrief,
        creatorNotes,
        clips: clipSummaries,
        targetDurationSec: Number(duration) as ReviewDurationSec,
        tone: toneHint(settings.tone),
        includePrice: includePrice && Boolean(nextBrief.priceText),
        includeCta,
      }, currentAuthor());
      dispatch({ type: "SET_REVIEW_PLAN", plan: nextPlan });
      setStep("review");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  function currentAuthor(): ReviewAuthorAdapter {
    return author ?? ((prompt) => callClaude(prompt, {
      provider: settings.aiProvider,
      model: settings.authorModel,
    }));
  }

  async function regenerateSegment(segment: ReviewScriptSegment) {
    if (!brief) return;
    setBusy("generate");
    setError("");
    try {
      const regenerated = await generateReviewPlan({
        brief,
        creatorNotes,
        clips: clipSummaries,
        targetDurationSec: plan?.targetDurationSec ?? Number(duration) as ReviewDurationSec,
        tone: toneHint(settings.tone),
        includePrice: includePrice && Boolean(brief.priceText),
        includeCta,
      }, currentAuthor());
      const replacement = regenerated.script.find((candidate) => candidate.purpose === segment.purpose);
      if (!replacement) throw new Error(`AI did not return a grounded ${segment.purpose} line.`);
      updateScript(segment.id, {
        text: replacement.text,
        evidence: replacement.evidence,
        approxDurationSec: replacement.approxDurationSec,
      });
      setStatus(`Regenerated the ${segment.purpose} line.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  function updatePlan(nextPlan: ReviewPlan) {
    dispatch({ type: "SET_REVIEW_PLAN", plan: nextPlan });
  }

  function updateScript(segmentId: string, patch: Partial<ReviewScriptSegment>) {
    if (!plan) return;
    updatePlan({
      ...plan,
      script: plan.script.map((segment) => segment.id === segmentId ? { ...segment, ...patch } : segment),
    });
  }

  function updateShot(shotId: string, patch: Partial<ReviewShot>) {
    if (!plan) return;
    updatePlan({
      ...plan,
      shots: plan.shots.map((shot) => shot.id === shotId ? { ...shot, ...patch } : shot),
    });
  }

  function moveScript(index: number, direction: -1 | 1) {
    if (!plan) return;
    const target = index + direction;
    if (target < 0 || target >= plan.script.length) return;
    const script = [...plan.script];
    [script[index], script[target]] = [script[target], script[index]];
    updatePlan({ ...plan, script });
  }

  function applyPlan() {
    if (!plan) return;
    if (plan.script.some((segment) => !segment.text.trim()) || plan.shots.some((shot) => !shot.description.trim())) {
      setError("Every Script line and Shot needs text before applying.");
      return;
    }
    if (state.story || state.cut) {
      setReplaceOpen(true);
      return;
    }
    commitPlan();
  }

  function commitPlan() {
    if (!plan) return;
    const applied = applyReviewPlan(plan, state.clips);
    dispatch({ type: "APPLY_TEMPLATE", cut: applied.cut, placeholderClips: applied.placeholderClips });
    dispatch({ type: "SET_STORY", story: applied.story });
    setReplaceOpen(false);
    setStatus(`Applied ${applied.cut.beats.length} review shots to the Project.`);
    onApplied?.(applied.cut.beats[0]?.id ?? null);
  }

  if (step === "import") {
    return (
      <div className="st-product-review">
        <section className="st-product-review-intro">
          <Badge tone="signal">Product reel</Badge>
          <h3>Start from the product</h3>
          <p>Import public listing facts, then add your real experience before AI writes the review.</p>
        </section>
        <TextField
          label="Amazon product URL"
          type="url"
          value={sourceUrl}
          onChange={(event) => setSourceUrl(event.target.value)}
          placeholder="https://www.amazon.com/dp/..."
          disabled={busy !== null}
        />
        {error && <div className="st-product-review-alert" role="alert">{error}</div>}
        {busy === "import" && <ProgressNotice title="Importing product" message="Reading public listing details…" />}
        <div className="st-product-review-actions">
          <Button variant="primary" onClick={importProduct} disabled={!sourceUrl.trim() || busy !== null}>Import details</Button>
          <Button variant="secondary" onClick={enterManually} disabled={busy !== null}>Enter manually</Button>
        </div>
      </div>
    );
  }

  if (step === "verify") {
    return (
      <div className="st-product-review">
        <section className="st-product-review-intro">
          <Badge tone="signal">1 · Verify</Badge>
          <h3>Product Brief</h3>
          <p>Listing details describe the product. Creator Notes are the only source for your experience.</p>
        </section>
        {workspace?.importWarnings?.map((warning) => (
          <div key={warning} className="st-product-review-warning">{warning}</div>
        ))}
        {error && <div className="st-product-review-alert" role="alert">{error}</div>}
        <div className="st-product-review-section">
          <TextField label="Product title" value={form.title} onChange={(event) => updateForm("title", event.target.value)} />
          <div className="st-product-review-grid">
            <TextField label="Brand" value={form.brand} onChange={(event) => updateForm("brand", event.target.value)} />
            <TextField label="Category" value={form.category} onChange={(event) => updateForm("category", event.target.value)} />
          </div>
          <TextareaField label="Product description" rows={3} value={form.description} onChange={(event) => updateForm("description", event.target.value)} />
          <TextareaField label="Product features (one per line)" rows={5} value={form.featureText} onChange={(event) => updateForm("featureText", event.target.value)} />
          <div className="st-product-review-grid">
            <TextField label="Price shown" value={form.priceText} onChange={(event) => updateForm("priceText", event.target.value)} />
            <TextField label="Product image URL" type="url" value={form.imageUrl} onChange={(event) => updateForm("imageUrl", event.target.value)} />
          </div>
        </div>
        <section className="st-product-review-section">
          <div className="st-product-review-section-head">
            <div>
              <h3>Creator Notes</h3>
              <p>Only write what you actually observed or believe.</p>
            </div>
            <Badge tone="positive">Your evidence</Badge>
          </div>
          <TextField label="Audience" value={creatorNotes.audience} onChange={(event) => updateNotes("audience", event.target.value)} />
          <TextField label="Problem it solves" value={creatorNotes.problem} onChange={(event) => updateNotes("problem", event.target.value)} />
          <TextareaField label="Your real experience" rows={3} value={creatorNotes.experience} onChange={(event) => updateNotes("experience", event.target.value)} />
          <div className="st-product-review-grid">
            <TextareaField label="Pros (one per line)" rows={3} value={creatorNotes.pros.join("\n")} onChange={(event) => updateNotes("pros", lines(event.target.value))} />
            <TextareaField label="Cons (one per line)" rows={3} value={creatorNotes.cons.join("\n")} onChange={(event) => updateNotes("cons", lines(event.target.value))} />
          </div>
          <TextField label="Your verdict" value={creatorNotes.verdict} onChange={(event) => updateNotes("verdict", event.target.value)} />
          <TextField label="Call to action" value={creatorNotes.callToAction ?? ""} onChange={(event) => updateNotes("callToAction", event.target.value)} />
          <SelectField label="Disclosure" value={creatorNotes.disclosure} onChange={(event) => updateNotes("disclosure", event.target.value as CreatorNotes["disclosure"])}>
            <option value="unspecified">Choose disclosure…</option>
            <option value="purchased">Purchased myself</option>
            <option value="gifted">Gifted product</option>
            <option value="sponsored">Sponsored</option>
            <option value="affiliate">Affiliate relationship</option>
          </SelectField>
        </section>
        <div className="st-product-review-actions">
          <Button variant="secondary" onClick={() => setStep("import")}>Back</Button>
          <Button variant="primary" onClick={continueToGeneration}>Continue to generation</Button>
        </div>
      </div>
    );
  }

  if (step === "generate") {
    return (
      <div className="st-product-review">
        <section className="st-product-review-intro">
          <Badge tone="signal">2 · Generate</Badge>
          <h3>Shape the reel</h3>
          <p>AI will write grounded spoken lines and pair each one with a phone-filmable Shot.</p>
        </section>
        {error && <div className="st-product-review-alert" role="alert">{error}</div>}
        <div className="st-product-review-section">
          <span className="st-product-review-label">Target duration</span>
          <SegmentedControl value={duration} options={DURATION_OPTIONS} onChange={setDuration} ariaLabel="Target review duration" disabled={busy !== null} />
          <div className="st-product-review-switch-row">
            <div><strong>Include price</strong><span>Only uses the price you just verified.</span></div>
            <Switch checked={includePrice} onChange={setIncludePrice} label="Include verified price" disabled={!form.priceText || busy !== null} />
          </div>
          <div className="st-product-review-switch-row">
            <div><strong>Include CTA</strong><span>End with your Creator Notes call to action.</span></div>
            <Switch checked={includeCta} onChange={setIncludeCta} label="Include call to action" disabled={busy !== null} />
          </div>
          <div className="st-product-review-summary">
            <strong>{form.title}</strong>
            <span>{form.featureText ? `${lines(form.featureText).length} product claims` : "Creator Notes only"}</span>
            <span>{clipSummaries.length} existing Clips available for matching</span>
          </div>
        </div>
        {busy === "generate" && <ProgressNotice title="Building Review Plan" message="Grounding → Script → Shot List → Clip matching" />}
        <div className="st-product-review-actions">
          <Button variant="secondary" onClick={() => setStep("verify")} disabled={busy !== null}>Back to product details</Button>
          <Button variant="primary" onClick={generatePlan} disabled={busy !== null}>Generate Review Plan</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="st-product-review">
      <section className="st-product-review-intro">
        <Badge tone="signal">3 · Review</Badge>
        <h3>{plan?.hook ?? "Review Plan"}</h3>
        <p>Edit every line and Shot before applying it to the Project.</p>
        <div className="st-product-review-plan-meta">
          <Badge tone={missingShotCount ? "critical" : "positive"}>{missingShotCount} missing Shot{missingShotCount === 1 ? "" : "s"}</Badge>
          <Badge>{plan?.targetDurationSec ?? 30}s target</Badge>
        </div>
      </section>
      {error && <div className="st-product-review-alert" role="alert">{error}</div>}
      {status && <div className="st-product-review-success" role="status">{status}</div>}
      {plan?.disclosureReminder && <div className="st-product-review-warning">{plan.disclosureReminder}</div>}
      {duplicateClipMatches.length > 0 && (
        <div className="st-product-review-warning">
          One Clip is matched to multiple Shots. Later uses become missing-footage placeholders when applied.
        </div>
      )}
      {busy === "generate" && <ProgressNotice title="Regenerating Script line" message="Checking grounding and duration…" />}
      <div className="st-product-review-plan">
        {plan?.script.map((segment, index) => {
          const shot = plan.shots.find((item) => item.id === segment.shotId);
          return (
            <article className="st-product-review-card" key={segment.id}>
              <header>
                <div>
                  <Badge>{segment.purpose}</Badge>
                  <span>{segment.approxDurationSec.toFixed(1)}s</span>
                </div>
                <div className="st-product-review-card-actions">
                  <Button variant="quiet" size="small" onClick={() => regenerateSegment(segment)} disabled={busy !== null}>Regenerate</Button>
                  <Button variant="quiet" size="small" onClick={() => moveScript(index, -1)} disabled={index === 0} aria-label={`Move ${segment.purpose} earlier`}>↑</Button>
                  <Button variant="quiet" size="small" onClick={() => moveScript(index, 1)} disabled={index === plan.script.length - 1} aria-label={`Move ${segment.purpose} later`}>↓</Button>
                </div>
              </header>
              <TextareaField label="Script line" rows={3} value={segment.text} onChange={(event) => updateScript(segment.id, { text: event.target.value })} />
              {shot && (
                <>
                  <TextareaField label="Shot" rows={2} value={shot.description} onChange={(event) => updateShot(shot.id, { description: event.target.value })} />
                  <SelectField label="Match existing Clip" value={shot.matchedClipId ?? ""} onChange={(event) => updateShot(shot.id, { matchedClipId: event.target.value || undefined })}>
                    <option value="">Missing footage · create placeholder</option>
                    {clipSummaries.map((clip) => <option key={clip.id} value={clip.id}>{clip.name}</option>)}
                  </SelectField>
                </>
              )}
              <div className="st-product-review-evidence">
                {segment.evidence.map((entry, evidenceIndex) => (
                  <Badge key={`${segment.id}-${evidenceIndex}`} tone="positive">
                    {entry.kind === "product-claim" ? "Product claim" : `Creator · ${entry.field}`}
                  </Badge>
                ))}
              </div>
            </article>
          );
        })}
      </div>
      <div className="st-product-review-actions">
        <Button variant="quiet" onClick={() => setStatus("Review Plan saved with this Project.")}>Save plan only</Button>
        <Button variant="secondary" onClick={() => setStep("generate")}>Regenerate plan</Button>
        <Button variant="primary" onClick={applyPlan} disabled={!plan}>Apply to Project</Button>
      </div>
      <Modal
        open={replaceOpen}
        title="Replace the current Story and Cut?"
        description="The Product Brief and Review Plan will be kept. Existing Clips stay in the Project."
        ariaLabel="Confirm replacing current Story and Cut"
        maxWidth={440}
        onClose={() => setReplaceOpen(false)}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setReplaceOpen(false)}>Keep current Cut</Button>
            <Button variant="danger" onClick={commitPlan}>Replace with review Cut</Button>
          </>
        )}
      >
        <p className="st-product-review-modal-copy">This replaces the current Story arrangement and timeline layers. Exported media and source Clips are not deleted.</p>
      </Modal>
    </div>
  );
}
