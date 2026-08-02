import { useState, useEffect } from "react";
import { getAllFilterPresets, saveCustomPreset, deleteCustomPreset, type FilterPreset } from "../lib/customPresets";
import type { ColorAdjustments } from "../domain/types";
import type { ColorizeSettings } from "../domain/types";
import { sliderTrackStyle } from "./util";
import ColorizeControl from "./ColorizeControl";

import { useSettings } from "../state/SettingsContext";
import { useProject } from "../state/ProjectContext";
import { analyzeFilmLook, gradeBeatToLook, type FilmLook } from "../lib/filmLook";
import { sampleFrameAt, stillFrame } from "../lib/frameSampler";
import { loadReferences, saveReference, deleteReference, downscaleDataUrl, type SavedReference } from "../lib/lookReferences";
import { captureGradeSnapshot, clearedGlobal, restoredBeatGrade, restoredGlobal, wasSnapshotted, type GradeSnapshot } from "../lib/lookApply";
import { ControlButton, InputControl } from "../design-system/ControlPrimitives";
import { ModalScrim, ModalSurface } from "../design-system/ModalPrimitives";
import CloseIcon from "../design-system/icons/CloseIcon";
import DeleteIcon from "../design-system/icons/DeleteIcon";
import CloseButton from "../design-system/CloseButton";

interface Props {
  activeFilterId?: string;
  activeIntensity?: number;
  activeAdjustments?: ColorAdjustments;
  onSelectFilter: (filterId: string | null, intensity?: number, adjustments?: ColorAdjustments) => void;
  onClose: () => void;
}

