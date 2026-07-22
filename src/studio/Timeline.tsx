import { useState, useEffect } from "react";
import { useProject } from "../state/ProjectContext";
import type { Cut, Clip, OverlayBlendMode } from "../domain/types";
import { cutDuration } from "../features/assemble/assemble";
import { createClip } from "../features/ingest/ingest";
import { fmtSecs, posterBg } from "./util";

interface Props {
  cut: Cut;
  clipById: Map<string, Clip>;
  clips: Clip[];
  selectedBeatId: string | null;
  onSelectBeat: (id: string) => void;
  selectedOverlayId?: string | null;
  onSelectOverlay?: (id: string | null) => void;
}

export default function Timeline({
  cut,
  clipById,
  clips,
  selectedBeatId,
  onSelectBeat,
  selectedOverlayId,
  onSelectOverlay,
}: Props) {
  const { dispatch } = useProject();
  const [pickerOpen, setPickerOpen] = useState(false);
  const beats = cut.beats;
  const overlays = cut.overlays ?? [];
  const totalDur = cutDuration(cut) || 1;
  const selIndex = beats.findIndex((b) => b.id === selectedBeatId);

  function move(index: number, dir: -1 | 1) {
    const j = index + dir;
    if (j < 0 || j >= beats.length) return;
    const ids = beats.map((b) => b.id);
    [ids[index], ids[j]] = [ids[j], ids[index]];
    dispatch({ type: "REORDER_BEATS", order: ids });
  }

  function addOverlayWithClip(targetClip: Clip) {
    const genId = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
    const nameLower = targetClip.name.toLowerCase();
    const isBlend = nameLower.includes("overlay") || nameLower.includes("leak") || nameLower.includes("grain") || nameLower.includes("glitch");

    const newOverlay = {
      id: `overlay-${genId()}`,
      clipId: targetClip.id,
      startTimeSec: 1.0,
      durationSec: Math.min(5.0, targetClip.durationSec || 3.0),
      inSec: 0,
      outSec: Math.min(5.0, targetClip.durationSec || 3.0),
      blendMode: (isBlend ? "screen" : "normal") as OverlayBlendMode,
      opacity: 0.85,
      volume: 0.5,
    };
    dispatch({ type: "ADD_OVERLAY", overlay: newOverlay });
    onSelectOverlay?.(newOverlay.id);
    setPickerOpen(false);
  }

  const [stockCategories, setStockCategories] = useState<{ category: string; files: string[] }[]>([]);
  const [loadingStock, setLoadingStock] = useState(false);

  useEffect(() => {
    if (!pickerOpen) return;
    setLoadingStock(true);
    fetch("/api/overlays/list")
      .then((res) => res.json())
      .then((data) => setStockCategories(data.categories ?? []))
      .catch(() => setStockCategories([]))
      .finally(() => setLoadingStock(false));
  }, [pickerOpen]);

  async function importAndAddStockOverlay(category: string, name: string) {
    setLoadingStock(true);
    try {
      // Check if clip already imported
      const existing = clips.find((c) => c.name === name);
      if (existing) {
        addOverlayWithClip(existing);
        return;
      }

      const res = await fetch(`/api/overlays/file?category=${encodeURIComponent(category)}&name=${encodeURIComponent(name)}`);
      const blob = await res.blob();
      const file = new File([blob], name, { type: "video/mp4" });
      const created = await createClip(file);
      dispatch({ type: "ADD_CLIPS", clips: [created] });
      addOverlayWithClip(created);
    } catch (e) {
      alert("Failed to import stock overlay: " + String(e));
    } finally {
      setLoadingStock(false);
      setPickerOpen(false);
    }
  }

  const playheadLeft = selIndex >= 0 ? `${((selIndex + 0.5) / beats.length) * 100}%` : "-999px";

  return (
    <div className="st-tl">
      <div className="st-tlhead">
        <span className="t">The Cut</span>
        <span className="meta st-num">
          {beats.length} beats · {overlays.length} overlays · {fmtSecs(totalDur)} · {cut.aspect}
        </span>
        <div style={{ position: "relative", marginLeft: "auto" }}>
          <button
            className="st-btn ghost"
            style={{ padding: "2px 8px", fontSize: 11, borderColor: pickerOpen ? "var(--accent)" : undefined }}
            onClick={() => setPickerOpen(!pickerOpen)}
            title="Choose a clip or stock effect to add as a video overlay layer"
          >
            + Add Overlay Clip
          </button>

          {pickerOpen && (
            <div
              style={{
                position: "absolute",
                right: 0,
                top: "100%",
                marginTop: 4,
                zIndex: 100,
                background: "var(--panel-2)",
                border: "1px solid var(--accent)",
                borderRadius: 8,
                boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
                padding: 8,
                width: 280,
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)", padding: "2px 4px", display: "flex", justifyContent: "space-between", borderBottom: "1px solid var(--line)", paddingBottom: 4 }}>
                <span>🎞️ Select Overlay Source</span>
                <span style={{ cursor: "pointer", opacity: 0.7 }} onClick={() => setPickerOpen(false)}>✕</span>
              </div>

              <div style={{ maxHeight: 240, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
                {/* Section 1: Built-in Stock Overlays */}
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "var(--accent)", textTransform: "uppercase", marginBottom: 4 }}>
                    ✨ Stock Overlays Library
                  </div>
                  {loadingStock ? (
                    <div style={{ fontSize: 10, color: "var(--ink-2)", padding: 4 }}>Loading stock library…</div>
                  ) : stockCategories.length === 0 ? (
                    <div style={{ fontSize: 10, color: "var(--ink-2)", padding: 4 }}>No stock overlays found in overlays/ folder</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {stockCategories.map((cat) => (
                        <div key={cat.category} style={{ background: "var(--panel-3)", borderRadius: 4, padding: 4 }}>
                          <div style={{ fontSize: 9, fontWeight: 700, color: "var(--ink-2)", textTransform: "uppercase", marginBottom: 2 }}>
                            📂 {cat.category}
                          </div>
                          {cat.files.map((file) => (
                            <div
                              key={file}
                              onClick={() => importAndAddStockOverlay(cat.category, file)}
                              style={{
                                padding: "4px 6px",
                                borderRadius: 3,
                                fontSize: 11,
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                color: "var(--ink)",
                              }}
                              title={file}
                            >
                              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, marginRight: 4 }}>
                                🎬 {file}
                              </span>
                              <span style={{ fontSize: 9, color: "var(--accent)", fontWeight: 600 }}>+ Add Layer</span>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Section 2: Project Clips */}
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "var(--ink-2)", textTransform: "uppercase", marginBottom: 4 }}>
                    📁 Project Clips
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    {clips.map((c) => {
                      const usedInBeat = beats.some((b) => b.clipId === c.id);
                      return (
                        <div
                          key={c.id}
                          onClick={() => addOverlayWithClip(c)}
                          style={{
                            padding: "4px 6px",
                            background: "var(--panel-3)",
                            borderRadius: 4,
                            fontSize: 11,
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                          }}
                          title={c.name}
                        >
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, marginRight: 6, color: "var(--ink)" }}>
                            🎬 {c.name}
                          </span>
                          <span style={{ fontSize: 9, color: usedInBeat ? "var(--ink-2)" : "var(--accent)", fontWeight: usedInBeat ? 400 : 700 }}>
                            {usedInBeat ? "In Beat" : "⭐ Not in cut"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Overlay Track Lane */}
      {overlays.length > 0 && (
        <div style={{ padding: "6px 12px", background: "var(--panel-2)", borderBottom: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span>🎞️ Overlay Track (B-Roll / Blend Transitions)</span>
          </div>
          <div style={{ position: "relative", height: 32, background: "var(--panel-3)", borderRadius: 6, overflow: "hidden", border: "1px solid var(--line)" }}>
            {overlays.map((ov) => {
              const leftPct = (ov.startTimeSec / totalDur) * 100;
              const widthPct = Math.max(4, (ov.durationSec / totalDur) * 100);
              const ovClip = clipById.get(ov.clipId);
              const isSel = ov.id === selectedOverlayId;

              return (
                <div
                  key={ov.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectOverlay?.(ov.id);
                  }}
                  style={{
                    position: "absolute",
                    left: `${leftPct}%`,
                    width: `${widthPct}%`,
                    top: 2,
                    bottom: 2,
                    background: isSel ? "var(--accent)" : "rgba(255, 179, 57, 0.25)",
                    border: isSel ? "2px solid #fff" : "1px solid var(--accent)",
                    borderRadius: 4,
                    color: isSel ? "#111" : "var(--accent)",
                    fontWeight: 600,
                    fontSize: 10,
                    padding: "2px 6px",
                    cursor: "pointer",
                    overflow: "hidden",
                    whiteSpace: "nowrap",
                    textOverflow: "ellipsis",
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                  title={`Overlay: ${ovClip?.name ?? "Clip"} (${ov.blendMode}, Vol ${Math.round(ov.volume * 100)}%, Opacity ${Math.round(ov.opacity * 100)}%)`}
                >
                  <span>{ov.blendMode.toUpperCase()}</span>
                  <span>·</span>
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{ovClip?.name ?? "Overlay"}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      dispatch({ type: "REMOVE_OVERLAY", id: ov.id });
                      if (selectedOverlayId === ov.id) onSelectOverlay?.(null);
                    }}
                    style={{
                      background: isSel ? "rgba(0,0,0,0.4)" : "rgba(0,0,0,0.25)",
                      border: "none",
                      color: isSel ? "#fff" : "var(--accent)",
                      borderRadius: "50%",
                      width: 16,
                      height: 16,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                      fontSize: 10,
                      fontWeight: 700,
                      lineHeight: 1,
                      marginLeft: "auto",
                      padding: 0,
                    }}
                    title="Remove overlay clip"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className={"st-track" + (beats.length === 0 ? " empty" : "")}>
        {beats.length === 0 ? (
          <span>No cut yet — Regenerate to build one.</span>
        ) : (
          <>
            <div className="st-playhead" style={{ left: playheadLeft }} />
            {beats.map((b, i) => {
              const clip = clipById.get(b.clipId);
              return (
                <div
                  key={b.id}
                  className={"st-beat" + (b.id === selectedBeatId ? " sel" : "")}
                  onClick={() => {
                    onSelectBeat(b.id);
                    onSelectOverlay?.(null);
                  }}
                >
                  <div className="st-bt" style={{ background: posterBg(clip) }}>
                    <span className="bn st-num">{String(i + 1).padStart(2, "0")}</span>
                  </div>
                  <div className="st-bcap">{b.captionText}</div>
                  <div className="st-bdur">
                    <span className="st-num">{fmtSecs(b.durationSec)}</span>
                    <span className="st-reorder">
                      <button
                        title="Move earlier"
                        onClick={(e) => { e.stopPropagation(); move(i, -1); }}
                        disabled={i === 0}
                      >◄</button>
                      <button
                        title="Move later"
                        onClick={(e) => { e.stopPropagation(); move(i, 1); }}
                        disabled={i === beats.length - 1}
                      >►</button>
                    </span>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
