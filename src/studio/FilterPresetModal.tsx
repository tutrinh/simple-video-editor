import { useState } from "react";
import filterPresets from "../data/filterPresets.json";
import type { FilterPreset } from "./util";

interface Props {
  activeFilterId?: string;
  activeIntensity?: number;
  onSelectFilter: (filterId: string | null, intensity?: number) => void;
  onClose: () => void;
}

export default function FilterPresetModal({ activeFilterId, activeIntensity = 1, onSelectFilter, onClose }: Props) {
  const [intensity, setIntensity] = useState<number>(Math.round(activeIntensity * 100));

  const presets = filterPresets as FilterPreset[];

  const handleSelect = (id: string) => {
    if (id === "none") {
      onSelectFilter(null, 1);
    } else {
      onSelectFilter(id, intensity / 100);
    }
  };

  const handleIntensityChange = (val: number) => {
    setIntensity(val);
    if (activeFilterId) {
      onSelectFilter(activeFilterId, val / 100);
    }
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
          maxWidth: 680,
          maxHeight: "85vh",
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
              Apply a non-destructive color grade across the entire cut.
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

        {/* Intensity Control Bar */}
        {activeFilterId && activeFilterId !== "none" && (
          <div
            style={{
              padding: "12px 20px",
              background: "var(--panel-3)",
              borderBottom: "1px solid var(--line)",
              display: "flex",
              alignItems: "center",
              gap: 16,
            }}
          >
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
              className="st-range"
              style={{ flex: 1 }}
            />
            <button
              className="st-btn ghost"
              style={{ padding: "2px 8px", fontSize: 11 }}
              onClick={() => handleSelect("none")}
            >
              Reset Filter
            </button>
          </div>
        )}

        {/* Preset Cards Grid */}
        <div
          style={{
            padding: 20,
            overflowY: "auto",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))",
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
                    {preset.id === "none" ? "🎬" : preset.id === "teal-orange" ? "🎥" : preset.id === "vintage-film" ? "🎞️" : preset.id === "cyberpunk" ? "⚡" : preset.id === "bw-noir" ? "♟️" : preset.id === "vibrant-pop" ? "💥" : preset.id === "nordic-cool" ? "❄️" : "🌅"}
                  </span>

                  {isSelected && (
                    <span
                      style={{
                        position: "absolute",
                        top: 6,
                        right: 6,
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
                </div>

                {/* Info Text */}
                <div style={{ padding: 10, flex: 1, display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: isSelected ? "var(--accent)" : "var(--ink)" }}>
                    {preset.name}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--ink-2)", marginTop: 4, lineHeight: 1.3 }}>
                    {preset.description}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
