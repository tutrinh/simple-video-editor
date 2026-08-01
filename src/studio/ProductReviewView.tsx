import { useEffect, useMemo, useState } from "react";
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
import {
  AI_PROVIDER_OPTIONS,
  CODEX_MODEL_OPTIONS,
  MODEL_OPTIONS,
  SCRIPT_TYPE_OPTIONS,
  TONE_OPTIONS,
  scriptTypeHint,
  toneHint,
  useSettings,
  type AiProvider,
} from "../state/SettingsContext";
import { callClaude } from "../lib/claudeClient";
import { cleanImageUrl } from "../features/product-review/amazonProductSource";
import {
  createAmazonProductSource,
  createManualProductBrief,
  type ProductSource,
} from "../features/product-review/productSource";
import {
  enrichProductDetails,
  generateReviewPlan,
  type ReviewAuthorAdapter,
} from "../features/product-review/reviewAuthor";
import { synthesizeVoiceover } from "../lib/tts";
import { useExportSettings } from "../state/ExportSettingsContext";
import { applyReviewPlan, fitReviewPlanVoiceoversToLength } from "../features/product-review/applyReviewPlan";
import {
  deleteSavedReviewPlan,
  getSavedReviewPlans,
  saveReviewPlanToHistory,
  type SavedReviewPlanItem,
} from "../lib/savedReviewPlans";
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
  onClose?: () => void;
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

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
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

/**
 * One verified evidence list, shown in full on the Generate step. Nothing here is
 * truncated: what the creator can see is exactly what the author prompt is grounded
 * in, so a missing pro or an unwanted claim is visible before the plan is written.
 */
