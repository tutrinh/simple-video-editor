import { useEffect, useMemo, useState } from "react";
import type {
  GenerateMotivationalStoryInput,
  MotivationalShot,
  MotivationalStoryPlan,
  MotivationalStoryWorkspace,
  SavedMotivationalPlanItem,
} from "../domain/motivationalStory";
import {
  AUTO_PERSONA_ID,
  CUSTOM_PERSONA_ID,
  MOTIVATIONAL_PERSONAS,
  POV_OPTIONS,
  personaById,
  resolvePersona,
  type CustomPersonaDraft,
  type MotivationalPov,
} from "../domain/motivationalPersona";
import {
  DEFAULT_MOTIVATIONAL_PROMPT,
  findGenericScriptLines,
  generateMotivationalStoryPlan,
  type ReviewAuthorAdapter,
} from "../features/motivational-story/storyAuthor";
import {
  applyMotivationalStoryPlan,
  fitMotivationalStoryVoiceoversToLength,
} from "../features/motivational-story/applyMotivationalStoryPlan";
import {
  deleteSavedMotivationalPlan,
  getSavedMotivationalPlans,
  saveMotivationalPlanToHistory,
} from "../lib/savedMotivationalPlans";
import Button from "../design-system/Button";
import Badge from "../design-system/Badge";
import SegmentedControl from "../design-system/SegmentedControl";
import { SelectField, TextareaField } from "../design-system/Field";
import { ProgressNotice } from "../design-system/Feedback";
import Modal from "../design-system/Modal";
import { useProject } from "../state/ProjectContext";
import {
  CODEX_MODEL_OPTIONS,
  MODEL_OPTIONS,
  SCRIPT_TYPE_OPTIONS,
  TONE_OPTIONS,
  scriptTypeHint,
  toneHint,
  useSettings,
} from "../state/SettingsContext";
import { useExportSettings } from "../state/ExportSettingsContext";
import { synthesizeVoiceover } from "../lib/tts";

type StoryStep = "prompt" | "generate" | "plan";
type DurationOption = "15" | "30" | "45" | "60";

const EMPTY_CUSTOM_PERSONA: CustomPersonaDraft = {
  speaker: "",
  audience: "",
  pov: "first-person",
  world: "",
  vernacular: "",
};

interface Props {
  author?: ReviewAuthorAdapter;
  onClose?: () => void;
  onApplied?: (targetBeatId: string | null) => void;
}

