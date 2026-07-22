import { useState, useRef, type DragEvent, type ChangeEvent } from "react";
import { useProject } from "../state/ProjectContext";
import type { Clip, Beat } from "../domain/types";
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
}

export default function ClipBin({ usedClipIds, selectedClipId, hasCut, beats, onPickClip, onAddClip, onDuplicateBeat }: Props) {
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
            {addable ? <span className="st-tag add">+ add</span>
              : described ? <UsabilityDots score={clip.description!.usability} />
              : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <aside className="st-col bin">
      <div className="st-colhead">Clips {state.clips.length > 0 && <span className="cnt st-num">{state.clips.length}</span>}</div>

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