function EvidenceList({
  title,
  items,
  emptyHint,
  tone,
}: {
  title: string;
  items: string[];
  emptyHint: string;
  tone?: "positive" | "caution";
}) {
  const accent = tone === "positive" ? "var(--positive)" : tone === "caution" ? "var(--danger)" : "var(--ink-3)";

  return (
    <div className="st-product-review-evidence-group">
      <div className="st-product-review-evidence-head">
        <span className="st-product-review-label">{title}</span>
        <span className="st-product-review-evidence-count">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="st-product-review-evidence-empty">{emptyHint}</p>
      ) : (
        <ul className="st-product-review-evidence-list">
          {items.map((item, index) => (
            <li key={`${item}-${index}`}>
              <span aria-hidden="true" style={{ color: accent }}>•</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ProductThumbnailCard({ imageUrl, title, brand }: { imageUrl?: string; title?: string; brand?: string }) {
  const cleanUrl = useMemo(() => (imageUrl ? cleanImageUrl(imageUrl) : ""), [imageUrl]);
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    setImgFailed(false);
  }, [cleanUrl]);

  if (!cleanUrl && !title) return null;

  return (
    <div
      className="st-product-review-image-card"
      style={{
        padding: "10px 12px",
        background: "var(--panel-2)",
        borderRadius: "8px",
        border: "1px solid var(--line)",
        display: "flex",
        alignItems: "center",
        gap: "12px",
        marginBottom: "16px",
      }}
    >
      <div
        style={{
          width: 52,
          height: 52,
          borderRadius: 6,
          background: "#ffffff",
          border: "1px solid var(--line)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          flexShrink: 0,
          position: "relative",
        }}
      >
        {cleanUrl && !imgFailed ? (
          <img
            key={cleanUrl}
            src={cleanUrl}
            alt={title || "Product thumbnail"}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
            }}
            onError={() => setImgFailed(true)}
            onLoad={() => setImgFailed(false)}
          />
        ) : (
          <span style={{ fontSize: 22, color: "var(--ink-2)" }}>📦</span>
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {title || "Product details"}
        </div>
        {brand && (
          <div style={{ fontSize: 11, color: "var(--ink-2)", marginTop: 2 }}>
            Brand: {brand}
          </div>
        )}
        <div style={{ fontSize: 11, marginTop: 4, fontWeight: 500, color: cleanUrl && !imgFailed ? "var(--accent)" : "var(--ink-2)" }}>
          {cleanUrl && !imgFailed ? (
            "✓ Product thumbnail loaded"
          ) : imgFailed ? (
            <span
              style={{ cursor: "pointer", textDecoration: "underline" }}
              onClick={() => setImgFailed(false)}
              title="Click to retry loading image"
            >
              ⚠️ Retry image load · Verify Product image URL below
            </span>
          ) : (
            "📷 No thumbnail image · Paste image URL below"
          )}
        </div>
      </div>
    </div>
  );
}

export default function ProductReviewView({
  productSource = DEFAULT_PRODUCT_SOURCE,
  author,
  onClose,
  onApplied,
}: Props) {
  const { state, dispatch } = useProject();
  const { settings, update: updateSettings } = useSettings();
  const { settings: exportSettings } = useExportSettings();
  const workspace = state.productReview;
  const [step, setStep] = useState<ReviewStep>(workspace?.plan ? "review" : workspace?.brief ? "verify" : "import");
  const [sourceUrl, setSourceUrl] = useState(workspace?.brief?.source.url ?? "");
  const [form, setForm] = useState<ProductForm>(() => formFromBrief(workspace?.brief));
  const [creatorNotes, setCreatorNotes] = useState<CreatorNotes>(() => workspace?.creatorNotes ?? emptyCreatorNotes());
  // Pros/Cons are stored as clean string[], but `lines()` trims and drops empties — so
  // binding the textareas straight to `pros.join("\n")` ate a trailing space or newline
  // on every keystroke, making multi-word, multi-line entry impossible. The raw text is
  // what the creator edits; the arrays stay derived from it.
  const [prosText, setProsText] = useState(() => creatorNotes.pros.join("\n"));
  const [consText, setConsText] = useState(() => creatorNotes.cons.join("\n"));
  const [duration, setDuration] = useState<DurationOption>("30");
  const [includePrice, setIncludePrice] = useState(false);
  const [includeCta, setIncludeCta] = useState(true);
  const [busy, setBusy] = useState<"import" | "generate" | "apply" | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [startOverOpen, setStartOverOpen] = useState(false);
  const [savedPlans, setSavedPlans] = useState<SavedReviewPlanItem[]>(() => getSavedReviewPlans());

  useEffect(() => {
    if (!busy) {
      setElapsedSec(0);
      return;
    }
    const timer = setInterval(() => {
      setElapsedSec((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [busy]);

  useEffect(() => {
    if (workspace?.plan && workspace?.brief) {
      setSavedPlans(saveReviewPlanToHistory(workspace));
    }
  }, [workspace]);

  // Re-seed the editable text whenever pros/cons change from outside the textareas —
  // AI enrichment, import, restoring a saved plan, start over. Keeping the draft when
  // it already normalizes to the same list is what stops it clobbering mid-word.
  useEffect(() => {
    setProsText((current) => (sameList(lines(current), creatorNotes.pros) ? current : creatorNotes.pros.join("\n")));
  }, [creatorNotes.pros]);

  useEffect(() => {
    setConsText((current) => (sameList(lines(current), creatorNotes.cons) ? current : creatorNotes.cons.join("\n")));
  }, [creatorNotes.cons]);

  const brief = workspace?.brief;
  const plan = workspace?.plan;

  function confirmStartOver() {
    if (workspace?.plan || (workspace?.brief && form.title.trim())) {
      if (workspace) setSavedPlans(saveReviewPlanToHistory(workspace));
      setStartOverOpen(true);
      return;
    }
    executeStartOver();
  }

  function executeStartOver() {
    dispatch({ type: "CLEAR_PRODUCT_REVIEW" });
    setSourceUrl("");
    setForm(formFromBrief(undefined));
    setCreatorNotes(emptyCreatorNotes());
    setError("");
    setStatus("");
    setStep("import");
    setStartOverOpen(false);
  }

  function startOver() {
    confirmStartOver();
  }

  function loadSavedPlan(item: SavedReviewPlanItem) {
    dispatch({ type: "LOAD_PRODUCT_REVIEW", workspace: item.workspace });
    setForm(formFromBrief(item.workspace.brief));
    setCreatorNotes(item.workspace.creatorNotes);
    setSourceUrl(item.workspace.brief?.source.url ?? "");
    setStep("review");
    setHistoryOpen(false);
    setStatus(`Loaded saved plan for "${item.productTitle}".`);
  }

  function removeSavedPlan(id: string) {
    const updated = deleteSavedReviewPlan(id);
    setSavedPlans(updated);
  }
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

  function updateProsText(text: string) {
    setProsText(text);
    updateNotes("pros", lines(text));
  }

  function updateConsText(text: string) {
    setConsText(text);
    updateNotes("cons", lines(text));
  }

  async function importProduct() {
    setError("");
    setStatus("Importing product from Amazon…");
    setBusy("import");
    console.log("%c[Amazon Import] Starting import for URL:", "color: #ffb339; font-weight: bold;", sourceUrl.trim());
    const result = await productSource.import({ url: sourceUrl.trim() });
    console.log("%c[Amazon Import Result]", "color: #00c853; font-weight: bold;", result);

    if (!result.ok) {
      setBusy(null);
      setStatus("");
      console.warn("[Amazon Import Failed]", result.message, result.reason);
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

    let updatedBrief = result.brief;
    let initialNotes = creatorNotes;

    if (updatedBrief.title) {
      setStatus("Scouring internet for best selling features, pros, and cons…");
      try {
        const enriched = await enrichProductDetails(updatedBrief.title, updatedBrief.brand, currentAuthor());
        console.log("%c[Amazon AI Enrichment Result]", "color: #29b6f6; font-weight: bold;", enriched);
        if (enriched.features.length > 0) {
          const claims = enriched.features.map((f, i) => ({
            id: `listing-${updatedBrief.source.asin || "auto"}-${i + 1}`,
            text: f,
            source: "listing" as const,
          }));
          updatedBrief = { ...updatedBrief, features: claims };
        }
        if (enriched.pros.length > 0 || enriched.cons.length > 0) {
          initialNotes = {
            ...initialNotes,
            ...(enriched.pros.length > 0 ? { pros: enriched.pros } : {}),
            ...(enriched.cons.length > 0 ? { cons: enriched.cons } : {}),
          };
          setCreatorNotes(initialNotes);
        }
      } catch (e) {
        console.warn("Auto-enrichment during import failed:", e);
      }
    }

    setBusy(null);
    setStatus("");
    dispatch({ type: "SET_PRODUCT_BRIEF", brief: updatedBrief, importWarnings: result.warnings });
    dispatch({ type: "SET_CREATOR_NOTES", creatorNotes: initialNotes });
    setForm(formFromBrief(updatedBrief));
    setStep("verify");
  }

  async function autoEnrichDetails() {
    if (!form.title.trim()) {
      setError("Enter a product title first.");
      return;
    }
    setError("");
    setStatus("Scouring internet for best selling features, pros, and cons…");
    setBusy("import");
    try {
      const enriched = await enrichProductDetails(form.title, form.brand, currentAuthor());
      if (enriched.features.length > 0) {
        const existingFeatures = lines(form.featureText);
        const mergedFeatures = [...new Set([...existingFeatures, ...enriched.features])];
        updateForm("featureText", mergedFeatures.join("\n"));
      }
      if (enriched.pros.length > 0 || enriched.cons.length > 0) {
        setCreatorNotes((current) => ({
          ...current,
          pros: [...new Set([...current.pros, ...enriched.pros])],
          cons: [...new Set([...current.cons, ...enriched.cons])],
        }));
      }
      setStatus("Updated best-selling features, pros, and cons.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to scour features.");
    } finally {
      setBusy(null);
    }
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
        scriptType: scriptTypeHint(settings.scriptType),
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
        scriptType: scriptTypeHint(settings.scriptType),
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

  async function commitPlan() {
    if (!plan) return;
    setBusy("apply");
    setError("");
    try {
      const rawApplied = applyReviewPlan(plan, state.clips);
      dispatch({ type: "APPLY_TEMPLATE", cut: rawApplied.cut, placeholderClips: rawApplied.placeholderClips });
      dispatch({ type: "SET_STORY", story: rawApplied.story });
      setReplaceOpen(false);
      onApplied?.(rawApplied.cut.beats[0]?.id ?? null);
      setStatus(`Applied ${rawApplied.cut.beats.length} review shots to the Project.`);

      fitReviewPlanVoiceoversToLength(rawApplied, (text) =>
        synthesizeVoiceover(text, {
          engine: exportSettings.ttsEngine,
          voice: exportSettings.voice,
          elevenVoiceId: exportSettings.elevenVoiceId,
          speed: exportSettings.voiceoverSpeed,
          elevenModel: exportSettings.elevenModel,
          elevenStability: exportSettings.elevenStability,
          elevenStyle: exportSettings.elevenStyle,
        })
      ).then((fitted) => {
        if (fitted.cut !== rawApplied.cut) {
          dispatch({ type: "SET_CUT", cut: fitted.cut });
        }
      }).catch(() => {
        // Fallback to default shot duration gracefully
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  const renderStepNav = () => (
    <div style={{ display: "flex", gap: "6px", marginBottom: "14px", flexWrap: "wrap" }}>
      <Button
        variant={step === "import" ? "primary" : "secondary"}
        size="small"
        onClick={() => setStep("import")}
        disabled={busy !== null}
      >
        Import
      </Button>
      <Button
        variant={step === "verify" ? "primary" : "secondary"}
        size="small"
        onClick={() => setStep("verify")}
        disabled={busy !== null || (!brief && !form.title)}
      >
        1 · Verify
      </Button>
      <Button
        variant={step === "generate" ? "primary" : "secondary"}
        size="small"
        onClick={() => setStep("generate")}
        disabled={busy !== null || (!brief && !form.title)}
      >
        2 · Generate
      </Button>
      <Button
        variant={step === "review" ? "primary" : "secondary"}
        size="small"
        onClick={() => setStep("review")}
        disabled={busy !== null || !plan}
      >
        3 · Review
      </Button>
      {savedPlans.length > 0 && (
        <Button
          variant="quiet"
          size="small"
          onClick={() => { setSavedPlans(getSavedReviewPlans()); setHistoryOpen(true); }}
        >
          📂 Saved Plans ({savedPlans.length})
        </Button>
      )}
    </div>
  );

  const renderModals = () => (
    <>
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

      <Modal
        open={startOverOpen}
        title="Start over with a new product?"
        description="Your current review plan has been saved to your Saved Plans library so you can reload it anytime."
        ariaLabel="Confirm starting over"
        maxWidth={440}
        onClose={() => setStartOverOpen(false)}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setStartOverOpen(false)}>Keep editing current plan</Button>
            <Button variant="danger" onClick={executeStartOver}>Start over</Button>
          </>
        )}
      >
        <p className="st-product-review-modal-copy">Starting over clears the active product brief from this view. You can reload saved plans anytime from the top bar.</p>
      </Modal>

      <Modal
        open={historyOpen}
        title="Saved Review Plans Library"
        description="Select a previously saved product review plan to reload."
        ariaLabel="Saved Review Plans Library"
        maxWidth={500}
        onClose={() => setHistoryOpen(false)}
        footer={(
          <Button variant="secondary" onClick={() => setHistoryOpen(false)}>Close</Button>
        )}
      >
        {savedPlans.length === 0 ? (
          <p style={{ color: "var(--ink-2)", fontSize: 13, textAlign: "center", padding: "16px 0" }}>No saved review plans found.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px", maxHeight: "360px", overflowY: "auto", paddingRight: "4px" }}>
            {savedPlans.map((item) => (
              <div
                key={item.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "12px",
                  padding: "10px 12px",
                  background: "var(--panel-2)",
                  borderRadius: "8px",
                  border: "1px solid var(--line)",
                }}
              >
                {item.imageUrl && (
                  <img
                    src={item.imageUrl}
                    alt={item.productTitle}
                    referrerPolicy="no-referrer"
                    style={{ width: 44, height: 44, objectFit: "contain", borderRadius: 4, background: "#ffffff", border: "1px solid var(--line)", flexShrink: 0 }}
                    onError={(e) => { (e.target as HTMLElement).style.display = "none"; }}
                  />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ display: "block", fontSize: 13, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {item.productTitle}
                  </strong>
                  <span style={{ fontSize: 11, color: "var(--ink-2)" }}>
                    {item.workspace.plan?.targetDurationSec ?? 30}s target · {new Date(item.savedAt).toLocaleDateString()}
                  </span>
                </div>
                <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
                  <Button variant="primary" size="small" onClick={() => loadSavedPlan(item)}>Load Plan</Button>
                  <Button variant="quiet" size="small" onClick={() => removeSavedPlan(item.id)}>Delete</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </>
  );

  if (step === "import") {
    return (
      <div className="st-product-review">
        {renderStepNav()}
        <section className="st-product-review-intro">
          <Badge tone="signal">Product reel</Badge>
          <h3>Start from the product</h3>
          <p>Import public listing facts, then add your real experience before AI writes the review.</p>
        </section>
        <ProductThumbnailCard imageUrl={form.imageUrl || brief?.imageUrl} title={form.title || brief?.title} brand={form.brand || brief?.brand} />
        <TextField
          label="Product URL"
          type="url"
          value={sourceUrl}
          onChange={(event) => setSourceUrl(event.target.value)}
          placeholder="https://example.com/product/..."
          disabled={busy !== null}
        />
        {error && (
          <div className="st-product-review-alert" role="alert" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <span>{error}</span>
            <Button variant="secondary" size="small" onClick={startOver}>Start over</Button>
          </div>
        )}
        {busy === "import" && <ProgressNotice title="Importing product" message={status || "Reading listing details & scouring best selling features…"} />}
        <div className="st-product-review-actions">
          <Button variant="primary" onClick={importProduct} disabled={!sourceUrl.trim() || busy !== null}>Import details</Button>
          <Button variant="secondary" onClick={enterManually} disabled={busy !== null}>Enter manually</Button>
        </div>
        {renderModals()}
      </div>
    );
  }

  if (step === "verify") {
    return (
      <div className="st-product-review">
        {renderStepNav()}
        <section className="st-product-review-intro">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
            <Badge tone="signal">1 · Verify</Badge>
            <Button variant="quiet" size="small" onClick={startOver}>Start over</Button>
          </div>
          <h3>Product Brief</h3>
          <p>Main image and product name are imported. Scour best selling features and pros/cons with AI.</p>
        </section>
        {workspace?.importWarnings?.map((warning) => (
          <div key={warning} className="st-product-review-warning">{warning}</div>
        ))}
        {error && (
          <div className="st-product-review-alert" role="alert" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <span>{error}</span>
            <Button variant="secondary" size="small" onClick={startOver}>Start over</Button>
          </div>
        )}
        {status && <div className="st-product-review-success" role="status">{status}</div>}
        {busy === "import" && <ProgressNotice title="Enriching product details" message={status || "Scouring best selling features, pros, and cons…"} />}
        <ProductThumbnailCard imageUrl={form.imageUrl} title={form.title} brand={form.brand} />
        <div className="st-product-review-section">
          <TextField label="Product title" value={form.title} onChange={(event) => updateForm("title", event.target.value)} />
          <div className="st-product-review-grid">
            <TextField label="Brand" value={form.brand} onChange={(event) => updateForm("brand", event.target.value)} />
            <TextField label="Category" value={form.category} onChange={(event) => updateForm("category", event.target.value)} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-2)" }}>Best Selling Features</span>
            <Button variant="secondary" size="small" onClick={autoEnrichDetails} disabled={busy !== null || !form.title.trim()}>
              ✨ Scour Features & Pros/Cons
            </Button>
          </div>
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
            <TextareaField label="Pros (one per line)" rows={3} value={prosText} onChange={(event) => updateProsText(event.target.value)} />
            <TextareaField label="Cons (one per line)" rows={3} value={consText} onChange={(event) => updateConsText(event.target.value)} />
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
        <section className="st-product-review-section">
          <div className="st-product-review-section-head">
            <div>
              <h3>AI Engine & Script Settings</h3>
              <p>Configure model, tone, and script style for generating your reel.</p>
            </div>
            <Badge tone="signal">AI Setup</Badge>
          </div>
          <div className="st-product-review-grid">
            <SelectField
              label="AI Engine (Provider)"
              value={settings.aiProvider}
              onChange={(event) => {
                const nextProvider = event.target.value as AiProvider;
                const defaultModel = nextProvider === "codex" ? CODEX_MODEL_OPTIONS[0] : MODEL_OPTIONS[0];
                updateSettings({ aiProvider: nextProvider, authorModel: defaultModel });
              }}
              disabled={busy !== null}
            >
              {AI_PROVIDER_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>{opt.label}</option>
              ))}
            </SelectField>

            <SelectField
              label="AI Model"
              value={settings.authorModel}
              onChange={(event) => updateSettings({ authorModel: event.target.value })}
              disabled={busy !== null}
            >
              {(settings.aiProvider === "codex" ? CODEX_MODEL_OPTIONS : MODEL_OPTIONS).map((model) => (
                <option key={model} value={model}>{model}</option>
              ))}
            </SelectField>
          </div>

          <div className="st-product-review-grid" style={{ marginTop: 12 }}>
            <SelectField
              label="Tone / Voice"
              value={settings.tone}
              onChange={(event) => updateSettings({ tone: event.target.value })}
              disabled={busy !== null}
            >
              {TONE_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>{opt.label}</option>
              ))}
            </SelectField>

            <SelectField
              label="Script Type / Format"
              value={settings.scriptType}
              onChange={(event) => updateSettings({ scriptType: event.target.value })}
              disabled={busy !== null}
            >
              {SCRIPT_TYPE_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>{opt.label}</option>
              ))}
            </SelectField>
          </div>
        </section>
        <div className="st-product-review-actions">
          <Button variant="secondary" onClick={startOver}>Start over</Button>
          <Button variant="primary" onClick={continueToGeneration}>Continue to generation</Button>
        </div>
        {renderModals()}
      </div>
    );
  }

  if (step === "generate") {
    return (
      <div className="st-product-review">
        {renderStepNav()}
        <section className="st-product-review-intro">
          <Badge tone="signal">2 · Generate</Badge>
          <h3>Shape the reel</h3>
          <p>AI will write grounded spoken lines and pair each one with a phone-filmable Shot.</p>
        </section>
        {error && <div className="st-product-review-alert" role="alert">{error}</div>}
        <div className="st-product-review-section">
          <span className="st-product-review-label">Target duration</span>
          <SegmentedControl value={duration} options={DURATION_OPTIONS} onChange={setDuration} ariaLabel="Target review duration" disabled={busy !== null} />
          <div className="st-product-review-grid" style={{ marginTop: 14 }}>
            <SelectField
              label="AI Engine (Provider)"
              value={settings.aiProvider}
              onChange={(event) => {
                const nextProvider = event.target.value as AiProvider;
                const defaultModel = nextProvider === "codex" ? CODEX_MODEL_OPTIONS[0] : MODEL_OPTIONS[0];
                updateSettings({ aiProvider: nextProvider, authorModel: defaultModel });
              }}
              disabled={busy !== null}
            >
              {AI_PROVIDER_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>{opt.label}</option>
              ))}
            </SelectField>

            <SelectField
              label="AI Model"
              value={settings.authorModel}
              onChange={(event) => updateSettings({ authorModel: event.target.value })}
              disabled={busy !== null}
            >
              {(settings.aiProvider === "codex" ? CODEX_MODEL_OPTIONS : MODEL_OPTIONS).map((model) => (
                <option key={model} value={model}>{model}</option>
              ))}
            </SelectField>
          </div>

          <div className="st-product-review-grid" style={{ marginTop: 12 }}>
            <SelectField
              label="Tone / Voice"
              value={settings.tone}
              onChange={(event) => updateSettings({ tone: event.target.value })}
              disabled={busy !== null}
            >
              {TONE_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>{opt.label}</option>
              ))}
            </SelectField>

            <SelectField
              label="Script Type / Format"
              value={settings.scriptType}
              onChange={(event) => updateSettings({ scriptType: event.target.value })}
              disabled={busy !== null}
            >
              {SCRIPT_TYPE_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>{opt.label}</option>
              ))}
            </SelectField>
          </div>

          <div className="st-product-review-switch-row">
            <div><strong>Include price</strong><span>Only uses the price you just verified.</span></div>
            <Switch checked={includePrice} onChange={setIncludePrice} label="Include verified price" disabled={!form.priceText || busy !== null} />
          </div>
          <div className="st-product-review-switch-row">
            <div><strong>Include CTA</strong><span>End with your Creator Notes call to action.</span></div>
            <Switch checked={includeCta} onChange={setIncludeCta} label="Include call to action" disabled={busy !== null} />
          </div>
          <div className="st-product-review-summary" style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {form.imageUrl && (
              <img
                src={form.imageUrl}
                alt={form.title}
                referrerPolicy="no-referrer"
                style={{
                  width: 48,
                  height: 48,
                  objectFit: "contain",
                  borderRadius: 6,
                  background: "#ffffff",
                  padding: 2,
                  border: "1px solid var(--line)",
                  flexShrink: 0,
                }}
                onError={(e) => {
                  (e.target as HTMLElement).style.display = "none";
                }}
              />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong>{form.title}</strong>
              <span>{form.featureText ? `${lines(form.featureText).length} product claims` : "Creator Notes only"}</span>
              <span>{clipSummaries.length} existing Clips available for matching</span>
            </div>
          </div>
        </div>

        <section className="st-product-review-section">
          <div className="st-product-review-section-head">
            <div>
              <h3>What the script will be built from</h3>
              <p>Everything you verified in step 1. Anything missing here can't reach the script.</p>
            </div>
            <Button variant="secondary" size="small" onClick={() => setStep("verify")} disabled={busy !== null}>
              Edit in step 1
            </Button>
          </div>
          <EvidenceList
            title="Product features"
            items={lines(form.featureText)}
            emptyHint="No product features verified — the script will lean on your Creator Notes alone."
          />
          <div className="st-product-review-grid">
            <EvidenceList
              title="Pros"
              tone="positive"
              items={creatorNotes.pros}
              emptyHint="No pros recorded yet."
            />
            <EvidenceList
              title="Cons"
              tone="caution"
              items={creatorNotes.cons}
              emptyHint="No cons recorded — a review with no cons reads like an ad."
            />
          </div>
        </section>
        {busy === "generate" && (
          <ProgressNotice
            title={`Building Review Plan (${elapsedSec}s)`}
            message={
              elapsedSec > 15
                ? `Claude AI is authoring grounded script & shot list (${elapsedSec}s elapsed). Hang tight…`
                : "Grounding → Script → Shot List → Clip matching"
            }
          />
        )}
        <div className="st-product-review-actions">
          <Button variant="secondary" onClick={() => setStep("verify")} disabled={busy !== null}>Back to product details</Button>
          <Button variant="primary" onClick={generatePlan} disabled={busy !== null}>Generate Review Plan</Button>
        </div>
        {renderModals()}
      </div>
    );
  }

  return (
    <div className="st-product-review">
      {renderStepNav()}
      <section className="st-product-review-intro">
        <Badge tone="signal">3 · Review</Badge>
        <h3>{plan?.hook ?? "Review Plan"}</h3>
        <p>Edit every line and Shot before applying it to the Project.</p>
        {brief?.imageUrl && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "10px 0" }}>
            <img
              src={brief.imageUrl}
              alt={brief.title}
              referrerPolicy="no-referrer"
              style={{
                width: 52,
                height: 52,
                objectFit: "contain",
                borderRadius: 6,
                background: "#ffffff",
                padding: 2,
                border: "1px solid var(--line)",
                flexShrink: 0,
              }}
              onError={(e) => {
                (e.target as HTMLElement).style.display = "none";
              }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong style={{ color: "var(--ink)", fontSize: 13 }}>{brief.title}</strong>
              {brief.brand && <div style={{ color: "var(--ink-2)", fontSize: 11, marginTop: 2 }}>Brand: {brief.brand}</div>}
            </div>
          </div>
        )}
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
        {(plan?.script ?? []).map((segment, index) => {
          const shot = plan?.shots.find((item) => item.id === segment.shotId);
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
                  <Button variant="quiet" size="small" onClick={() => moveScript(index, 1)} disabled={index === (plan?.script.length ?? 0) - 1} aria-label={`Move ${segment.purpose} later`}>↓</Button>
                </div>
              </header>
              <TextareaField label="Script line" copyable rows={3} value={segment.text} onChange={(event) => updateScript(segment.id, { text: event.target.value })} />
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
        <Button variant="quiet" onClick={() => { setStatus("Plan saved for later."); onClose?.(); }}>Save for later</Button>
        <Button variant="secondary" onClick={() => setStep("verify")}>Edit details</Button>
        <Button variant="secondary" onClick={() => setStep("generate")}>Regenerate plan</Button>
        <Button variant="primary" onClick={applyPlan} disabled={!plan}>Apply to Project</Button>
      </div>
      {renderModals()}
    </div>
  );
}
