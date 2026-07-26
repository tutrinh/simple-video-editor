import { useState, useCallback, useRef, useEffect } from "react";
import type { ProjectTemplate, TemplateBeat, ColorAdjustments } from "../domain/types";
import { analyzeInspirationVideo } from "../features/templates/inspireTemplate";
import { saveTemplate } from "../lib/projectStorage";
import { useSettings } from "../state/SettingsContext";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSaved: (template: ProjectTemplate) => void;
}

type Phase = "drop" | "analyzing" | "review" | "saving" | "done";

function XIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.2" strokeLinecap="round">
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
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
      <input
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
    }
  }, [isOpen]);

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
      const cfg = { provider: settings.aiProvider, model: settings.analyzeModel };
      const template = await analyzeInspirationVideo(file, cfg, (step) => setProgressMsg(step));
      setDraft(template);
      setPhase("review");
    } catch (err) {
      console.error("Inspiration analysis failed:", err);
      setError(err instanceof Error ? err.message : "Analysis failed. Please try again.");
      setPhase("drop");
    }
  }, [settings]);

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
    <div
      className="st-modal-scrim"
      onClick={onClose}
      style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,0.7)",
        backdropFilter: "blur(6px)",
        zIndex: 1100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        className="st-modal-card"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--panel-2)",
          border: "1px solid var(--line)",
          borderRadius: 14,
          width: "100%",
          maxWidth: 600,
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 24px 64px rgba(0,0,0,0.75)",
        }}
      >
        {/* Header */}
        <div style={{
          padding: "16px 20px",
          borderBottom: "1px solid var(--line)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
        }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "var(--ink)" }}>
              ✦ Create Template from Video
            </h3>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--ink-2)" }}>
              Upload a reference video — Claude will analyze the edit structure and extract a reusable template.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            title="Close (Esc)"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--ink-2)",
              padding: 6,
              borderRadius: 7,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <XIcon />
          </button>
        </div>

        {/* Body */}
        <div style={{ overflowY: "auto", flex: 1, padding: 20 }}>

          {/* ── DROP PHASE ── */}
          {(phase === "drop") && (
            <div
              onDragEnter={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragOver={(e) => e.preventDefault()}
              onDragLeave={() => setIsDragging(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: `2px dashed ${isDragging ? "var(--accent)" : "var(--line)"}`,
                borderRadius: 12,
                padding: "48px 24px",
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
                MP4, MOV, WebM — any video you want to replicate the edit style of
              </div>
              <button
                className="st-btn ghost"
                style={{ marginTop: 16, fontSize: 12 }}
                onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
              >
                Or browse files…
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                onChange={onFileChange}
                style={{ display: "none" }}
              />
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
                <input
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
                <input
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
                  <button
                    className="st-btn ghost"
                    style={{ fontSize: 10, padding: "3px 10px" }}
                    onClick={addBeat}
                  >
                    + Add Beat
                  </button>
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
                      <input
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
                      <button
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
                      </button>
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
                  <button
                    key={a}
                    className={`st-btn ${draft.aspect === a ? "primary" : "ghost"}`}
                    style={{ fontSize: 10, padding: "3px 10px" }}
                    onClick={() => setDraft((d) => d ? { ...d, aspect: a } : d)}
                  >
                    {a}
                  </button>
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
          <div style={{
            padding: "14px 20px",
            borderTop: "1px solid var(--line)",
            display: "flex",
            gap: 10,
            justifyContent: "flex-end",
            flexShrink: 0,
            background: "var(--panel)",
          }}>
            <button className="st-btn ghost" onClick={onClose} style={{ fontSize: 12 }}>
              Cancel
            </button>
            <button
              className="st-btn primary"
              onClick={handleSave}
              disabled={phase === "saving" || !draft?.name.trim() || draft.beats.length < 2}
              style={{ fontSize: 12 }}
            >
              {phase === "saving" ? "Saving…" : "Save Template"}
            </button>
          </div>
        )}

        {phase === "done" && (
          <div style={{
            padding: "14px 20px",
            borderTop: "1px solid var(--line)",
            display: "flex",
            justifyContent: "flex-end",
            flexShrink: 0,
            background: "var(--panel)",
          }}>
            <button className="st-btn primary" onClick={onClose} style={{ fontSize: 12 }}>
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
