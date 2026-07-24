import { useEffect, useState } from "react";
import type { TitleLayerSettings } from "../../state/ExportSettingsContext";
import { GOOGLE_TITLE_FONTS, SYSTEM_TITLE_FONTS, ensureGoogleFontLoaded } from "../../lib/googleFonts";
import { extractTitleStyle, setCopiedTitleStyle, useCopiedTitleStyle } from "../../lib/titleClipboard";

const TITLE_SWATCHES = [
  { label: "White", value: "#ffffff" },
  { label: "Black", value: "#000000" },
  { label: "Yellow", value: "#ffd400" },
];

function sliderTrackStyle(val: number, min: number, max: number) {
  const pct = Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100));
  return {
    flex: 1,
    accentColor: "var(--accent)",
    background: `linear-gradient(to right, var(--accent) 0%, var(--accent) ${pct}%, var(--panel-3) ${pct}%, var(--panel-3) 100%)`,
    height: 6,
    borderRadius: 3,
  } as const;
}

interface Props {
  /** The (up to 3) stacked title layers to edit. */
  layers: TitleLayerSettings[];
  /** Called with the full next layers array on any edit. */
  onChange: (next: TitleLayerSettings[]) => void;
  /** Labels for the layer tabs. Defaults to Main / Sub / Tag. */
  layerLabels?: string[];
  /** Scope options — cut-level titles read "Entire video"; per-beat read "Entire beat". */
  scopeEntireLabel?: string;
  introScopeLabel?: string;
}

/**
 * Reusable editor for a stack of styled title layers. Owns only its active-tab
 * selection; the layer data is fully controlled via `layers` / `onChange`, so
 * the same editor drives cut-level titles (Export) and per-beat titles (Inspector).
 */
