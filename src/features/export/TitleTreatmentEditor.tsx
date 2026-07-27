import { useEffect, useState } from "react";
import type { TitleLayerSettings } from "../../state/ExportSettingsContext";
import { ensureFontLoadedById, findFontById } from "../../lib/googleFonts";
import { extractTitleStyle, setCopiedTitleStyle, useCopiedTitleStyle } from "../../lib/titleClipboard";
import ColorField from "../../studio/ColorField";
import FontPicker from "../../studio/FontPicker";

/** The weight ladder, shown as a row of `A`s rather than a dropdown. */
const TITLE_WEIGHTS = [
  { value: 300, label: "Light" },
  { value: 400, label: "Normal" },
  { value: 600, label: "Semi-Bold" },
  { value: 700, label: "Bold" },
  { value: 800, label: "Extra Bold" },
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

  /**
   * The one edit funnel — typing, the clear button and paste all land here — so
   * it is also where `enabled` is kept honest about `text`. Every consumer
   * downstream guards `l.enabled && l.text.trim()`, so an empty layer already
   * renders nothing; leaving its box ticked claimed something the export would
   * not do.
   */
  function updateLayer(index: number, patch: Partial<TitleLayerSettings>) {
    onChange(layers.map((l, i) => {
      if (i !== index) return l;
      const next = { ...l, ...patch };
      if (patch.text !== undefined) {
        const had = l.text.trim().length > 0;
        const has = next.text.trim().length > 0;
        // Emptying always disables — that invariant outranks any explicit
        // `enabled` in the patch. Giving an empty layer text turns it back on,
        // since it was only off for want of something to show.
        if (!has) next.enabled = false;
        else if (!had && patch.enabled === undefined) next.enabled = true;
      }
      return next;
    }));
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
      if (l.enabled && l.text.trim()) ensureFontLoadedById(l.fontId);
    });
  }, [layers]);

  const curLayer = layers[activeIdx] ?? layers[0];
  if (!curLayer) return null;

  /**
   * What every consumer downstream actually means by "on" — the flag AND
   * something to show. Derived rather than read straight off `enabled` so a
   * project persisted before this invariant existed still displays honestly,
   * with no migration.
   */
  const isLive = (l: TitleLayerSettings) => l.enabled && !!l.text.trim();

  // "Switched off" is only worth signalling for a layer that HAS something to
  // show. An empty layer is the normal starting state — dimming it and shouting
  // "(Layer Disabled)" at someone about to type in it is noise, and the greyed
  // checkbox already says why it is off.
  const dimmed = !!curLayer.text.trim() && !curLayer.enabled;

  // The layer's own family, so the weight swatches preview the real typeface.
  // A custom upload has no CSS family here — it falls back to inherit, where the
  // weight difference still reads even if the shapes are the panel's font.
  const curFamily = findFontById(curLayer.fontId)?.cssFamily ?? "inherit";

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
              checked={isLive(layer)}
              disabled={!layer.text.trim()}
              onChange={(e) => updateLayer(idx, { enabled: e.target.checked })}
              onClick={(e) => e.stopPropagation()}
              style={{ accentColor: "var(--accent)", cursor: layer.text.trim() ? "pointer" : "not-allowed" }}
              title={layer.text.trim() ? "Enable/disable this title layer" : "Add text to enable this layer"}
            />
            Layer {idx + 1} {layerLabels[idx] ?? ""}
          </button>
        ))}
      </div>

      {/* Active Layer Editor */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, opacity: dimmed ? 0.55 : 1 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {/* The clear button sits inside the field, so the input reserves room
              for it only while there is something to clear. */}
          <div style={{ flex: 1, position: "relative", display: "flex" }}>
            <textarea
              rows={Math.min(4, Math.max(1, curLayer.text.split("\n").length))}
              value={curLayer.text}
              onChange={(e) => updateLayer(activeIdx, { text: e.target.value })}
              placeholder={activeIdx === 0 ? "e.g. SUMMER VIBES\n2026" : activeIdx === 1 ? "e.g. Official Highlight Reel" : "e.g. Presented by VIDSTR"}
              style={{ flex: 1, padding: "7px 10px", paddingRight: curLayer.text ? 26 : 10, fontSize: 12, background: "var(--panel-3)", border: "1px solid var(--line)", borderRadius: 7, color: "var(--ink)", outline: "none", resize: "vertical", fontFamily: "inherit" }}
            />
            {curLayer.text && (
              <button
                type="button"
                onClick={() => updateLayer(activeIdx, { text: "" })}
                title="Clear this layer's text"
                aria-label="Clear title text"
                style={{
                  position: "absolute",
                  right: 6,
                  top: "50%",
                  transform: "translateY(-50%)",
                  width: 16,
                  height: 16,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: "50%",
                  border: "none",
                  background: "var(--line)",
                  color: "var(--ink-2)",
                  cursor: "pointer",
                  padding: 0,
                  fontSize: 12,
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            )}
          </div>
          {dimmed && <span style={{ fontSize: 10, color: "var(--danger)", whiteSpace: "nowrap" }}>(Layer Disabled)</span>}
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
              {/* Each row renders in its own face — a native <select> cannot,
                  since browsers do not reliably honour font-family on <option>. */}
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                Font
                <FontPicker value={curLayer.fontId} onChange={(fontId) => updateLayer(activeIdx, { fontId })} />
              </span>

              {/* flexBasis 100% puts this on its own line in the wrapping row, so
                  it reads as belonging to Font rather than trailing Weight. */}
              {curLayer.fontId === "custom" && (
                <div style={{ flexBasis: "100%", display: "flex", flexDirection: "column", gap: 4, padding: "8px 10px", background: "var(--panel-3)", border: "1px solid var(--line)", borderRadius: 7 }}>
                  <div style={{ fontSize: 11, color: "var(--ink-2)" }}>
                    Upload a <strong>.ttf</strong> or <strong>.otf</strong> font file.
                  </div>
                  <div style={{ fontSize: 10.5, color: "var(--ink-3)", lineHeight: 1.5 }}>
                    Web fonts (<code>.woff</code>, <code>.woff2</code>) will not work — the export
                    draws text from the font's raw outlines, which those formats compress away.
                    The file travels with the project, so it survives save and reload.
                  </div>
                  <input
                    type="file"
                    accept=".ttf,.otf,font/ttf,font/otf"
                    onChange={(e) => updateLayer(activeIdx, { fontFile: e.target.files?.[0] ?? null })}
                    style={{ fontSize: 11, marginTop: 2 }}
                  />
                  {curLayer.fontFile && (
                    <div style={{ fontSize: 10.5, color: "var(--accent)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      ✓ {curLayer.fontFile.name}
                    </div>
                  )}
                </div>
              )}

              {/* Each square shows its own weight in the layer's own font, so
                  the row previews the choice instead of naming it. A <span>
                  rather than a <label>: a label points at one control, and this
                  is five. */}
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                Weight
                <span style={{ display: "inline-flex", gap: 4 }}>
                  {TITLE_WEIGHTS.map((w) => {
                    const on = curLayer.weight === w.value;
                    return (
                      <button
                        key={w.value}
                        type="button"
                        onClick={() => updateLayer(activeIdx, { weight: w.value })}
                        title={`${w.label} (${w.value})`}
                        aria-label={`${w.label} (${w.value})`}
                        aria-pressed={on}
                        style={{
                          width: 26,
                          height: 26,
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          borderRadius: 6,
                          border: on ? "2px solid var(--accent)" : "1px solid var(--line)",
                          background: on ? "rgba(255, 179, 57, 0.15)" : "var(--panel-3)",
                          color: on ? "var(--accent)" : "var(--ink-2)",
                          fontFamily: curFamily,
                          fontWeight: w.value,
                          fontSize: 15,
                          lineHeight: 1,
                          cursor: "pointer",
                          padding: 0,
                        }}
                      >
                        A
                      </button>
                    );
                  })}
                </span>
              </span>

              <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                Size
                <input type="number" min={16} max={300} step={2} value={curLayer.sizePx} onChange={(e) => updateLayer(activeIdx, { sizePx: Number(e.target.value) })} style={{ width: 56, background: "var(--panel-3)", border: "1px solid var(--line)", borderRadius: 6, color: "var(--ink)", padding: "4px 6px", fontSize: 12, textAlign: "right", outline: "none" }} /> px
              </label>

              {/* The shared palette (ADR-0013) — same swatches the Sticker
                  tint row shows, and a colour picked here shows up there. */}
              <ColorField
                value={curLayer.color}
                onChange={(hex) => updateLayer(activeIdx, { color: hex })}
                label="Color"
                noun="text colour"
              />

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
                <span style={{ fontSize: 11, width: 130, color: "var(--ink-2)" }}>Text Box Width</span>
                <input
                  type="range"
                  min={10}
                  max={100}
                  step={1}
                  value={curLayer.boxWidthPct ?? 90}
                  onChange={(e) => updateLayer(activeIdx, { boxWidthPct: Number(e.target.value) })}
                  onDoubleClick={() => updateLayer(activeIdx, { boxWidthPct: 90 })}
                  style={sliderTrackStyle(curLayer.boxWidthPct ?? 90, 10, 100)}
                  title="Double-click to reset box width to 90%"
                />
                <span style={{ fontSize: 10, width: 34, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
                  {curLayer.boxWidthPct ?? 90}%
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
                <span style={{ fontSize: 11, width: 130, color: "var(--ink-2)" }}>Line Height</span>
                <input
                  type="range"
                  min={-2}
                  max={2}
                  step={0.05}
                  value={curLayer.lineHeight ?? 1.0}
                  onChange={(e) => updateLayer(activeIdx, { lineHeight: Number(e.target.value) })}
                  onDoubleClick={() => updateLayer(activeIdx, { lineHeight: 1.0 })}
                  style={sliderTrackStyle(curLayer.lineHeight ?? 1.0, -2, 2)}
                  title="Double-click to reset line height to 1.0"
                />
                <span style={{ fontSize: 10, width: 34, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
                  {(curLayer.lineHeight ?? 1.0).toFixed(2)}
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
