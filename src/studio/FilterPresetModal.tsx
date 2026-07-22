import { useState, useEffect } from "react";
import { getAllFilterPresets, saveCustomPreset, deleteCustomPreset, type FilterPreset } from "../lib/customPresets";
import type { ColorAdjustments } from "../domain/types";
import { sliderTrackStyle } from "./Inspector";

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
    <div
      className="st-modal-scrim"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.65)",
        backdropFilter: "blur(4px)",
        zIndex: 1000,
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
          maxWidth: 720,
          maxHeight: "88vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 24px 60px rgba(0,0,0,0.7)",
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid var(--line)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--ink)" }}>🎨 Global Look & Feel Filter Presets</h3>
            <p style={{ margin: "2px 0 0 0", fontSize: 12, color: "var(--ink-2)" }}>
              Apply a non-destructive color grade or save your own custom preset.
            </p>
          </div>
          <button
            className="st-btn ghost"
            style={{ padding: "4px 8px", fontSize: 12 }}
            onClick={onClose}
          >
            ✕ Close
          </button>
        </div>

        {/* Intensity Control & Fine-Tune Bar */}
        {activeFilterId && activeFilterId !== "none" && (
          <div
            style={{
              padding: "12px 20px",
              background: "var(--panel-3)",
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
              <input
                type="range"
                min={10}
                max={100}
                step={5}
                value={intensity}
                onChange={(e) => handleIntensityChange(Number(e.target.value))}
                style={sliderTrackStyle(intensity, 10, 100)}
              />
              <button
                className="st-btn ghost"
                style={{ padding: "2px 8px", fontSize: 11 }}
                onClick={() => setFineTuneOpen(!fineTuneOpen)}
              >
                {fineTuneOpen ? "▲ Hide Fine-Tune" : "🎛️ Fine-Tune & Copy"}
              </button>
              <button
                className="st-btn ghost"
                style={{ padding: "2px 8px", fontSize: 11, borderColor: "var(--danger)", color: "var(--danger)" }}
                onClick={() => handleSelect("none")}
              >
                Reset Filter
              </button>
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
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <label style={{ fontSize: 11, color: "var(--ink-2)" }}>Exposure ({fineTuneAdj.exposure ?? 0})</label>
                    <input
                      type="range"
                      min={-100}
                      max={100}
                      value={fineTuneAdj.exposure ?? 0}
                      onChange={(e) => handleAdjChange("exposure", Number(e.target.value))}
                      style={sliderTrackStyle(fineTuneAdj.exposure ?? 0, -100, 100)}
                    />
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <label style={{ fontSize: 11, color: "var(--ink-2)" }}>Contrast ({fineTuneAdj.contrast ?? 0})</label>
                    <input
                      type="range"
                      min={-100}
                      max={100}
                      value={fineTuneAdj.contrast ?? 0}
                      onChange={(e) => handleAdjChange("contrast", Number(e.target.value))}
                      style={sliderTrackStyle(fineTuneAdj.contrast ?? 0, -100, 100)}
                    />
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <label style={{ fontSize: 11, color: "var(--ink-2)" }}>Color Tone ({fineTuneAdj.colorTone ?? 0})</label>
                    <input
                      type="range"
                      min={-100}
                      max={100}
                      value={fineTuneAdj.colorTone ?? 0}
                      onChange={(e) => handleAdjChange("colorTone", Number(e.target.value))}
                      style={sliderTrackStyle(fineTuneAdj.colorTone ?? 0, -100, 100)}
                    />
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <label style={{ fontSize: 11, color: "var(--ink-2)" }}>Warmth ({fineTuneAdj.warmth ?? 0})</label>
                    <input
                      type="range"
                      min={-100}
                      max={100}
                      value={fineTuneAdj.warmth ?? 0}
                      onChange={(e) => handleAdjChange("warmth", Number(e.target.value))}
                      style={sliderTrackStyle(fineTuneAdj.warmth ?? 0, -100, 100)}
                    />
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <label style={{ fontSize: 11, color: "var(--ink-2)" }}>Saturation ({fineTuneAdj.saturation ?? 0})</label>
                    <input
                      type="range"
                      min={-100}
                      max={100}
                      value={fineTuneAdj.saturation ?? 0}
                      onChange={(e) => handleAdjChange("saturation", Number(e.target.value))}
                      style={sliderTrackStyle(fineTuneAdj.saturation ?? 0, -100, 100)}
                    />
                  </div>
                </div>

                {!savingPreset ? (
                  <button
                    className="st-btn primary"
                    style={{ fontSize: 11, padding: "4px 10px", alignSelf: "flex-start" }}
                    onClick={() => {
                      setNewPresetName(`${activePreset?.name ?? "Custom"} Copy`);
                      setSavingPreset(true);
                    }}
                  >
                    💾 Save as Custom Preset
                  </button>
                ) : (
                  <form onSubmit={handleSaveCustom} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
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
                    <button type="submit" className="st-btn primary" style={{ fontSize: 11, padding: "4px 10px" }}>
                      Save Preset
                    </button>
                    <button
                      type="button"
                      className="st-btn ghost"
                      style={{ fontSize: 11, padding: "4px 10px" }}
                      onClick={() => setSavingPreset(false)}
                    >
                      Cancel
                    </button>
                  </form>
                )}
              </div>
            )}
          </div>
        )}

        {/* Preset Cards Grid */}
        <div
          style={{
            padding: 20,
            overflowY: "auto",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(195px, 1fr))",
            gap: 14,
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
                  border: isSelected ? "2px solid var(--accent)" : "1px solid var(--line)",
                  borderRadius: 10,
                  overflow: "hidden",
                  cursor: "pointer",
                  transition: "transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease",
                  display: "flex",
                  flexDirection: "column",
                  position: "relative",
                  boxShadow: isSelected ? "0 0 12px var(--accent-subtle, rgba(255,179,57,0.3))" : "none",
                }}
              >
                {/* Visual Thumbnail */}
                <div
                  style={{
                    height: 80,
                    background: preset.previewGradient,
                    position: "relative",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <span style={{ fontSize: 24, filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))" }}>
                    {preset.isCustom ? "⭐" : preset.id === "none" ? "🎬" : preset.id === "teal-orange" ? "🎥" : preset.id === "kodak-portra" ? "📸" : preset.id === "wes-anderson" ? "🎨" : preset.id === "matrix-green" ? "🟢" : preset.id === "fuji-eterna" ? "📽️" : preset.id === "bleach-bypass" ? "⚔️" : preset.id === "vintage-film" ? "🎞️" : preset.id === "cyberpunk" ? "⚡" : preset.id === "bw-noir" ? "♟️" : preset.id === "moody-matte" ? "🌫️" : preset.id === "vibrant-pop" ? "💥" : preset.id === "nordic-cool" ? "❄️" : "🌅"}
                  </span>

                  {isSelected && (
                    <span
                      style={{
                        position: "absolute",
                        top: 6,
                        left: 6,
                        background: "var(--accent)",
                        color: "var(--accent-ink)",
                        fontSize: 10,
                        fontWeight: 700,
                        padding: "2px 6px",
                        borderRadius: 999,
                      }}
                    >
                      ✓ ACTIVE
                    </span>
                  )}

                  {/* Delete Custom Preset Button */}
                  {preset.isCustom && (
                    <button
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
                        background: "rgba(229, 105, 95, 0.85)",
                        color: "#fff",
                        border: "none",
                        borderRadius: "50%",
                        width: 22,
                        height: 22,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "pointer",
                      }}
                      title="Delete this custom preset"
                    >
                      <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                        <line x1="2" y1="2" x2="10" y2="10" />
                        <line x1="10" y1="2" x2="2" y2="10" />
                      </svg>
                    </button>
                  )}
                </div>

                {/* Info Text */}
                <div style={{ padding: 10, flex: 1, display: "flex", flexDirection: "column" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: isSelected ? "var(--accent)" : "var(--ink)" }}>
                      {preset.name}
                    </span>
                    {preset.isCustom && (
                      <span style={{ fontSize: 9, background: "var(--panel-3)", border: "1px solid var(--line)", padding: "1px 4px", borderRadius: 4, color: "var(--accent)" }}>
                        CUSTOM
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize: 11, color: "var(--ink-2)", marginTop: 4, lineHeight: 1.3 }}>
                    {preset.description}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Delete Confirmation Warning Modal */}
      {deleteTarget && (
        <div
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
          <div
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
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                </svg>
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
              <button
                type="button"
                className="st-btn ghost"
                style={{ flex: 1, justifyContent: "center" }}
                onClick={() => setDeleteTarget(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="st-btn danger"
                style={{ flex: 1, justifyContent: "center" }}
                onClick={handleDeleteConfirm}
              >
                Delete Preset
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