export default function MotivationalStoryView({ author, onClose, onApplied }: Props) {
  const { state, dispatch } = useProject();
  const { settings, update: updateSettings } = useSettings();
  const { settings: exportSettings } = useExportSettings();

  const workspace: MotivationalStoryWorkspace | undefined = state.motivationalStory;

  const [step, setStep] = useState<StoryStep>(
    workspace?.plan ? "plan" : "prompt"
  );
  const [prompt, setPrompt] = useState(
    workspace?.prompt || DEFAULT_MOTIVATIONAL_PROMPT
  );
  const [duration, setDuration] = useState<DurationOption>(
    (String(workspace?.targetDurationSec ?? 30) as DurationOption) || "30"
  );
  const [creatorNotes, setCreatorNotes] = useState(workspace?.creatorNotes || "");
  const [plan, setPlan] = useState<MotivationalStoryPlan | undefined>(workspace?.plan);

  const [personaId, setPersonaId] = useState(workspace?.personaId || AUTO_PERSONA_ID);
  const [pov, setPov] = useState<MotivationalPov | "">(workspace?.pov || "");
  const [customPersona, setCustomPersona] = useState<CustomPersonaDraft>(
    workspace?.customPersona || EMPTY_CUSTOM_PERSONA
  );

  const selectedPreset = personaById(personaId);
  const effectivePov: MotivationalPov =
    pov || selectedPreset?.pov || (personaId === CUSTOM_PERSONA_ID ? customPersona.pov : "first-person");

  const [busy, setBusy] = useState<"generate" | "apply" | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const availableModels = settings.aiProvider === "codex" ? CODEX_MODEL_OPTIONS : MODEL_OPTIONS;

  useEffect(() => {
    if (!busy) {
      setElapsedSec(0);
      return;
    }
    const timer = setInterval(() => setElapsedSec((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [busy]);

  // Advisory only: highlights beats that fell back to stock phrasing or carry no
  // concrete anchor, so a weak line gets caught before it reaches the timeline.
  const genericLineIds = useMemo(() => {
    if (!plan) return new Map<string, "banned-phrase" | "no-concrete-detail">();
    return new Map(findGenericScriptLines(plan).map((f) => [f.lineId, f.reason]));
  }, [plan]);

  const clipSummaries = useMemo(
    () =>
      state.clips.map((clip) => ({
        id: clip.id,
        name: clip.name,
        durationSec: clip.durationSec,
      })),
    [state.clips]
  );

  /** The workspace as the drawer currently stands, so persona/duration survive every dispatch. */
  function buildWorkspace(nextPlan?: MotivationalStoryPlan): MotivationalStoryWorkspace {
    return {
      prompt: prompt.trim(),
      plan: nextPlan,
      creatorNotes: creatorNotes.trim() || undefined,
      personaId,
      pov: pov || undefined,
      customPersona: personaId === CUSTOM_PERSONA_ID ? customPersona : undefined,
      targetDurationSec: Number(duration),
    };
  }

  async function handleGeneratePlan() {
    if (!prompt.trim()) {
      setError("Please type a motivational prompt before generating.");
      return;
    }

    setBusy("generate");
    setError("");
    setStatus(`Asking ${settings.aiProvider === "claude" ? "Claude CLI" : "Codex CLI"} for a motivational story plan…`);

    try {
      const adapter: ReviewAuthorAdapter =
        author ||
        (async (authorPrompt: string) => {
          const ep = settings.aiProvider === "codex" ? "/api/codex" : "/api/claude";
          const res = await fetch(ep, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ prompt: authorPrompt, model: settings.authorModel }),
          });
          const data = (await res.json()) as { text?: string; error?: string };
          if (!res.ok || data.error) {
            throw new Error(data.error || `HTTP ${res.status}`);
          }
          return data.text || "";
        });

      const input: GenerateMotivationalStoryInput = {
        prompt: prompt.trim(),
        targetDurationSec: Number(duration),
        tone: toneHint(settings.tone),
        scriptType: scriptTypeHint(settings.scriptType),
        creatorNotes: creatorNotes.trim() || undefined,
        aiProvider: settings.aiProvider,
        authorModel: settings.authorModel,
        aspect: state.cut?.aspect || "9:16",
        persona: resolvePersona(personaId, customPersona, pov || undefined),
      };

      const generated = await generateMotivationalStoryPlan(input, state.clips, adapter);
      setPlan(generated);

      const nextWorkspace: MotivationalStoryWorkspace = buildWorkspace(generated);

      dispatch({ type: "SET_MOTIVATIONAL_STORY", workspace: nextWorkspace });
      saveMotivationalPlanToHistory(nextWorkspace);

      setStep("plan");
      setStatus(`Generated ${generated.shots.length}-shot motivational plan.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  function applyPlan() {
    if (!plan) return;
    if (plan.script.some((line) => !line.text.trim()) || plan.shots.some((shot) => !shot.description.trim())) {
      setError("Every Script line and Shot description needs text before applying.");
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
      const rawApplied = applyMotivationalStoryPlan(plan, state.clips, state.cut?.aspect || "9:16");
      dispatch({ type: "APPLY_TEMPLATE", cut: rawApplied.cut, placeholderClips: rawApplied.placeholderClips });
      dispatch({ type: "SET_STORY", story: rawApplied.story });
      setReplaceOpen(false);
      onApplied?.(rawApplied.cut.beats[0]?.id ?? null);
      setStatus(`Applied ${rawApplied.cut.beats.length} motivational shots to the Project.`);

      fitMotivationalStoryVoiceoversToLength(rawApplied, (text) =>
        synthesizeVoiceover(text, {
          engine: exportSettings.ttsEngine,
          voice: exportSettings.voice,
          elevenVoiceId: exportSettings.elevenVoiceId,
          speed: exportSettings.voiceoverSpeed,
          elevenModel: exportSettings.elevenModel,
          elevenStability: exportSettings.elevenStability,
          elevenStyle: exportSettings.elevenStyle,
        })
      )
        .then((fitted) => {
          if (fitted.cut !== rawApplied.cut) {
            dispatch({ type: "SET_CUT", cut: fitted.cut });
          }
        })
        .catch(() => {
          // Graceful fallback
        });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  function updateScriptLine(id: string, text: string) {
    if (!plan) return;
    const updatedScript = plan.script.map((line) => (line.id === id ? { ...line, text } : line));
    const updatedPlan = { ...plan, script: updatedScript };
    setPlan(updatedPlan);
    dispatch({ type: "SET_MOTIVATIONAL_STORY", workspace: buildWorkspace(updatedPlan) });
  }

  function updateShot(id: string, updates: Partial<MotivationalShot>) {
    if (!plan) return;
    const updatedShots = plan.shots.map((shot) => (shot.id === id ? { ...shot, ...updates } : shot));
    const updatedPlan = { ...plan, shots: updatedShots };
    setPlan(updatedPlan);
    dispatch({ type: "SET_MOTIVATIONAL_STORY", workspace: buildWorkspace(updatedPlan) });
  }

  function restoreHistoryPlan(item: SavedMotivationalPlanItem) {
    const ws = item.workspace;
    setPrompt(ws.prompt || item.prompt);
    setCreatorNotes(ws.creatorNotes || "");
    setPlan(ws.plan);
    // Restore the steer the plan was written under, not just the plan text — otherwise
    // "Regenerate" from a restored plan silently authors under a different persona.
    setPersonaId(ws.personaId || AUTO_PERSONA_ID);
    setPov(ws.pov || "");
    setCustomPersona(ws.customPersona || EMPTY_CUSTOM_PERSONA);
    if (ws.targetDurationSec) {
      setDuration(String(ws.targetDurationSec) as DurationOption);
    } else if (ws.plan?.targetDurationSec) {
      setDuration(String(ws.plan.targetDurationSec) as DurationOption);
    }
    dispatch({ type: "LOAD_MOTIVATIONAL_STORY", workspace: ws });
    setHistoryOpen(false);
    setStep(ws.plan ? "plan" : "prompt");
    setStatus(`Restored saved plan from ${new Date(item.savedAt).toLocaleTimeString()}`);
  }

  const renderStepNav = () => (
    <div style={{ display: "flex", gap: "6px", marginBottom: "14px", flexWrap: "wrap" }}>
      <Button
        variant={step === "prompt" ? "primary" : "secondary"}
        size="small"
        onClick={() => setStep("prompt")}
        disabled={busy !== null}
      >
        1 · Prompt & Settings
      </Button>
      <Button
        variant={step === "plan" ? "primary" : "secondary"}
        size="small"
        onClick={() => setStep("plan")}
        disabled={busy !== null || !plan}
      >
        2 · Review & Edit Plan
      </Button>
      <Button
        variant="secondary"
        size="small"
        onClick={() => setHistoryOpen(true)}
        disabled={busy !== null}
        title="View previously saved motivational plans"
      >
        📜 Saved Plans
      </Button>
    </div>
  );

  return (
    <div className="st-product-review-container" style={{ padding: "16px", height: "100%", overflowY: "auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "var(--ink)" }}>🔥 Motivational Story</h2>
          <p style={{ margin: "2px 0 0", fontSize: "12px", color: "var(--ink-2)" }}>
            AI-generated motivational Reel scripts, shot lists & voiceovers
          </p>
        </div>
        {onClose && (
          <Button variant="quiet" size="small" onClick={onClose} aria-label="Close Motivational Story">
            ✕
          </Button>
        )}
      </div>

      {renderStepNav()}

      {error && (
        <div
          style={{
            padding: "8px 12px",
            background: "rgba(255, 68, 68, 0.1)",
            border: "1px solid var(--danger)",
            borderRadius: "6px",
            color: "var(--danger)",
            fontSize: "12px",
            marginBottom: "12px",
          }}
        >
          ⚠️ {error}
        </div>
      )}

      {status && !error && (
        <div
          style={{
            padding: "6px 10px",
            background: "var(--panel-2)",
            border: "1px solid var(--line)",
            borderRadius: "6px",
            color: "var(--ink-2)",
            fontSize: "11px",
            marginBottom: "12px",
          }}
        >
          {status}
        </div>
      )}

      {step === "prompt" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
              <Button
                variant="quiet"
                size="small"
                onClick={() => setPrompt(DEFAULT_MOTIVATIONAL_PROMPT)}
                style={{ fontSize: "11px", marginLeft: "auto" }}
              >
                Reset to Default
              </Button>
            </div>
            <TextareaField
              label="Motivational Prompt"
              rows={4}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe your story idea or reel theme…"
            />
          </div>

          <div>
            <label style={{ fontSize: "12px", fontWeight: 600, color: "var(--ink)", display: "block", marginBottom: "6px" }}>
              Target Duration
            </label>
            <SegmentedControl
              ariaLabel="Target duration"
              options={[
                { value: "15", label: "15s" },
                { value: "30", label: "30s" },
                { value: "45", label: "45s" },
                { value: "60", label: "60s" },
              ]}
              value={duration}
              onChange={(val) => setDuration(val)}
            />
          </div>

          <div
            style={{
              padding: "12px",
              background: "var(--panel-2)",
              borderRadius: "8px",
              border: "1px solid var(--line)",
              display: "flex",
              flexDirection: "column",
              gap: "10px",
            }}
          >
            <div>
              <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--ink)" }}>
                🎭 Whose story is this?
              </span>
              <p style={{ margin: "2px 0 0", fontSize: "11px", color: "var(--ink-3)" }}>
                A named speaker with a concrete world is what stops the script reading like every
                other motivational reel.
              </p>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "8px" }}>
              <SelectField
                label="Persona"
                value={personaId}
                onChange={(e) => {
                  setPersonaId(e.target.value);
                  setPov("");
                }}
              >
                <option value={AUTO_PERSONA_ID}>Auto — let the AI invent one</option>
                {MOTIVATIONAL_PERSONAS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
                <option value={CUSTOM_PERSONA_ID}>Custom — describe your own</option>
              </SelectField>

              <SelectField
                label="Point of view"
                value={effectivePov}
                onChange={(e) => setPov(e.target.value as MotivationalPov)}
                disabled={personaId === AUTO_PERSONA_ID}
                help={personaId === AUTO_PERSONA_ID ? "Chosen by the AI" : undefined}
              >
                {POV_OPTIONS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </SelectField>
            </div>

            {selectedPreset && (
              <div
                style={{
                  padding: "8px 10px",
                  background: "var(--panel)",
                  border: "1px solid var(--line)",
                  borderRadius: "6px",
                  fontSize: "11px",
                  color: "var(--ink-2)",
                  lineHeight: 1.5,
                }}
              >
                <div>{selectedPreset.speaker}</div>
                <div style={{ marginTop: "4px", color: "var(--ink-3)" }}>
                  Spoken to: {selectedPreset.audience}
                </div>
                <div style={{ marginTop: "4px", color: "var(--ink-3)" }}>
                  Told through: {selectedPreset.world.slice(0, 3).join(" · ")}
                </div>
              </div>
            )}

            {personaId === CUSTOM_PERSONA_ID && (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <TextareaField
                  label="Who is speaking?"
                  rows={2}
                  value={customPersona.speaker}
                  onChange={(e) => setCustomPersona((c) => ({ ...c, speaker: e.target.value }))}
                  placeholder="e.g. A 34-year-old line cook taking 6AM classes before their shift"
                  help="An age and a situation beat a job title."
                />
                <TextareaField
                  label="Who are they talking to?"
                  rows={2}
                  value={customPersona.audience}
                  onChange={(e) => setCustomPersona((c) => ({ ...c, audience: e.target.value }))}
                  placeholder="e.g. Someone who's been talked out of retraining twice"
                  help="One person in one situation — not 'everyone'."
                />
                <TextareaField
                  label="Their world — concrete details, comma separated"
                  rows={2}
                  value={customPersona.world}
                  onChange={(e) => setCustomPersona((c) => ({ ...c, world: e.target.value }))}
                  placeholder="e.g. burn scars on a forearm, a 5:10 bus, textbooks in a locker"
                  help="Objects, hours, places, sensations. This is what the script gets built from."
                />
                <TextareaField
                  label="How they talk (optional)"
                  rows={2}
                  value={customPersona.vernacular}
                  onChange={(e) => setCustomPersona((c) => ({ ...c, vernacular: e.target.value }))}
                  placeholder="e.g. Blunt, kitchen slang, never sentimental"
                />
              </div>
            )}
          </div>

          <div
            style={{
              padding: "12px",
              background: "var(--panel-2)",
              borderRadius: "8px",
              border: "1px solid var(--line)",
              display: "flex",
              flexDirection: "column",
              gap: "10px",
            }}
          >
            <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--ink)" }}>
              🤖 AI Engine & Tone Settings
            </span>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
              <SelectField
                label="AI Engine"
                value={settings.aiProvider}
                onChange={(e) => updateSettings({ aiProvider: e.target.value as "claude" | "codex" })}
              >
                <option value="claude">Claude Code CLI</option>
                <option value="codex">Codex CLI</option>
              </SelectField>

              <SelectField
                label="AI Model"
                value={settings.authorModel}
                onChange={(e) => updateSettings({ authorModel: e.target.value })}
              >
                {availableModels.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </SelectField>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
              {/* Tone and Format are shared settings holding *ids* that every AI feature
                  resolves through toneHint()/scriptTypeHint(). This drawer used to write
                  display labels straight into them, which dropped its own steer and
                  silently emptied the steer for AI Story and Product Review too. */}
              <SelectField
                label="Tone / Voice"
                value={settings.tone}
                onChange={(e) => updateSettings({ tone: e.target.value })}
              >
                {TONE_OPTIONS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </SelectField>

              <SelectField
                label="Format"
                value={settings.scriptType}
                onChange={(e) => updateSettings({ scriptType: e.target.value })}
              >
                {SCRIPT_TYPE_OPTIONS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </SelectField>
            </div>
          </div>

          <TextareaField
            label="Additional Notes / Target Audience (Optional)"
            rows={2}
            value={creatorNotes}
            onChange={(e) => setCreatorNotes(e.target.value)}
            placeholder="e.g. Focus on gym discipline, college grads, entrepreneurship…"
          />

          {busy === "generate" && (
            <ProgressNotice
              title="Crafting Motivational Story"
              message={`Generating structured beats & script lines via ${settings.aiProvider === "claude" ? "Claude CLI" : "Codex CLI"} (${elapsedSec}s)…`}
            />
          )}

          <Button
            variant="primary"
            size="small"
            onClick={handleGeneratePlan}
            disabled={busy !== null || !prompt.trim()}
          >
            {busy === "generate" ? "Generating Plan…" : "⚡ Generate Story Plan"}
          </Button>
        </div>
      )}

      {step === "plan" && plan && (
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <div
            style={{
              padding: "12px",
              background: "var(--panel-2)",
              borderRadius: "8px",
              border: "1px solid var(--line)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div style={{ minWidth: 0, paddingRight: "8px" }}>
              <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 700, color: "var(--ink)" }}>{plan.title}</h3>
              <p style={{ margin: "2px 0 0", fontSize: "11px", color: "var(--ink-2)" }}>
                Hook: "{plan.hook}" · {plan.shots.length} beats (~{plan.targetDurationSec}s)
              </p>
              {plan.persona && (
                <p style={{ margin: "4px 0 0", fontSize: "11px", color: "var(--ink-3)" }}>
                  🎭 {plan.persona}
                </p>
              )}
              {plan.incident && (
                <p style={{ margin: "2px 0 0", fontSize: "11px", color: "var(--ink-3)" }}>
                  📍 {plan.incident}
                </p>
              )}
            </div>
            <Badge>{settings.aiProvider === "claude" ? "Claude" : "Codex"}</Badge>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {plan.shots.map((shot, i) => {
              const line = plan.script[i];
              return (
                <div
                  key={shot.id}
                  style={{
                    padding: "10px 12px",
                    background: "var(--panel-2)",
                    borderRadius: "6px",
                    border: "1px solid var(--line)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--accent)" }}>
                      Beat {i + 1} · {line?.purpose?.toUpperCase() || "ACTION"}
                    </span>
                    <span style={{ fontSize: "11px", color: "var(--ink-3)" }}>
                      ~{shot.approxDurationSec}s
                    </span>
                  </div>

                  {line && (
                    <TextareaField
                      label="Script line"
                      copyable
                      rows={2}
                      value={line.text}
                      onChange={(e) => updateScriptLine(line.id, e.target.value)}
                      help={
                        line && genericLineIds.has(line.id)
                          ? genericLineIds.get(line.id) === "banned-phrase"
                            ? "⚠️ Reads generic — this is a stock motivational phrase."
                            : "⚠️ Reads generic — no concrete detail to hold on to."
                          : line?.concreteDetail
                            ? `Built on: ${line.concreteDetail}`
                            : undefined
                      }
                    />
                  )}

                  <TextareaField
                    label="Shot description"
                    rows={2}
                    value={shot.description}
                    onChange={(e) => updateShot(shot.id, { description: e.target.value })}
                  />

                  <SelectField
                    label="Match existing Clip"
                    value={shot.matchedClipId ?? ""}
                    onChange={(e) => updateShot(shot.id, { matchedClipId: e.target.value || undefined })}
                  >
                    <option value="">Missing footage · create placeholder</option>
                    {clipSummaries.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.durationSec.toFixed(1)}s)
                      </option>
                    ))}
                  </SelectField>
                </div>
              );
            })}
          </div>

          <div style={{ display: "flex", gap: "8px" }}>
            <Button variant="secondary" size="small" onClick={handleGeneratePlan} disabled={busy !== null}>
              🔄 Regenerate Plan
            </Button>
            <Button variant="primary" size="small" onClick={applyPlan} disabled={busy !== null}>
              🚀 Apply to Project
            </Button>
          </div>
        </div>
      )}

      <Modal
        open={replaceOpen}
        title="Replace the current Story and Cut?"
        onClose={() => setReplaceOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setReplaceOpen(false)}>
              Keep current Cut
            </Button>
            <Button variant="primary" onClick={commitPlan}>
              Replace with Motivational Cut
            </Button>
          </>
        }
      >
        <p style={{ margin: 0, fontSize: "13px", color: "var(--ink-2)" }}>
          Applying this motivational story will replace your current timeline beats and voiceovers.
          Source clips in your project will remain safe.
        </p>
      </Modal>

      <Modal
        open={historyOpen}
        title="Saved Motivational Plans"
        onClose={() => setHistoryOpen(false)}
        footer={
          <Button variant="secondary" onClick={() => setHistoryOpen(false)}>
            Close
          </Button>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "350px", overflowY: "auto" }}>
          {getSavedMotivationalPlans().length === 0 ? (
            <p style={{ margin: 0, fontSize: "12px", color: "var(--ink-3)" }}>
              No saved motivational plans yet. Generated plans will automatically be saved here.
            </p>
          ) : (
            getSavedMotivationalPlans().map((item) => (
              <div
                key={item.id}
                style={{
                  padding: "8px 10px",
                  background: "var(--panel-2)",
                  borderRadius: "6px",
                  border: "1px solid var(--line)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div style={{ flex: 1, minWidth: 0, paddingRight: "8px" }}>
                  <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {item.workspace.plan?.title || item.prompt}
                  </div>
                  <div style={{ fontSize: "10px", color: "var(--ink-3)" }}>
                    {new Date(item.savedAt).toLocaleDateString()} {new Date(item.savedAt).toLocaleTimeString()}
                  </div>
                </div>
                <div style={{ display: "flex", gap: "4px" }}>
                  <Button variant="secondary" size="small" onClick={() => restoreHistoryPlan(item)}>
                    Load
                  </Button>
                  <Button
                    variant="quiet"
                    size="small"
                    onClick={() => {
                      deleteSavedMotivationalPlan(item.id);
                      setHistoryOpen(true); // force re-render
                    }}
                  >
                    🗑️
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </Modal>
    </div>
  );
}
