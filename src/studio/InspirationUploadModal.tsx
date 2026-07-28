import { useState, useCallback, useRef, useEffect } from "react";
import type { ProjectTemplate, TemplateBeat, ColorAdjustments } from "../domain/types";
import { analyzeInspirationVideo } from "../features/templates/inspireTemplate";
import { saveTemplate } from "../lib/projectStorage";
import {
  AI_PROVIDER_OPTIONS,
  CODEX_MODEL_OPTIONS,
  MODEL_OPTIONS,
  useSettings,
  type AiProvider,
} from "../state/SettingsContext";
import { ControlButton, InputControl, SelectControl } from "../design-system/ControlPrimitives";
import { ModalScrim, ModalSurface } from "../design-system/ModalPrimitives";
import CloseIcon from "../design-system/icons/CloseIcon";
import CloseButton from "../design-system/CloseButton";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSaved: (template: ProjectTemplate) => void;
}

type Phase = "drop" | "analyzing" | "review" | "saving" | "done";

function XIcon() {
  return <CloseIcon size={15} />;
}

function sliderTrackStyle(val: number, min = -100, max = 100): React.CSSProperties {
  const pct = Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100));
  return {
    flex: 1,
    width: "100%",
    accentColor: "var(--accent)",
    background: `linear-gradient(to right, var(--accent) 0%, var(--accent) ${pct}%, var(--panel-3) ${pct}%, var(--panel-3) 100%)`,
    height: 6,
    borderRadius: 3,
    cursor: "pointer",
  };
}

function ColorSliderRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontSize: 11, width: 70, color: "var(--ink-2)", flexShrink: 0 }}>{label}</span>
      <InputControl
        type="range"
        min={-100}
        max={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={sliderTrackStyle(value)}
      />
      <span style={{ fontSize: 10, width: 32, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
        {value > 0 ? `+${value}` : value}
      </span>
    </div>
  );
}

export default function InspirationUploadModal({ isOpen, onClose, onSaved }: Props) {
  const { settings } = useSettings();
  const [aiProvider, setAiProvider] = useState<AiProvider>(settings.aiProvider);
  const [claudeModel, setClaudeModel] = useState(settings.analyzeModel);
  const [codexModel, setCodexModel] = useState<string>(CODEX_MODEL_OPTIONS[0]);
  const [phase, setPhase] = useState<Phase>("drop");
  const [progressMsg, setProgressMsg] = useState("");
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<ProjectTemplate | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset on open
  useEffect(() => {
    if (isOpen) {
      setPhase("drop");
      setProgressMsg("");
      setError("");
      setDraft(null);
      setAiProvider(settings.aiProvider);
      setClaudeModel(settings.analyzeModel);
      setCodexModel(CODEX_MODEL_OPTIONS[0]);
    }
  }, [isOpen, settings.aiProvider, settings.analyzeModel]);

  // Esc to close
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  const processFile = useCallback(async (file: File) => {
    if (!file.type.startsWith("video/")) {
      setError("Please upload a video file (MP4, MOV, WebM, etc.)");
      return;
    }
    setError("");
    setPhase("analyzing");
    try {
      const cfg = aiProvider === "codex"
        ? { provider: aiProvider, codexModel }
        : { provider: aiProvider, model: claudeModel };
      const template = await analyzeInspirationVideo(file, cfg, (step) => setProgressMsg(step));
      setDraft(template);
      setPhase("review");
    } catch (err) {
      console.error("Inspiration analysis failed:", err);
      setError(err instanceof Error ? err.message : "Analysis failed. Please try again.");
      setPhase("drop");
    }
  }, [aiProvider, claudeModel, codexModel]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, [processFile]);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = "";
  };

  const handleSave = async () => {
    if (!draft) return;
    setPhase("saving");
    try {
      await saveTemplate(draft);
      setPhase("done");
      onSaved(draft);
    } catch (err) {
      console.error("Failed to save template:", err);
      setError("Could not save template. Please try again.");
      setPhase("review");
    }
  };

  // -- Draft edit helpers --
  const updateBeat = (i: number, patch: Partial<TemplateBeat>) =>
    setDraft((d) => d ? { ...d, beats: d.beats.map((b, idx) => idx === i ? { ...b, ...patch } : b) } : d);

  const addBeat = () =>
    setDraft((d) => d ? { ...d, beats: [...d.beats, { description: "New shot" }] } : d);

  const removeBeat = (i: number) =>
    setDraft((d) => d ? { ...d, beats: d.beats.filter((_, idx) => idx !== i) } : d);

  const updateColor = (key: keyof ColorAdjustments, val: number) =>
    setDraft((d) => d ? { ...d, colorHint: { ...d.colorHint, [key]: val } } : d);

  if (!isOpen) return null;

  return (
    <ModalScrim
      onClick={onClose}
      style={{ zIndex: 1100 }}
    >
      <ModalSurface
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(600px, 100%)",
          maxHeight: "90vh",
        }}
      >
        <header className="ui-modal-head">
          <div className="ui-modal-heading">
            <h2>Create Template from Video</h2>
            <p>
              Upload a reference video. The selected AI will extract its edit structure as a reusable template.
            </p>
          </div>
          <CloseButton onClick={onClose} label="Close template creator" />
        </header>

        {/* Body */}
        <div className="ui-modal-body">

          {/* ── DROP PHASE ── */}
          {(phase === "drop") && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-2)" }}>AI ENGINE</span>
                  <SelectControl
                    value={aiProvider}
                    onChange={(event) => setAiProvider(event.target.value as AiProvider)}
                    style={{ width: "100%" }}
                  >
                    {AI_PROVIDER_OPTIONS.map((provider) => (
                      <option key={provider.id} value={provider.id}>{provider.label}</option>
                    ))}
                  </SelectControl>
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-2)" }}>MODEL</span>
                  <SelectControl
                    value={aiProvider === "claude" ? claudeModel : codexModel}
                    onChange={(event) => {
                      if (aiProvider === "claude") setClaudeModel(event.target.value);
                      else setCodexModel(event.target.value);
                    }}
                    style={{ width: "100%" }}
                  >
                    {(aiProvider === "claude" ? MODEL_OPTIONS : CODEX_MODEL_OPTIONS).map((model) => (
                      <option key={model} value={model}>{model.replace(/^claude-/, "")}</option>
                    ))}
                  </SelectControl>
                </label>
              </div>
              <div
                onDragEnter={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragOver={(e) => e.preventDefault()}
                onDragLeave={() => setIsDragging(false)}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
                style={{
                  border: `2px dashed ${isDragging ? "var(--accent)" : "var(--line)"}`,
                  borderRadius: 12,
                  padding: "42px 24px",
                  textAlign: "center",
                  cursor: "pointer",
                  transition: "border-color 0.15s, background 0.15s",
                  background: isDragging ? "color-mix(in srgb, var(--accent) 8%, transparent)" : "var(--panel)",
                }}
              >
                <div style={{ fontSize: 36, marginBottom: 12 }}>🎬</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)", marginBottom: 6 }}>
                  Drop an inspiration video here
                </div>
                <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
                  MP4, MOV, or WebM. Choose any video whose edit style you want to replicate.
                </div>
                <ControlButton
                  className="st-btn ghost"
                  style={{ marginTop: 16, fontSize: 12 }}
                  onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                >
                  Browse files
                </ControlButton>
                <InputControl
                  ref={fileInputRef}
                  type="file"
                  accept="video/*"
                  onChange={onFileChange}
                  style={{ display: "none" }}
                />
              </div>
            </div>
          )}

          {/* ── ANALYZING PHASE ── */}
          {phase === "analyzing" && (
            <div style={{ textAlign: "center", padding: "48px 24px" }}>
              <div style={{
                width: 48, height: 48, borderRadius: "50%",
                border: "3px solid var(--panel-3)",
                borderTopColor: "var(--accent)",
                margin: "0 auto 20px",
                animation: "spin 0.8s linear infinite",
              }} />
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)", marginBottom: 6 }}>
                Analyzing video…
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{progressMsg}</div>
            </div>
          )}

          {/* ── REVIEW PHASE ── */}
          {(phase === "review" || phase === "saving") && draft && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

              {/* Template Name */}
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-2)", display: "block", marginBottom: 6 }}>
                  TEMPLATE NAME
                </label>
                <InputControl
                  value={draft.name}
                  onChange={(e) => setDraft((d) => d ? { ...d, name: e.target.value } : d)}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    background: "var(--panel)",
                    border: "1px solid var(--line)",
                    borderRadius: 8,
                    color: "var(--ink)",
                    fontSize: 13,
                    fontWeight: 600,
                    boxSizing: "border-box",
                  }}
                />
              </div>

              {/* Tone Hint */}
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-2)", display: "block", marginBottom: 6 }}>
                  TONE / ENERGY
                </label>
                <InputControl
                  value={draft.toneHint ?? ""}
                  placeholder="e.g. fast-paced urban energy"
                  onChange={(e) => setDraft((d) => d ? { ...d, toneHint: e.target.value } : d)}
                  style={{
                    width: "100%",
                    padding: "7px 12px",
                    background: "var(--panel)",
                    border: "1px solid var(--line)",
                    borderRadius: 8,
                    color: "var(--ink)",
                    fontSize: 12,
                    boxSizing: "border-box",
                  }}
                />
              </div>

              {/* Beats */}
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-2)" }}>
                    BEAT STRUCTURE ({draft.beats.length} beats)
                  </label>
                  <ControlButton
                    className="st-btn ghost"
                    style={{ fontSize: 10, padding: "3px 10px" }}
                    onClick={addBeat}
                  >
                    + Add Beat
                  </ControlButton>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {draft.beats.map((beat, i) => (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        background: "var(--panel)",
                        border: "1px solid var(--line)",
                        borderRadius: 8,
                        padding: "8px 10px",
                      }}
                    >
                      <span style={{ fontSize: 11, color: "var(--ink-3)", width: 20, flexShrink: 0, textAlign: "right" }}>
                        {i + 1}.
                      </span>
                      <InputControl
                        value={beat.description}
                        onChange={(e) => updateBeat(i, { description: e.target.value })}
                        placeholder="Describe this shot type…"
                        style={{
                          flex: 1,
                          background: "none",
                          border: "none",
                          color: "var(--ink)",
                          fontSize: 12,
                          outline: "none",
                        }}
                      />
                      {beat.approxDurationSec != null && (
                        <span style={{ fontSize: 10, color: "var(--ink-3)", flexShrink: 0 }}>
                          ~{beat.approxDurationSec}s
                        </span>
                      )}
                      <ControlButton
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => removeBeat(i)}
                        disabled={draft.beats.length <= 2}
                        title="Remove beat"
                        style={{
                          background: "none",
                          border: "none",
                          cursor: draft.beats.length <= 2 ? "not-allowed" : "pointer",
                          color: "var(--ink-3)",
                          padding: 2,
                          display: "flex",
                          opacity: draft.beats.length <= 2 ? 0.3 : 1,
                        }}
                      >
                        <XIcon />
                      </ControlButton>
                    </div>
                  ))}
                </div>
              </div>

              {/* Color Hint */}
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-2)", display: "block", marginBottom: 8 }}>
                  COLOR IMPRESSION
                </label>
                <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 8, padding: 12 }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {(["warmth", "saturation", "contrast", "shadows", "highlights"] as const).map((key) => (
                      <ColorSliderRow
                        key={key}
                        label={key.charAt(0).toUpperCase() + key.slice(1)}
                        value={draft.colorHint?.[key] ?? 0}
                        onChange={(v) => updateColor(key, v)}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* Aspect + meta */}
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 11, color: "var(--ink-3)" }}>Aspect:</span>
                {(["16:9", "9:16", "1:1"] as const).map((a) => (
                  <ControlButton
                    key={a}
                    className={`st-btn ${draft.aspect === a ? "primary" : "ghost"}`}
                    style={{ fontSize: 10, padding: "3px 10px" }}
                    onClick={() => setDraft((d) => d ? { ...d, aspect: a } : d)}
                  >
                    {a}
                  </ControlButton>
                ))}
              </div>
            </div>
          )}

          {/* ── DONE PHASE ── */}
          {phase === "done" && (
            <div style={{ textAlign: "center", padding: "48px 24px" }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>
                Template saved!
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 4 }}>
                "{draft?.name}" is ready to use in your next project.
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div style={{
              marginTop: 12,
              padding: "10px 12px",
              background: "color-mix(in srgb, var(--danger) 12%, transparent)",
              border: "1px solid var(--danger)",
              borderRadius: 8,
              fontSize: 12,
              color: "var(--danger)",
            }}>
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        {(phase === "review" || phase === "saving") && (
          <footer className="ui-modal-footer">
            <ControlButton className="st-btn ghost" onClick={onClose} style={{ fontSize: 12 }}>
              Cancel
            </ControlButton>
            <ControlButton
              className="st-btn primary"
              onClick={handleSave}
              disabled={phase === "saving" || !draft?.name.trim() || draft.beats.length < 2}
              style={{ fontSize: 12 }}
            >
              {phase === "saving" ? "Saving…" : "Save Template"}
            </ControlButton>
          </footer>
        )}

        {phase === "done" && (
          <footer className="ui-modal-footer">
            <ControlButton className="st-btn primary" onClick={onClose} style={{ fontSize: 12 }}>
              Done
            </ControlButton>
          </footer>
        )}
      </ModalSurface>
    </ModalScrim>
  );
}
