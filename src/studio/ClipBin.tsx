import { useState, useRef, type DragEvent, type ChangeEvent } from "react";
import { useProject } from "../state/ProjectContext";
import type { Clip, Beat, OverlayBlendMode } from "../domain/types";
import { sampleFrames } from "../lib/frameSampler";
import { runPool } from "../lib/pool";
import { multithreadReady } from "../lib/ffmpegEngine";
import { createClip, needsNormalize, normalizeTo1080p } from "../features/ingest/ingest";
import { fmtClock, posterBg } from "./util";

type Phase = "pending" | "normalizing" | "ready" | "error";
interface Status { phase: Phase; progress: number; error?: string }

// Normalize at most N clips at once. Each 4K wasm transcode is memory-heavy
// (ADR-0002), so cap at 2 concurrent — and stay sequential on low-RAM devices
// (deviceMemory is undefined in some browsers; then we assume enough and use 2).
function normalizeConcurrency(): number {
  if (multithreadReady()) return 1; // MT uses all cores per clip — parallel would oversubscribe
  const mem = (navigator as { deviceMemory?: number }).deviceMemory;
  if (typeof mem === "number" && mem <= 4) return 1;
  return 2;
}

function UsabilityDots({ score }: { score?: number }) {
  const n = score ?? 0;
  return (
    <span className="st-use">
      {[0, 1, 2, 3, 4].map((i) => <i key={i} className={i < n ? "on" : ""} />)}
    </span>
  );
}

const Grip = () => (
  <svg className="st-grip" width="8" height="15" viewBox="0 0 8 15" fill="currentColor" aria-hidden="true">
    <circle cx="2" cy="2" r="1.2" /><circle cx="6" cy="2" r="1.2" />
    <circle cx="2" cy="7.5" r="1.2" /><circle cx="6" cy="7.5" r="1.2" />
    <circle cx="2" cy="13" r="1.2" /><circle cx="6" cy="13" r="1.2" />
  </svg>
);

interface Props {
  /** Clip ids currently used by a Beat (for the used/unused affordance). */
  usedClipIds: Set<string>;
  selectedClipId: string | null;
  /** True once a Cut exists — only then can a clip be added to it. */
  hasCut: boolean;
  /** The Cut's beats, in order — used to show/reorder clips by cut position. */
  beats: Beat[];
  onPickClip: (clipId: string) => void;
  onAddClip: (clipId: string) => void;
  onDuplicateBeat: (beatId: string) => void;
  onAnalyzeClips?: (clipId?: string) => void;
  busy?: boolean;
}

