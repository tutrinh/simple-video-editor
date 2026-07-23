import { useState, useEffect, useRef } from "react";
import { useProject } from "../state/ProjectContext";
import type { Cut, Clip, OverlayClip, OverlayBlendMode } from "../domain/types";
import { cutDuration } from "../features/assemble/assemble";
import { createClip } from "../features/ingest/ingest";
import { fmtSecs, posterBg } from "./util";
import OverlayPickerModal from "./OverlayPickerModal";

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

  function addOverlayWithClip(targetClip: Clip, blendMode?: OverlayBlendMode) {
    const genId = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
    const nameLower = targetClip.name.toLowerCase();
    const defaultBlend = (nameLower.includes("overlay") || nameLower.includes("leak") || nameLower.includes("grain") || nameLower.includes("glitch")) ? "screen" : "normal";

    const newOverlay = {
      id: `overlay-${genId()}`,
      clipId: targetClip.id,
      startTimeSec: 1.0,
      durationSec: Math.min(5.0, targetClip.durationSec || 3.0),
      inSec: 0,
      outSec: Math.min(5.0, targetClip.durationSec || 3.0),
      blendMode: blendMode ?? (defaultBlend as OverlayBlendMode),
      opacity: 0.85,
      volume: 0.5,
    };
    dispatch({ type: "ADD_OVERLAY", overlay: newOverlay });
    onSelectOverlay?.(newOverlay.id);
    setPickerOpen(false);
  }

  async function importAndAddStockOverlay(category: string, name: string, blendMode?: OverlayBlendMode) {
    try {
      // Check if clip already imported
      const existing = clips.find((c) => c.name === name);
      if (existing) {
        addOverlayWithClip(existing, blendMode);
        return;
      }

      const res = await fetch(`/api/overlays/file?category=${encodeURIComponent(category)}&name=${encodeURIComponent(name)}`);
      const blob = await res.blob();
      const file = new File([blob], name, { type: "video/mp4" });
      const created = await createClip(file);
      dispatch({ type: "ADD_CLIPS", clips: [created] });
      addOverlayWithClip(created, blendMode);
    } catch (e) {
      alert("Failed to import stock overlay: " + String(e));
    } finally {
      setPickerOpen(false);
    }
  }

  useEffect(() => {
    if (!selectedOverlayId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;

      if (e.key === "Backspace" || e.key === "Delete") {
        dispatch({ type: "REMOVE_OVERLAY", id: selectedOverlayId });
        onSelectOverlay?.(null);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        const genId = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
        const newId = `overlay-${genId()}`;
        dispatch({ type: "DUPLICATE_OVERLAY", id: selectedOverlayId, newOverlayId: newId });
        onSelectOverlay?.(newId);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedOverlayId, dispatch, onSelectOverlay]);

  // The overlay track ref — spans the same width as the beats ruler
  const overlayTrackRef = useRef<HTMLDivElement>(null);
  const [draggingOverlayId, setDraggingOverlayId] = useState<string | null>(null);
  const dragStartRef = useRef<{ startX: number; initialStartSec: number; initialDurationSec: number; mode: "move" | "resize-left" | "resize-right" } | null>(null);

  function startOverlayDrag(e: React.PointerEvent, overlay: OverlayClip, mode: "move" | "resize-left" | "resize-right") {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    onSelectOverlay?.(overlay.id);
    setDraggingOverlayId(overlay.id);
    dragStartRef.current = {
      startX: e.clientX,
      initialStartSec: overlay.startTimeSec,
      initialDurationSec: overlay.durationSec,
      mode,
    };
  }

  function handleOverlayPointerMove(e: React.PointerEvent, overlay: OverlayClip) {
    if (draggingOverlayId !== overlay.id || !dragStartRef.current || !overlayTrackRef.current) return;
    const rect = overlayTrackRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;

    const deltaX = e.clientX - dragStartRef.current.startX;
    const deltaSec = (deltaX / rect.width) * totalDur;

    if (dragStartRef.current.mode === "move") {
      const newStartSec = Math.max(0, Math.min(totalDur - overlay.durationSec, dragStartRef.current.initialStartSec + deltaSec));
      const roundedStart = Math.round(newStartSec * 10) / 10;
      if (roundedStart !== overlay.startTimeSec) {
        dispatch({ type: "UPDATE_OVERLAY", overlay: { ...overlay, startTimeSec: roundedStart } });
      }
    } else if (dragStartRef.current.mode === "resize-right") {
      const newDur = Math.max(0.5, Math.min(totalDur - overlay.startTimeSec, dragStartRef.current.initialDurationSec + deltaSec));
      const roundedDur = Math.round(newDur * 10) / 10;
      if (roundedDur !== overlay.durationSec) {
        dispatch({ type: "UPDATE_OVERLAY", overlay: { ...overlay, durationSec: roundedDur } });
      }
    } else if (dragStartRef.current.mode === "resize-left") {
      const maxDelta = dragStartRef.current.initialDurationSec - 0.5;
      const actualDelta = Math.max(-dragStartRef.current.initialStartSec, Math.min(maxDelta, deltaSec));
      const newStartSec = Math.round((dragStartRef.current.initialStartSec + actualDelta) * 10) / 10;
      const newDur = Math.round((dragStartRef.current.initialDurationSec - actualDelta) * 10) / 10;
      if (newStartSec !== overlay.startTimeSec || newDur !== overlay.durationSec) {
        dispatch({ type: "UPDATE_OVERLAY", overlay: { ...overlay, startTimeSec: newStartSec, durationSec: newDur } });
      }
    }
  }

  function endOverlayDrag(e: React.PointerEvent) {
    if (draggingOverlayId) {
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
      setDraggingOverlayId(null);
      dragStartRef.current = null;
    }
  }

  // Compute cumulative beat start times so we can position the playhead and beat dividers
  const beatStarts: number[] = [];
  let acc = 0;
  for (const b of beats) {
    beatStarts.push(acc);
    acc += b.durationSec;
  }

  // Playhead sits at the midpoint of the selected beat (as % of totalDur)
  const playheadLeft = selIndex >= 0
    ? `${((beatStarts[selIndex] + beats[selIndex].durationSec / 2) / totalDur) * 100}%`
    : "-999px";

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

          <OverlayPickerModal
            isOpen={pickerOpen}
            onClose={() => setPickerOpen(false)}
            cut={cut}
            clips={clips}
            onSelectClip={(clip, blend) => addOverlayWithClip(clip, blend)}
            onImportStockOverlay={(category, file, blend) => importAndAddStockOverlay(category, file, blend)}
          />
        </div>
      </div>

      {/* Scrollable Timeline Tracks Container */}
      <div className="st-tl-scroll">
        <div
          className="st-tl-content"
          style={{ minWidth: `${Math.max(100, beats.length * 145)}px` }}
        >
          {/* ── SHARED TIME RULER + BOTH TRACKS ── */}
          <div className="st-tl-ruler-area">

            {/* Overlay Track Lane — positioned ABOVE the beats, sharing the same proportional ruler */}
            {overlays.length > 0 && (
              <div className="st-ov-lane">
                <div className="st-ov-label">
                  🎞️ Overlay Track <span className="st-ov-label-hint">(Drag to reposition · Drag edges to resize)</span>
                </div>

                {/* The overlay canvas: same width as beats ruler, uses % positioning */}
                <div
                  ref={overlayTrackRef}
                  className="st-ov-canvas"
                >
                  {/* Beat dividers shown inside the overlay canvas for alignment reference */}
                  {beats.map((b, i) => {
                    if (i === 0) return null;
                    const leftPct = (beatStarts[i] / totalDur) * 100;
                    return (
                      <div
                        key={b.id}
                        className="st-ov-divider"
                        style={{ left: `${leftPct}%` }}
                        title={`Beat ${i + 1} starts at ${fmtSecs(beatStarts[i])}`}
                      />
                    );
                  })}

                  {/* Beat number labels inside overlay canvas */}
                  {beats.map((b, i) => {
                    const leftPct = (beatStarts[i] / totalDur) * 100;
                    const widthPct = (b.durationSec / totalDur) * 100;
                    return (
                      <div
                        key={b.id}
                        className="st-ov-beat-label"
                        style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                      >
                        {String(i + 1).padStart(2, "0")}
                      </div>
                    );
                  })}

                  {/* Overlay clips */}
                  {overlays.map((ov) => {
                    const leftPct = (ov.startTimeSec / totalDur) * 100;
                    const widthPct = Math.max(1, (ov.durationSec / totalDur) * 100);
                    const ovClip = clipById.get(ov.clipId);
                    const isSel = ov.id === selectedOverlayId;

                    return (
                      <div
                        key={ov.id}
                        onPointerDown={(e) => startOverlayDrag(e, ov, "move")}
                        onPointerMove={(e) => handleOverlayPointerMove(e, ov)}
                        onPointerUp={endOverlayDrag}
                        className={"st-ov-chip" + (isSel ? " sel" : "")}
                        style={{
                          left: `${leftPct}%`,
                          width: `${widthPct}%`,
                        }}
                        title={`${ovClip?.name ?? "Overlay"} · Start: ${ov.startTimeSec.toFixed(1)}s · Dur: ${ov.durationSec.toFixed(1)}s · Drag to reposition`}
                      >
                        {/* Left Resize Handle */}
                        <div
                          onPointerDown={(e) => startOverlayDrag(e, ov, "resize-left")}
                          className="st-ov-resize-handle left"
                          title="Drag left edge to adjust start time"
                        />

                        <span className="st-ov-chip-mode">{ov.blendMode.toUpperCase()}</span>
                        <span className="st-ov-chip-dot">·</span>
                        <span className="st-ov-chip-name">
                          {ovClip?.name ?? "Overlay"}
                        </span>
                        <span className="st-ov-chip-time">
                          {ov.startTimeSec.toFixed(1)}s–{(ov.startTimeSec + ov.durationSec).toFixed(1)}s
                        </span>

                        <button
                          type="button"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            const genId = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
                            const newId = `overlay-${genId()}`;
                            dispatch({ type: "DUPLICATE_OVERLAY", id: ov.id, newOverlayId: newId });
                            onSelectOverlay?.(newId);
                          }}
                          className="st-ov-action-btn"
                          title="Duplicate overlay clip (Cmd+D / Ctrl+D)"
                        >
                          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                          </svg>
                        </button>

                        <button
                          type="button"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            dispatch({ type: "REMOVE_OVERLAY", id: ov.id });
                            if (selectedOverlayId === ov.id) onSelectOverlay?.(null);
                          }}
                          className="st-ov-action-btn"
                          title="Remove overlay clip"
                        >
                          <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                            <line x1="2" y1="2" x2="10" y2="10" />
                            <line x1="10" y1="2" x2="2" y2="10" />
                          </svg>
                        </button>

                        {/* Right Resize Handle */}
                        <div
                          onPointerDown={(e) => startOverlayDrag(e, ov, "resize-right")}
                          className="st-ov-resize-handle right"
                          title="Drag right edge to adjust duration"
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Beat Track — proportional widths */}
            <div className={"st-track" + (beats.length === 0 ? " empty" : "")}>
              {beats.length === 0 ? (
                <span>No cut yet — Regenerate to build one.</span>
              ) : (
                <>
                  <div className="st-playhead" style={{ left: playheadLeft }} />
                  {beats.map((b, i) => {
                    const clip = clipById.get(b.clipId);
                    // Width proportional to beat duration
                    const widthPct = (b.durationSec / totalDur) * 100;
                    return (
                      <div
                        key={b.id}
                        className={"st-beat" + (b.id === selectedBeatId ? " sel" : "")}
                        style={{ flex: `0 0 ${widthPct}%`, minWidth: `${widthPct}%` }}
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
        </div>
      </div>
    </div>
  );
}