export default function FilterPresetModal({ activeFilterId, activeIntensity = 1, activeAdjustments, onSelectFilter, onClose }: Props) {
  const [intensity, setIntensity] = useState<number>(Math.round(activeIntensity * 100));
  const [presets, setPresets] = useState<FilterPreset[]>([]);
  const [fineTuneOpen, setFineTuneOpen] = useState(true);
  const [fineTuneAdj, setFineTuneAdj] = useState<ColorAdjustments>({});
  const [newPresetName, setNewPresetName] = useState("");
  const [savingPreset, setSavingPreset] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<FilterPreset | null>(null);

  // ── AI Film Look ──────────────────────────────────────────────────
  const { settings } = useSettings();
  const { state, dispatch } = useProject();
  const [refImageUrl, setRefImageUrl] = useState<string | null>(null); // full data URL (display + base64 source)
  const [look, setLook] = useState<FilmLook | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiLabel, setAiLabel] = useState("");
  const [aiErr, setAiErr] = useState<string | null>(null);
  const [savedRefs, setSavedRefs] = useState<SavedReference[]>(() => loadReferences());
  // Snapshot of the per-Beat Grades *and* the global override before an AI grade
  // → one-click Undo that puts both back.
  const [gradeUndo, setGradeUndo] = useState<GradeSnapshot | null>(null);
  const aiCfg = { provider: settings.aiProvider, model: settings.analyzeModel };

  function onRefUpload(file?: File) {
    if (!file) return;
    setAiErr(null);
    const reader = new FileReader();
    reader.onload = () => {
      setRefImageUrl(String(reader.result ?? "") || null);
      setLook(null);
    };
    reader.readAsDataURL(file);
  }

  async function analyzeLook() {
    const b64 = refImageUrl?.split(",")[1];
    if (!b64) return;
    setAiBusy(true); setAiLabel("Analyzing film look…"); setAiErr(null);
    try {
      // Deriving a Look does NOT touch the global override (ADR-0010). Claude is
      // asked for values that push *neutral* footage toward the reference, so
      // applying them flat to footage that is nowhere near neutral overshoots —
      // vivid scenes blow out to primaries. "Apply to all beats" is what grades
      // each Beat toward the Look, accounting for where that shot already sits.
      setLook(await analyzeFilmLook(b64, aiCfg));
    } catch (e) {
      setAiErr(e instanceof Error ? e.message : String(e));
    } finally {
      setAiBusy(false); setAiLabel("");
    }
  }

  async function applyLookToBeats() {
    const cut = state.cut;
    if (!look || !cut || cut.beats.length === 0) return;
    setAiBusy(true); setAiErr(null);
    const snapshot = captureGradeSnapshot(cut.beats, {
      filterId: activeFilterId, intensity: intensity / 100, adjustments: fineTuneAdj,
    });
    const refB64 = refImageUrl?.split(",")[1]; // reference image for direct comparison

    // A Look is a target, not an offset (ADR-0010): clear the global override
    // first, or the Look lands twice — flat across every Beat here, and again as
    // the per-shot match below.
    const cleared = clearedGlobal(snapshot.global);
    setFineTuneAdj(cleared.adjustments ?? {});
    onSelectFilter(cleared.filterId ?? null, cleared.intensity, cleared.adjustments);

    try {
      const clipById = new Map(state.clips.map((c) => [c.id, c]));
      for (let i = 0; i < cut.beats.length; i++) {
        const beat = cut.beats[i];
        setAiLabel(`Grading beat ${i + 1} of ${cut.beats.length}…`);
        const clip = clipById.get(beat.clipId);
        const src = clip?.normalized ?? clip?.file;
        if (!src) continue;
        try {
          const mid = (beat.inSec + beat.outSec) / 2;
          // A Still has no midpoint to seek to (ADR-0012). Without this branch
          // the catch below would quietly skip it rather than grade it.
          const frame = clip?.kind === "still" ? await stillFrame(src) : await sampleFrameAt(src, mid);
          const adj = await gradeBeatToLook(frame.base64, look, aiCfg, refB64);
          dispatch({ type: "UPDATE_BEAT", beat: { ...beat, colorAdjustments: adj } });
        } catch (err) {
          console.warn(`Beat ${i + 1} grade failed; leaving it unchanged.`, err);
        }
      }
      setGradeUndo(snapshot);
    } catch (e) {
      setAiErr(e instanceof Error ? e.message : String(e));
    } finally {
      setAiBusy(false); setAiLabel("");
    }
  }

  function undoGrade() {
    const cut = state.cut;
    if (!gradeUndo || !cut) return;
    for (const beat of cut.beats) {
      if (!wasSnapshotted(gradeUndo, beat.id)) continue;
      dispatch({ type: "UPDATE_BEAT", beat: { ...beat, colorAdjustments: restoredBeatGrade(gradeUndo, beat.id) } });
    }
    // Undo restores the global the apply cleared, not just the per-Beat Grades.
    const prior = restoredGlobal(gradeUndo);
    setFineTuneAdj(prior.adjustments ?? {});
    onSelectFilter(prior.filterId ?? null, prior.intensity, prior.adjustments);
    setGradeUndo(null);
  }

  // Save the current reference (downscaled) + its derived Look for reuse across sessions.
  async function saveCurrentReference() {
    if (!refImageUrl) return;
    const name = prompt("Name this reference:", look?.description || "Reference");
    if (name === null) return;
    const thumb = await downscaleDataUrl(refImageUrl);
    saveReference(thumb, name, look ?? undefined);
    setSavedRefs(loadReferences());
  }

  function loadSavedReference(ref: SavedReference) {
    setRefImageUrl(ref.dataUrl);
    setAiErr(null);
    // Same rule as analyzeLook: loading a saved reference restores its Look as a
    // target to grade toward, never as a flat global offset.
    setLook(ref.look ?? null);
  }

  function removeSavedReference(id: string) {
    deleteReference(id);
    setSavedRefs(loadReferences());
  }

  const [lookPresetSaved, setLookPresetSaved] = useState(false);
  // Save the derived Look as a custom preset — Claude's name + description, no typing.
  function saveLookAsPreset() {
    if (!look) return;
    const name = (look.name || look.description || "AI Film Look").trim();
    const saved = saveCustomPreset(name, look.colorAdjustments, look.description || "AI film look");
    refreshPresets();
    onSelectFilter(saved.id, intensity / 100, look.colorAdjustments);
    setLookPresetSaved(true);
    setTimeout(() => setLookPresetSaved(false), 1800);
  }

  useEffect(() => {
    refreshPresets();
  }, []);

  const refreshPresets = () => {
    const list = getAllFilterPresets();
    setPresets(list);
  };

  const activePreset = presets.find((p) => p.id === activeFilterId);

  useEffect(() => {
    if (activeAdjustments && Object.keys(activeAdjustments).length > 0) {
      setFineTuneAdj(activeAdjustments);
    } else if (activePreset) {
      setFineTuneAdj(activePreset.colorAdjustments);
    }
  }, [activeFilterId, activeAdjustments]);

  const handleSelect = (id: string) => {
    if (id === "none") {
      onSelectFilter(null, 1, undefined);
    } else {
      const selected = presets.find((p) => p.id === id);
      const adj = selected ? selected.colorAdjustments : undefined;
      setFineTuneAdj(adj ?? {});
      onSelectFilter(id, intensity / 100, adj);
    }
  };

  const handleIntensityChange = (val: number) => {
    setIntensity(val);
    if (activeFilterId) {
      onSelectFilter(activeFilterId, val / 100, fineTuneAdj);
    }
  };

  const handleAdjChange = (key: keyof ColorAdjustments, value: number) => {
    const nextAdj = { ...fineTuneAdj, [key]: value };
    setFineTuneAdj(nextAdj);
    if (activeFilterId) {
      onSelectFilter(activeFilterId, intensity / 100, nextAdj);
    }
  };

  const handleColorizeChange = (colorize: ColorizeSettings) => {
    const nextAdj = { ...fineTuneAdj, colorize };
    setFineTuneAdj(nextAdj);
    if (activeFilterId) onSelectFilter(activeFilterId, intensity / 100, nextAdj);
  };

  const handleSaveCustom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPresetName.trim()) return;

    const saved = saveCustomPreset(
      newPresetName,
      fineTuneAdj,
      `Custom preset copied from ${activePreset?.name ?? "Custom Adjustment"}`
    );

    refreshPresets();
    onSelectFilter(saved.id, intensity / 100);
    setNewPresetName("");
    setSavingPreset(false);
  };

  const handleDeleteConfirm = () => {
    if (!deleteTarget) return;
    deleteCustomPreset(deleteTarget.id);
    if (activeFilterId === deleteTarget.id) {
      onSelectFilter(null, 1);
    }
    setDeleteTarget(null);
    refreshPresets();
  };

  return (
    <ModalScrim onClick={onClose} style={{ zIndex: 1000 }}>
      <ModalSurface
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(760px, 100%)",
          maxHeight: "88vh",
        }}
      >
        <header className="ui-modal-head">
          <div className="ui-modal-heading">
            <h2>Global filter presets</h2>
            <p>
              Apply a non-destructive color grade or save your own custom preset.
            </p>
          </div>
          <CloseButton onClick={onClose} label="Close filter presets" />
        </header>

        {/* AI Film Look — analyze a reference image, then grade every beat toward it */}
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--line)", background: "var(--panel)" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink)", marginBottom: 8 }}>AI film look</div>

          <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            {refImageUrl && (
              <img
                src={refImageUrl}
                alt="Reference"
                style={{ width: 96, height: 64, objectFit: "cover", borderRadius: 6, border: "1px solid var(--line)", flexShrink: 0 }}
              />
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", flex: 1 }}>
            <label className="st-btn ghost" style={{ fontSize: 11, padding: "5px 10px", cursor: "pointer" }} title="Upload a reference still with the film look you want">
              {refImageUrl ? "Change reference" : "Upload reference image"}
              <InputControl type="file" accept="image/*" style={{ display: "none" }}
                onChange={(e) => { onRefUpload(e.target.files?.[0]); e.currentTarget.value = ""; }} />
            </label>
            <ControlButton type="button" className="st-btn ghost" style={{ fontSize: 11, padding: "5px 10px" }}
              onClick={analyzeLook} disabled={!refImageUrl || aiBusy} title="Claude analyzes the reference's grade">
              Analyze look
            </ControlButton>
            {refImageUrl && (
              <ControlButton type="button" className="st-btn ghost" style={{ fontSize: 11, padding: "5px 10px" }}
                onClick={saveCurrentReference} disabled={aiBusy} title="Save this reference (and its Look) for future use">
                Save reference
              </ControlButton>
            )}
            {look && (
              <>
                <ControlButton type="button" className="st-btn primary" style={{ fontSize: 11, padding: "5px 10px" }}
                  onClick={applyLookToBeats} disabled={aiBusy || !state.cut?.beats.length}
                  title="Grade every beat toward this look (one Claude call per beat)">
                  Apply to all beats
                </ControlButton>
                <ControlButton type="button" className="st-btn ghost" style={{ fontSize: 11, padding: "5px 10px" }}
                  onClick={saveLookAsPreset} disabled={aiBusy}
                  title={`Save this look as a reusable preset${look?.name ? ` ("${look.name}")` : ""}`}>
                  {lookPresetSaved ? "Saved preset" : "Save as preset"}
                </ControlButton>
                {gradeUndo && (
                  <ControlButton type="button" className="st-btn ghost" style={{ fontSize: 11, padding: "5px 10px", color: "var(--accent)" }}
                    onClick={undoGrade} title="Restore every beat's color to before the AI grade">
                    Undo AI grade
                  </ControlButton>
                )}
              </>
            )}
            </div>
          </div>
          {aiBusy && <div style={{ fontSize: 11, color: "var(--accent)", marginTop: 6 }}>{aiLabel || "Working…"}</div>}
          {aiErr && <div style={{ fontSize: 11, color: "var(--danger)", marginTop: 6, cursor: "pointer" }} onClick={() => setAiErr(null)}>{aiErr} (dismiss)</div>}
          {look && !aiBusy && (
            <div style={{ marginTop: 8, padding: "8px 11px", background: "var(--panel-3)", border: "1px solid var(--accent)", borderRadius: 7 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>{look.name || "Film Look"}</span>
                <span className="ui-badge positive">Analyzed</span>
              </div>
              {look.description && (
                <div style={{ fontSize: 11.5, color: "var(--ink)", marginTop: 3, lineHeight: 1.45 }}>{look.description}</div>
              )}
              <div style={{ fontSize: 10, color: "var(--ink-3)", marginTop: 5, lineHeight: 1.4 }}>
                Loaded into the sliders below. <strong style={{ color: "var(--ink-2)" }}>Apply to all beats</strong> matches each beat to it; <strong style={{ color: "var(--ink-2)" }}>Save as preset</strong> keeps it for reuse.
              </div>
            </div>
          )}

          {savedRefs.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--ink-3)", fontWeight: 700, marginBottom: 5 }}>Saved references</div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {savedRefs.map((ref) => (
                  <div key={ref.id} style={{ position: "relative" }}>
                    <img
                      src={ref.dataUrl}
                      alt={ref.name}
                      title={`${ref.name}${ref.look ? " - has saved Look" : ""}`}
                      onClick={() => loadSavedReference(ref)}
                      style={{ width: 72, height: 48, objectFit: "cover", borderRadius: 5, border: refImageUrl === ref.dataUrl ? "2px solid var(--accent)" : "1px solid var(--line)", cursor: "pointer", display: "block" }}
                    />
                    <ControlButton
                      type="button"
                      onClick={() => removeSavedReference(ref.id)}
                      title="Delete reference"
                      style={{ position: "absolute", top: -6, right: -6, width: 18, height: 18, borderRadius: "50%", background: "var(--danger)", color: "#fff", border: "none", fontSize: 11, lineHeight: 1, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}
                    >
                      ×
                    </ControlButton>
                    {ref.look && <span style={{ position: "absolute", bottom: 2, left: 2, fontSize: 8, background: "rgba(0,0,0,.6)", color: "#fff", padding: "0 3px", borderRadius: 3 }}>Look</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Intensity Control & Fine-Tune Bar */}
        {activeFilterId && activeFilterId !== "none" && (
          <div
            style={{
              padding: "12px 20px",
              background: "var(--panel)",
              borderBottom: "1px solid var(--line)",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--accent)", whiteSpace: "nowrap" }}>
                Filter Intensity: {intensity}%
              </span>
              <InputControl
                type="range"
                min={10}
                max={100}
                step={5}
                value={intensity}
                onChange={(e) => handleIntensityChange(Number(e.target.value))}
                style={sliderTrackStyle(intensity, 10, 100)}
              />
              <ControlButton
                className="st-btn ghost"
                style={{ padding: "2px 8px", fontSize: 11 }}
                onClick={() => setFineTuneOpen(!fineTuneOpen)}
              >
                {fineTuneOpen ? "Hide fine-tune" : "Show fine-tune"}
              </ControlButton>
              <ControlButton
                className="st-btn ghost"
                style={{ padding: "2px 8px", fontSize: 11, borderColor: "var(--danger)", color: "var(--danger)" }}
                onClick={() => handleSelect("none")}
              >
                Reset Filter
              </ControlButton>
            </div>

            {/* Fine-Tune & Save Custom Drawer */}
            {fineTuneOpen && (
              <div
                style={{
                  background: "var(--panel-2)",
                  border: "1px solid var(--line)",
                  borderRadius: 8,
                  padding: 12,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                <ColorizeControl
                  value={fineTuneAdj.colorize}
                  baseValue={activePreset?.colorAdjustments.colorize}
                  onChange={handleColorizeChange}
                />
                <div className="st-color-adjustments" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 16, rowGap: 8 }}>
                  {([
                    ["Exposure", "exposure"],
                    ["Contrast", "contrast"],
                    ["Shadows", "shadows"],
                    ["Highlights", "highlights"],
                    ["Color Tone", "colorTone"],
                    ["Warmth", "warmth"],
                    ["Tint", "tint"],
                    ["Saturation", "saturation"],
                    ["Shadow warm", "shadowWarmth"],
                    ["Shadow tint", "shadowTint"],
                    ["Highlt warm", "highlightWarmth"],
                    ["Highlt tint", "highlightTint"],
                  ] as const).map(([label, key]) => {
                    const val = fineTuneAdj[key] ?? 0;
                    return (
                      <div key={key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 11, width: 70, color: "var(--ink-2)" }}>{label}</span>
                        <InputControl
                          type="range"
                          min={-100}
                          max={100}
                          value={val}
                          onChange={(e) => handleAdjChange(key, Number(e.target.value))}
                          style={sliderTrackStyle(val, -100, 100)}
                        />
                        <span style={{ fontSize: 10, width: 32, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
                          {val > 0 ? `+${val}` : val}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {!savingPreset ? (
                  <ControlButton
                    className="st-btn primary"
                    style={{ fontSize: 11, padding: "4px 10px", alignSelf: "flex-start" }}
                    onClick={() => {
                      setNewPresetName(`${activePreset?.name ?? "Custom"} Copy`);
                      setSavingPreset(true);
                    }}
                  >
                    Save as custom preset
                  </ControlButton>
                ) : (
                  <form onSubmit={handleSaveCustom} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <InputControl
                      type="text"
                      placeholder="Preset Name (e.g. My Warm Sunset)"
                      value={newPresetName}
                      onChange={(e) => setNewPresetName(e.target.value)}
                      style={{
                        flex: 1,
                        background: "var(--panel-3)",
                        border: "1px solid var(--line)",
                        borderRadius: 6,
                        color: "var(--ink)",
                        padding: "4px 8px",
                        fontSize: 12,
                      }}
                      autoFocus
                      required
                    />
                    <ControlButton type="submit" className="st-btn primary" style={{ fontSize: 11, padding: "4px 10px" }}>
                      Save Preset
                    </ControlButton>
                    <ControlButton
                      type="button"
                      className="st-btn ghost"
                      style={{ fontSize: 11, padding: "4px 10px" }}
                      onClick={() => setSavingPreset(false)}
                    >
                      Cancel
                    </ControlButton>
                  </form>
                )}
              </div>
            )}
          </div>
        )}

        {/* Preset Cards Grid */}
        <div
          style={{
            padding: 18,
            overflowY: "auto",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))",
            gap: 10,
          }}
        >
          {presets.map((preset) => {
            const isSelected = (activeFilterId ?? "none") === preset.id;

            return (
              <div
                key={preset.id}
                onClick={() => handleSelect(preset.id)}
                style={{
                  background: isSelected ? "var(--panel-3)" : "var(--panel)",
                  border: isSelected ? "1px solid var(--accent)" : "1px solid var(--line)",
                  borderRadius: 8,
                  overflow: "hidden",
                  cursor: "pointer",
                  transition: "background 0.15s ease, border-color 0.15s ease",
                  display: "flex",
                  flexDirection: "column",
                  position: "relative",
                }}
              >
                {/* Visual Thumbnail */}
                <div
                  style={{
                    height: 38,
                    background: preset.previewGradient,
                    position: "relative",
                  }}
                >
                  {isSelected && (
                    <span className="ui-badge positive" style={{ position: "absolute", top: 7, left: 7 }}>
                      Active
                    </span>
                  )}

                  {/* Delete Custom Preset Button */}
                  {preset.isCustom && (
                    <ControlButton
                      type="button"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteTarget(preset);
                      }}
                      style={{
                        position: "absolute",
                        top: 6,
                        right: 6,
                        background: "var(--panel-2)",
                        color: "var(--danger)",
                        border: "1px solid var(--line)",
                        borderRadius: 6,
                        width: 24,
                        height: 24,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "pointer",
                      }}
                      title="Delete this custom preset"
                    >
                      <CloseIcon size={10} />
                    </ControlButton>
                  )}
                </div>

                {/* Info Text */}
                <div style={{ padding: 10, flex: 1, display: "flex", flexDirection: "column" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: isSelected ? "var(--accent)" : "var(--ink)" }}>
                      {preset.name}
                    </span>
                    {preset.isCustom && <span className="ui-badge">Custom</span>}
                  </div>
                  <span style={{ fontSize: 11, color: "var(--ink-2)", marginTop: 4, lineHeight: 1.3 }}>
                    {preset.description}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </ModalSurface>

      {/* Delete Confirmation Warning Modal */}
      {deleteTarget && (
        <ModalScrim
          className="st-modal-scrim"
          onClick={() => setDeleteTarget(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.75)",
            backdropFilter: "blur(4px)",
            zIndex: 1100,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
        >
          <ModalSurface
            className="st-modal-card"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--panel-2)",
              border: "1px solid var(--danger)",
              borderRadius: 12,
              padding: 20,
              maxWidth: 400,
              width: "100%",
              boxShadow: "0 20px 50px rgba(0,0,0,0.8)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: "50%",
                  background: "rgba(229, 105, 95, 0.15)",
                  color: "var(--danger)",
                  display: "grid",
                  placeItems: "center",
                  flexShrink: 0,
                }}
              >
                <DeleteIcon size={20} />
              </div>
              <div>
                <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "var(--ink)" }}>
                  Delete Custom Preset?
                </h4>
                <p style={{ margin: "4px 0 0 0", fontSize: 12, color: "var(--ink-2)" }}>
                  Are you sure you want to delete <strong>"{deleteTarget.name}"</strong>? This action cannot be undone.
                </p>
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <ControlButton
                type="button"
                className="st-btn ghost"
                style={{ flex: 1, justifyContent: "center" }}
                onClick={() => setDeleteTarget(null)}
              >
                Cancel
              </ControlButton>
              <ControlButton
                type="button"
                className="st-btn danger"
                style={{ flex: 1, justifyContent: "center" }}
                onClick={handleDeleteConfirm}
              >
                Delete Preset
              </ControlButton>
            </div>
          </ModalSurface>
        </ModalScrim>
      )}
    </ModalScrim>
  );
}