export default function TitleTreatmentEditor({
  layers,
  onChange,
  layerLabels = ["(Main)", "(Sub)", "(Tag)"],
  scopeEntireLabel = "Entire video",
  introScopeLabel = "Intro (fade out)",
}: Props) {
  const [activeLayerIndex, setActiveLayerIndex] = useState(0);
  const activeIdx = Math.min(activeLayerIndex, layers.length - 1);
  const copiedStyle = useCopiedTitleStyle();
  const [copiedToast, setCopiedToast] = useState(false);

  function updateLayer(index: number, patch: Partial<TitleLayerSettings>) {
    onChange(layers.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  // Copy the active layer's styling to the shared clipboard; paste applies it to
  // the active layer (keeping that layer's own text/enabled). Works across the
  // cut-level title and every beat's title, in either direction.
  function copyActiveLayer() {
    setCopiedTitleStyle(extractTitleStyle(curLayer));
    setCopiedToast(true);
    setTimeout(() => setCopiedToast(false), 1200);
  }
  function pasteActiveLayer() {
    if (copiedStyle) updateLayer(activeIdx, { ...copiedStyle });
  }

  // Preload any Google fonts referenced by enabled layers so preview matches export.
  useEffect(() => {
    layers.forEach((l) => {
      if (l.enabled && l.text.trim()) {
        const gf = GOOGLE_TITLE_FONTS.find((f) => f.id === l.fontId);
        if (gf) ensureGoogleFontLoaded(gf);
      }
    });
  }, [layers]);

  const curLayer = layers[activeIdx] ?? layers[0];
  if (!curLayer) return null;

  return (
    <>
      {/* Layer Tabs */}
      <div style={{ display: "flex", gap: 6, borderBottom: "1px solid var(--line)", paddingBottom: 8 }}>
        {layers.map((layer, idx) => (
          <button
            key={layer.id}
            type="button"
            onClick={() => setActiveLayerIndex(idx)}
            style={{
              flex: 1,
              padding: "6px 10px",
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 600,
              border: activeIdx === idx ? "1px solid var(--accent)" : "1px solid var(--line)",
              background: activeIdx === idx ? "rgba(255, 179, 57, 0.15)" : "var(--panel-3)",
              color: activeIdx === idx ? "var(--accent)" : "var(--ink-2)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
            }}
          >
            <input
              type="checkbox"
              checked={layer.enabled}
              onChange={(e) => updateLayer(idx, { enabled: e.target.checked })}
              onClick={(e) => e.stopPropagation()}
              style={{ accentColor: "var(--accent)", cursor: "pointer" }}
              title="Enable/disable this title layer"
            />
            Layer {idx + 1} {layerLabels[idx] ?? ""}
          </button>
        ))}
      </div>

      {/* Active Layer Editor */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, opacity: curLayer.enabled ? 1 : 0.55 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            value={curLayer.text}
            onChange={(e) => updateLayer(activeIdx, { text: e.target.value })}
            placeholder={activeIdx === 0 ? "e.g. SUMMER VIBES 2026" : activeIdx === 1 ? "e.g. Official Highlight Reel" : "e.g. Presented by VIDSTR"}
            style={{ flex: 1, padding: "7px 10px", fontSize: 12, background: "var(--panel-3)", border: "1px solid var(--line)", borderRadius: 7, color: "var(--ink)", outline: "none" }}
          />
          {!curLayer.enabled && <span style={{ fontSize: 10, color: "var(--danger)", whiteSpace: "nowrap" }}>(Layer Disabled)</span>}
        </div>

        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            className="st-btn ghost"
            style={{ flex: 1, fontSize: 10, padding: "4px 6px", justifyContent: "center" }}
            onClick={copyActiveLayer}
            title="Copy this layer's style (font, weight, size, color, shadow, position, motion, scope) to reuse on any title layer or beat"
          >
            {copiedToast ? "✓ Copied!" : "📋 Copy Settings"}
          </button>
          <button
            type="button"
            className="st-btn ghost"
            style={{ flex: 1, fontSize: 10, padding: "4px 6px", justifyContent: "center" }}
            onClick={pasteActiveLayer}
            disabled={!copiedStyle}
            title={copiedStyle ? "Paste the copied style onto this layer (keeps its own text)" : "Copy a title layer's settings first"}
          >
            📥 Paste Settings
          </button>
        </div>

        {curLayer.text.trim() && (
          <>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", fontSize: 12 }}>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                Font
                <select value={curLayer.fontId} onChange={(e) => updateLayer(activeIdx, { fontId: e.target.value })} style={{ background: "var(--panel-3)", border: "1px solid var(--line)", borderRadius: 6, color: "var(--ink)", fontSize: 12, padding: "4px 8px", outline: "none" }}>
                  <optgroup label="Google Fonts">
                    {GOOGLE_TITLE_FONTS.map((f) => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                  </optgroup>
                  <optgroup label="System Fonts">
                    {SYSTEM_TITLE_FONTS.map((f) => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                  </optgroup>
                  <option value="custom">Custom upload…</option>
                </select>
              </label>

              <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                Weight
                <select
                  value={curLayer.weight}
                  onChange={(e) => updateLayer(activeIdx, { weight: Number(e.target.value) })}
                  style={{ background: "var(--panel-3)", border: "1px solid var(--line)", borderRadius: 6, color: "var(--ink)", fontSize: 12, padding: "4px 8px", outline: "none" }}
                >
                  <option value={300}>Light (300)</option>
                  <option value={400}>Normal (400)</option>
                  <option value={600}>Semi-Bold (600)</option>
                  <option value={700}>Bold (700)</option>
                  <option value={800}>Extra Bold (800)</option>
                </select>
              </label>

              {curLayer.fontId === "custom" && (
                <input type="file" accept=".ttf,.otf,font/ttf,font/otf" onChange={(e) => updateLayer(activeIdx, { fontFile: e.target.files?.[0] ?? null })} style={{ fontSize: 11 }} />
              )}

              <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                Size
                <input type="number" min={16} max={300} step={2} value={curLayer.sizePx} onChange={(e) => updateLayer(activeIdx, { sizePx: Number(e.target.value) })} style={{ width: 56, background: "var(--panel-3)", border: "1px solid var(--line)", borderRadius: 6, color: "var(--ink)", padding: "4px 6px", fontSize: 12, textAlign: "right", outline: "none" }} /> px
              </label>

              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                Color
                {TITLE_SWATCHES.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => updateLayer(activeIdx, { color: s.value })}
                    title={s.label}
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 4,
                      background: s.value,
                      border: curLayer.color.toLowerCase() === s.value ? "2px solid var(--accent)" : "1px solid var(--line)",
                      cursor: "pointer",
                      padding: 0,
                    }}
                  />
                ))}
                <input type="color" value={curLayer.color} onChange={(e) => updateLayer(activeIdx, { color: e.target.value })} title="Custom color" style={{ width: 24, height: 22, border: "none", background: "none", cursor: "pointer" }} />
              </span>

              <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={curLayer.shadow !== false}
                  onChange={(e) => updateLayer(activeIdx, { shadow: e.target.checked })}
                  style={{ accentColor: "var(--accent)", cursor: "pointer" }}
                />
                Drop shadow
              </label>

              <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                Show
                <select value={curLayer.scope} onChange={(e) => updateLayer(activeIdx, { scope: e.target.value as "intro" | "entire" })} style={{ background: "var(--panel-3)", border: "1px solid var(--line)", borderRadius: 6, color: "var(--ink)", fontSize: 12, padding: "4px 8px", outline: "none" }}>
                  <option value="intro">{introScopeLabel}</option>
                  <option value="entire">{scopeEntireLabel}</option>
                </select>
              </label>

              {curLayer.scope === "intro" && (
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  Duration
                  <select value={curLayer.introSec} onChange={(e) => updateLayer(activeIdx, { introSec: Number(e.target.value) })} style={{ background: "var(--panel-3)", border: "1px solid var(--line)", borderRadius: 6, color: "var(--ink)", fontSize: 12, padding: "4px 8px", outline: "none" }}>
                    <option value={2}>2s</option>
                    <option value={3}>3s</option>
                    <option value={4}>4s</option>
                    <option value={5}>5s</option>
                  </select>
                </label>
              )}

              <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                Motion
                <select
                  value={curLayer.animation ?? "none"}
                  onChange={(e) => updateLayer(activeIdx, { animation: e.target.value as any })}
                  style={{ background: "var(--panel-3)", border: "1px solid var(--line)", borderRadius: 6, color: "var(--accent)", fontWeight: 600, fontSize: 12, padding: "4px 8px", outline: "none", cursor: "pointer" }}
                  title="Select title intro entry animation style"
                >
                  <option value="none">None (Static)</option>
                  <option value="fade">✨ Fade In</option>
                  <option value="slide_left">➡️ Slide Left</option>
                  <option value="slide_bottom">⬆️ Slide Up</option>
                  <option value="slide_top">⬇️ Slide Down</option>
                  <option value="pop">💥 Pop & Bounce</option>
                </select>
              </label>

              {curLayer.animation && curLayer.animation !== "none" && (
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  In Speed
                  <select
                    value={curLayer.animDurationSec ?? 0.5}
                    onChange={(e) => updateLayer(activeIdx, { animDurationSec: Number(e.target.value) })}
                    style={{ background: "var(--panel-3)", border: "1px solid var(--line)", borderRadius: 6, color: "var(--ink)", fontSize: 12, padding: "4px 8px", outline: "none", cursor: "pointer" }}
                    title="Select title intro entry animation duration"
                  >
                    <option value={0.2}>0.2s (Fast)</option>
                    <option value={0.5}>0.5s (Normal)</option>
                    <option value={0.8}>0.8s (Smooth)</option>
                    <option value={1.0}>1.0s (Slow)</option>
                    <option value={1.5}>1.5s (Cinematic)</option>
                    <option value={2.0}>2.0s (Epic)</option>
                  </select>
                </label>
              )}
            </div>

            {/* Position & Spacing Sliders Card (Left/Right, Up/Down, Letter Spacing) */}
            <div className="st-color-adjustments" style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4, padding: "8px 10px", background: "var(--panel-3)", borderRadius: 6, border: "1px solid var(--line)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 11, width: 130, color: "var(--ink-2)" }}>Position X (Left / Right)</span>
                <input
                  type="range"
                  min={-50}
                  max={50}
                  step={1}
                  value={curLayer.posX}
                  onChange={(e) => updateLayer(activeIdx, { posX: Number(e.target.value) })}
                  onDoubleClick={() => updateLayer(activeIdx, { posX: 0 })}
                  style={sliderTrackStyle(curLayer.posX, -50, 50)}
                  title="Double-click to center horizontally"
                />
                <span style={{ fontSize: 10, width: 34, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
                  {curLayer.posX > 0 ? `+${curLayer.posX}%` : `${curLayer.posX}%`}
                </span>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 11, width: 130, color: "var(--ink-2)" }}>Position Y (Up / Down)</span>
                <input
                  type="range"
                  min={-50}
                  max={50}
                  step={1}
                  value={curLayer.posY}
                  onChange={(e) => updateLayer(activeIdx, { posY: Number(e.target.value) })}
                  onDoubleClick={() => updateLayer(activeIdx, { posY: 0 })}
                  style={sliderTrackStyle(curLayer.posY, -50, 50)}
                  title="Double-click to center vertically"
                />
                <span style={{ fontSize: 10, width: 34, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
                  {curLayer.posY > 0 ? `+${curLayer.posY}%` : `${curLayer.posY}%`}
                </span>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 11, width: 130, color: "var(--ink-2)" }}>Letter Spacing</span>
                <input
                  type="range"
                  min={-10}
                  max={60}
                  step={1}
                  value={curLayer.letterSpacing ?? 0}
                  onChange={(e) => updateLayer(activeIdx, { letterSpacing: Number(e.target.value) })}
                  onDoubleClick={() => updateLayer(activeIdx, { letterSpacing: 0 })}
                  style={sliderTrackStyle(curLayer.letterSpacing ?? 0, -10, 60)}
                  title="Double-click to reset spacing to 0"
                />
                <span style={{ fontSize: 10, width: 34, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
                  {curLayer.letterSpacing ?? 0}px
                </span>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 11, width: 130, color: "var(--ink-2)" }}>Text Curve / Arc</span>
                <input
                  type="range"
                  min={-180}
                  max={180}
                  step={1}
                  value={curLayer.arcDeg ?? 0}
                  onChange={(e) => updateLayer(activeIdx, { arcDeg: Number(e.target.value) })}
                  onDoubleClick={() => updateLayer(activeIdx, { arcDeg: 0 })}
                  style={sliderTrackStyle(curLayer.arcDeg ?? 0, -180, 180)}
                  title="Double-click to reset text curve to 0°"
                />
                <span style={{ fontSize: 10, width: 34, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
                  {(curLayer.arcDeg ?? 0) > 0 ? `+${curLayer.arcDeg}°` : `${curLayer.arcDeg ?? 0}°`}
                </span>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