export default function ClipBin({ usedClipIds, selectedClipId, hasCut, beats, onPickClip, onAddClip, onDuplicateBeat, onAnalyzeClips, busy }: Props) {
  const { state, dispatch } = useProject();
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const [dragging, setDragging] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const setStatus = (id: string, s: Status) => setStatuses((p) => ({ ...p, [id]: s }));
  const clipById = new Map(state.clips.map((c) => [c.id, c]));

  async function handleFiles(files: File[]) {
    const videos = files.filter((f) => f.type.startsWith("video/") || /\.(mp4|mov|m4v|webm)$/i.test(f.name));
    if (videos.length === 0) return;

    const created: Clip[] = [];
    for (const f of videos) {
      try { created.push(await createClip(f)); } catch { /* unreadable — skip */ }
    }
    if (created.length) dispatch({ type: "ADD_CLIPS", clips: created });

    // Poster + normalize each clip, up to `normalizeConcurrency()` at once.
    await runPool(created, normalizeConcurrency(), async (clip) => {
      setStatus(clip.id, { phase: "pending", progress: 0 });
      try {
        const [frame] = await sampleFrames(clip.file, 1);
        if (frame) dispatch({ type: "SET_POSTER", id: clip.id, poster: frame.dataUrl });
      } catch { /* poster best-effort */ }

      if (needsNormalize(clip)) {
        setStatus(clip.id, { phase: "normalizing", progress: 0 });
        try {
          const blob = await normalizeTo1080p(clip.file, (p) => setStatus(clip.id, { phase: "normalizing", progress: p }));
          dispatch({ type: "SET_NORMALIZED", id: clip.id, normalized: blob });
          setStatus(clip.id, { phase: "ready", progress: 1 });
        } catch (e) {
          setStatus(clip.id, { phase: "error", progress: 0, error: e instanceof Error ? e.message : String(e) });
        }
      } else {
        setStatus(clip.id, { phase: "ready", progress: 1 });
      }
    });
  }

  const onDropFiles = (e: DragEvent) => { e.preventDefault(); setDragging(false); handleFiles(Array.from(e.dataTransfer.files)); };
  const onPick = (e: ChangeEvent<HTMLInputElement>) => { if (e.target.files) handleFiles(Array.from(e.target.files)); e.target.value = ""; };

  // Drag-to-reorder the cut, keyed by beat id so it's robust to filtering.
  function reorder(draggedBeatId: string, targetBeatId: string) {
    if (draggedBeatId === targetBeatId) return;
    const ids = beats.map((b) => b.id);
    const from = ids.indexOf(draggedBeatId);
    const to = ids.indexOf(targetBeatId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    dispatch({ type: "REORDER_BEATS", order: ids });
  }
  const endDrag = () => { setDragId(null); setOverId(null); };

  const unusedClips = state.clips.filter((c) => !usedClipIds.has(c.id));

  function IngestRow({ clip, addable }: { clip: Clip; addable: boolean }) {
    const st = statuses[clip.id];
    const described = !!clip.description;
    return (
      <div
        className={"st-clip" + (addable ? " drop" : "") + (clip.id === selectedClipId ? " sel" : "")}
        onClick={() => (addable ? onAddClip(clip.id) : onPickClip(clip.id))}
        title={addable ? "Add this clip to the cut" : clip.name}
      >
        <div className="st-thumb" style={{ background: posterBg(clip) }} />
        <div className="st-cmeta">
          <div className="st-cname">{clip.name}</div>
          <div className="st-crow">
            <span className="st-cdur st-num">{fmtClock(clip.durationSec)}</span>
            {st?.phase === "normalizing" && <span className="st-status">normalizing {Math.round(st.progress * 100)}%</span>}
            {st?.phase === "error" && <span className="st-status err" title={st.error}>failed</span>}
            {addable ? (
              <div style={{ display: "inline-flex", gap: 4, marginLeft: "auto" }}>
                <button
                  type="button"
                  className="st-btn ghost"
                  style={{ fontSize: 9, padding: "1px 5px" }}
                  onClick={(e) => { e.stopPropagation(); onAddClip(clip.id); }}
                  title="Add clip as a sequential beat in the main cut"
                >
                  + Beat
                </button>
                <button
                  type="button"
                  className="st-btn ghost"
                  style={{ fontSize: 9, padding: "1px 5px", color: "var(--accent)", borderColor: "var(--accent)" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    const genId = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
                    const nameLower = clip.name.toLowerCase();
                    const isBlend = nameLower.includes("overlay") || nameLower.includes("leak") || nameLower.includes("grain") || nameLower.includes("glitch");
                    dispatch({
                      type: "ADD_OVERLAY",
                      overlay: {
                        id: `overlay-${genId()}`,
                        clipId: clip.id,
                        startTimeSec: 0.5,
                        durationSec: Math.min(5.0, clip.durationSec || 3.0),
                        inSec: 0,
                        outSec: Math.min(5.0, clip.durationSec || 3.0),
                        blendMode: (isBlend ? "screen" : "normal") as OverlayBlendMode,
                        opacity: 0.85,
                        volume: 0,
                      },
                    });
                  }}
                  title="Layer clip as a video overlay on top of beats"
                >
                  + Overlay
                </button>
              </div>
            ) : described ? (
              <UsabilityDots score={clip.description!.usability} />
            ) : null}
            {onAnalyzeClips && (
              <button
                type="button"
                className="st-btn ghost"
                style={{ fontSize: 9, padding: "1px 5px", marginLeft: "auto" }}
                onClick={(e) => { e.stopPropagation(); onAnalyzeClips(clip.id); }}
                disabled={busy}
                title="Analyze this single clip with Claude vision model"
              >
                {described ? "Re-analyze" : "Analyze"}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const [stockOpen, setStockOpen] = useState(false);
  const [stockCategories, setStockCategories] = useState<{ category: string; files: string[] }[]>([]);
  const [loadingStock, setLoadingStock] = useState(false);

  async function openStockPicker() {
    setStockOpen(true);
    setLoadingStock(true);
    try {
      const res = await fetch("/api/overlays/list");
      const data = await res.json();
      setStockCategories(data.categories ?? []);
    } catch {
      setStockCategories([]);
    } finally {
      setLoadingStock(false);
    }
  }

  async function importStockOverlay(category: string, name: string) {
    setLoadingStock(true);
    try {
      const res = await fetch(`/api/overlays/file?category=${encodeURIComponent(category)}&name=${encodeURIComponent(name)}`);
      const blob = await res.blob();
      const file = new File([blob], name, { type: "video/mp4" });
      const created = await createClip(file);
      dispatch({ type: "ADD_CLIPS", clips: [created] });

      if (hasCut) {
        const genId = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
        const newOverlay = {
          id: `overlay-${genId()}`,
          clipId: created.id,
          startTimeSec: 0.5,
          durationSec: Math.min(5.0, created.durationSec || 3.0),
          inSec: 0,
          outSec: Math.min(5.0, created.durationSec || 3.0),
          blendMode: (category.includes("light") || category.includes("leak") ? "screen" : "normal") as any,
          opacity: 0.85,
          volume: 0,
        };
        dispatch({ type: "ADD_OVERLAY", overlay: newOverlay });
      }
    } catch (e) {
      alert("Failed to import stock overlay: " + String(e));
    } finally {
      setLoadingStock(false);
      setStockOpen(false);
    }
  }

  return (
    <aside className="st-col bin">
      <div className="st-colhead" style={{ display: "flex", alignItems: "center" }}>
        <span>Clips</span>
        {state.clips.length > 0 && <span className="cnt st-num" style={{ marginLeft: 6 }}>{state.clips.length}</span>}
        {onAnalyzeClips && state.clips.length > 0 && (
          <button
            type="button"
            className="st-btn ghost"
            style={{ marginLeft: "auto", fontSize: 11, padding: "3px 8px", textTransform: "none", letterSpacing: 0 }}
            onClick={() => onAnalyzeClips()}
            disabled={busy}
            title="Step 1: Analyze all footage with Claude vision model"
          >
            1. Analyze Clips
          </button>
        )}
      </div>

      <div
        className={"st-drop" + (dragging ? " drag" : "")}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDropFiles}
        onClick={() => inputRef.current?.click()}
      >
        <b>Drop clips here</b>
        or click to choose · 4K → 1080p on import
        <input ref={inputRef} type="file" accept="video/*" multiple hidden onChange={onPick} />
      </div>

      <div style={{ padding: "4px 8px" }}>
        <button
          type="button"
          className="st-btn ghost"
          style={{ width: "100%", justifyContent: "center", gap: 6, fontSize: 11, padding: "5px 8px", borderColor: "var(--accent)", color: "var(--accent)" }}
          onClick={openStockPicker}
          title="Browse & import built-in overlay video clips from overlays/ folder"
        >
          ✨ Browse Stock Overlays Library
        </button>
      </div>

      {stockOpen && (
        <div className="st-modal-scrim" onClick={() => setStockOpen(false)}>
          <div className="st-modal-card" style={{ maxWidth: 500, width: "90%" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "var(--accent)" }}>🎞️ Stock Overlays Library</h3>
              <button className="st-btn ghost" style={{ padding: "2px 8px" }} onClick={() => setStockOpen(false)}>✕</button>
            </div>

            {loadingStock ? (
              <div style={{ padding: 24, textAlign: "center", color: "var(--ink-2)" }}>Loading overlays library…</div>
            ) : stockCategories.length === 0 ? (
              <div style={{ padding: 16, textAlign: "center", color: "var(--ink-2)", fontSize: 12 }}>
                No video files found in <code>overlays/</code> subdirectories. Add MP4 videos to <code>overlays/light-leaks/</code> or other category subfolders.
              </div>
            ) : (
              <div style={{ maxHeight: 350, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
                {stockCategories.map((cat) => (
                  <div key={cat.category} style={{ background: "var(--panel-2)", borderRadius: 6, padding: 8, border: "1px solid var(--line)" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "var(--accent)", marginBottom: 6 }}>
                      📂 {cat.category} ({cat.files.length})
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {cat.files.map((file) => (
                        <div
                          key={file}
                          onClick={() => importStockOverlay(cat.category, file)}
                          style={{
                            padding: "6px 10px",
                            background: "var(--panel-3)",
                            borderRadius: 4,
                            fontSize: 12,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            cursor: "pointer",
                            transition: "background 0.1s",
                          }}
                        >
                          <span style={{ color: "var(--ink)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>🎬 {file}</span>
                          <span style={{ fontSize: 10, color: "var(--accent)", fontWeight: 600 }}>+ Import & Layer</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="st-cliplist">
        {hasCut ? (
          <>
            <div className="st-binsub">In the cut · drag to reorder</div>
            {beats.map((b, i) => {
              const clip = clipById.get(b.clipId);
              if (!clip) return null;
              const isOver = overId === b.id && dragId !== null && dragId !== b.id;
              return (
                <div
                  key={b.id}
                  className={"st-clip st-drag" + (clip.id === selectedClipId ? " sel" : "") + (dragId === b.id ? " dragging" : "") + (isOver ? " dragover" : "")}
                  draggable
                  onDragStart={(e) => { setDragId(b.id); e.dataTransfer.effectAllowed = "move"; }}
                  onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (overId !== b.id) setOverId(b.id); }}
                  onDrop={(e) => { e.preventDefault(); if (dragId) reorder(dragId, b.id); endDrag(); }}
                  onDragEnd={endDrag}
                  onClick={() => onPickClip(clip.id)}
                  title={clip.name}
                >
                  <Grip />
                  <div className="st-thumb" style={{ background: posterBg(clip) }} />
                  <div className="st-cmeta">
                    <div className="st-cname">{clip.name}</div>
                    <div className="st-crow">
                      <span className="st-cdur st-num">{fmtClock(b.durationSec ?? clip.durationSec)}</span>
                      <span className="st-beatno st-num">#{i + 1}</span>
                      <button
                        className="st-dup-btn"
                        title="Duplicate this beat"
                        onClick={(e) => { e.stopPropagation(); onDuplicateBeat(b.id); }}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                        </svg>
                      </button>
                    </div>
                    {b.captionText && (
                      <div className="st-ccap" title={b.captionText}>
                        {b.captionText}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {unusedClips.length > 0 && <div className="st-binsub">Not in the cut</div>}
            {unusedClips.map((clip) => <IngestRow key={clip.id} clip={clip} addable />)}
          </>
        ) : (
          state.clips.map((clip) => <IngestRow key={clip.id} clip={clip} addable={false} />)
        )}
      </div>
    </aside>
  );
}
