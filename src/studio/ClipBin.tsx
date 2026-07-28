import { useState } from "react";
import { useProject } from "../state/ProjectContext";
import type { Clip, Beat, OverlayBlendMode } from "../domain/types";
import { CLIP_FILE_ACCEPT } from "../features/ingest/ingest";
import type { IngestStatus } from "./useClipIngest";
import { fmtClock, posterBg } from "./util";
import { getTagStyle } from "../lib/tagPresets";
import FileDropzone from "../design-system/FileDropzone";
import {
  ControlButton,
  InputControl,
} from "../design-system/ControlPrimitives";
import GripIcon from "../design-system/icons/GripIcon";
import CopyIcon from "../design-system/icons/CopyIcon";
import DeleteIcon from "../design-system/icons/DeleteIcon";
import EditIcon from "../design-system/icons/EditIcon";
import Modal from "../design-system/Modal";
import Button from "../design-system/Button";

function UsabilityDots({ score }: { score?: number }) {
  const n = score ?? 0;
  return (
    <span className="st-use">
      {[0, 1, 2, 3, 4].map((i) => (
        <i key={i} className={i < n ? "on" : ""} />
      ))}
    </span>
  );
}

const Grip = () => <GripIcon className="st-grip" />;

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
  onFiles: (files: File[]) => Promise<Clip[]>;
  statuses: Record<string, IngestStatus>;
}

export const CLIP_DRAG_TYPE = "application/x-vidstr-clip-id";

export default function ClipBin({
  usedClipIds,
  selectedClipId,
  hasCut,
  beats,
  onPickClip,
  onAddClip,
  onDuplicateBeat,
  onFiles,
  statuses,
}: Props) {
  const { state, dispatch } = useProject();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [deleteClipTarget, setDeleteClipTarget] = useState<Clip | null>(null);

  const clipById = new Map(state.clips.map((c) => [c.id, c]));

  const allProjectTags = Array.from(
    new Set(state.clips.flatMap((c) => c.tags ?? [])),
  );
  const deleteTargetBeatCount = deleteClipTarget
    ? (state.cut?.beats.filter((beat) => beat.clipId === deleteClipTarget.id)
        .length ?? 0)
    : 0;

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
  const endDrag = () => {
    setDragId(null);
    setOverId(null);
  };

  const unusedClips = state.clips.filter(
    (c) =>
      !usedClipIds.has(c.id) && (!tagFilter || c.tags?.includes(tagFilter)),
  );

  function IngestRow({ clip, addable }: { clip: Clip; addable: boolean }) {
    const st = statuses[clip.id];
    const described = !!clip.description;
    return (
      <div
        className={
          "st-clip" +
          (addable ? " drop" : "") +
          (clip.id === selectedClipId ? " sel" : "")
        }
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(CLIP_DRAG_TYPE, clip.id);
          e.dataTransfer.effectAllowed = "copy";
        }}
        onClick={() => (addable ? onAddClip(clip.id) : onPickClip(clip.id))}
        title={
          addable
            ? "Click or drag into the editor to add this clip to the cut"
            : "Drag into the editor to start a cut"
        }
      >
        <div className="st-thumb" style={{ background: posterBg(clip) }} />
        <div className="st-cmeta">
          <ClipNameEditor clip={clip} />
          {clip.tags && clip.tags.length > 0 && (
            <div
              style={{
                display: "flex",
                gap: 3,
                flexWrap: "wrap",
                marginTop: 2,
              }}
            >
              {clip.tags.map((tag) => {
                const style = getTagStyle(tag);
                return (
                  <span
                    key={tag}
                    style={{
                      fontSize: 8.5,
                      fontWeight: 600,
                      padding: "0px 4px",
                      borderRadius: 3,
                      background: style.bg,
                      color: style.text,
                      border: `1px solid ${style.border}`,
                      lineHeight: 1.2,
                    }}
                  >
                    {tag}
                  </span>
                );
              })}
            </div>
          )}
          <div className="st-crow">
            <span className="st-cdur st-num">{fmtClock(clip.durationSec)}</span>
            {clip.kind === "still" && (
              <span
                className="st-status"
                title="Imported image — runs 10s as a beat"
              >
                still
              </span>
            )}
            {st?.phase === "normalizing" && (
              <span className="st-status">
                normalizing {Math.round(st.progress * 100)}%
              </span>
            )}
            {st?.phase === "error" && (
              <span className="st-status err" title={st.error}>
                failed
              </span>
            )}
            {addable ? (
              <div
                style={{ display: "inline-flex", gap: 4, marginLeft: "auto" }}
              >
                <ControlButton
                  type="button"
                  className="st-btn ghost"
                  style={{ fontSize: 9, padding: "1px 5px" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddClip(clip.id);
                  }}
                  title="Add clip as a sequential beat in the main cut"
                >
                  + Beat
                </ControlButton>
                {clip.kind !== "still" && (
                  <ControlButton
                    type="button"
                    className="st-btn ghost"
                    style={{
                      fontSize: 9,
                      padding: "1px 5px",
                      color: "var(--accent)",
                      borderColor: "var(--accent)",
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      const genId = () =>
                        typeof crypto !== "undefined" && crypto.randomUUID
                          ? crypto.randomUUID()
                          : Math.random().toString(36).slice(2);
                      const nameLower = clip.name.toLowerCase();
                      const isBlend =
                        nameLower.includes("overlay") ||
                        nameLower.includes("leak") ||
                        nameLower.includes("grain") ||
                        nameLower.includes("glitch");
                      dispatch({
                        type: "ADD_OVERLAY",
                        overlay: {
                          id: `overlay-${genId()}`,
                          clipId: clip.id,
                          startTimeSec: 0.5,
                          durationSec: Math.min(5.0, clip.durationSec || 3.0),
                          inSec: 0,
                          outSec: Math.min(5.0, clip.durationSec || 3.0),
                          blendMode: (isBlend
                            ? "screen"
                            : "normal") as OverlayBlendMode,
                          opacity: 0.85,
                          volume: 0,
                        },
                      });
                    }}
                    title="Layer clip as a video overlay on top of beats"
                  >
                    + Overlay
                  </ControlButton>
                )}
              </div>
            ) : described ? (
              <UsabilityDots score={clip.description!.usability} />
            ) : null}
            {!clip.isTemplatePlaceholder && (
              <ControlButton
                className="st-dup-btn"
                title="Delete clip from project"
                aria-label={`Delete ${clip.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  setDeleteClipTarget(clip);
                }}
              >
                <DeleteIcon size={11} />
              </ControlButton>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <aside className="st-col bin">
      <div
        className="st-colhead"
        style={{ display: "flex", alignItems: "center" }}
      >
        <span>Clips</span>
        {state.clips.length > 0 && (
          <span
            className="cnt st-num"
            aria-label={`${state.clips.length} clips`}
          >
            {state.clips.length}
          </span>
        )}
      </div>

      {allProjectTags.length > 0 && (
        <div
          style={{
            padding: "6px 10px",
            display: "flex",
            gap: 4,
            flexWrap: "wrap",
          }}
        >
          <ControlButton
            type="button"
            className={`st-btn ${tagFilter === null ? "primary" : "ghost"}`}
            style={{ fontSize: 9.5, padding: "1px 6px" }}
            onClick={() => setTagFilter(null)}
          >
            All ({state.clips.length})
          </ControlButton>
          {allProjectTags.map((tag) => {
            const active = tagFilter === tag;
            const count = state.clips.filter((c) =>
              c.tags?.includes(tag),
            ).length;
            return (
              <ControlButton
                key={tag}
                type="button"
                className={`st-btn ${active ? "primary" : "ghost"}`}
                style={{ fontSize: 9.5, padding: "1px 6px" }}
                onClick={() => setTagFilter(active ? null : tag)}
              >
                {tag} ({count})
              </ControlButton>
            );
          })}
        </div>
      )}

      <div style={{ margin: "0 12px 10px" }}>
        <FileDropzone
          title="Drop clips here"
          description="Video or images, 4K to 1080p, stills run 10s"
          accept={CLIP_FILE_ACCEPT}
          multiple
          onFiles={onFiles}
        />
      </div>

      <div className="st-cliplist">
        {hasCut ? (
          <>
            <div className="st-binsub">In the cut · drag to reorder</div>
            {beats.map((b, i) => {
              const clip = clipById.get(b.clipId);
              if (!clip) return null;
              if (tagFilter && !clip.tags?.includes(tagFilter)) return null;
              const isOver =
                overId === b.id && dragId !== null && dragId !== b.id;
              return (
                <div
                  key={b.id}
                  className={
                    "st-clip st-drag" +
                    (clip.id === selectedClipId ? " sel" : "") +
                    (dragId === b.id ? " dragging" : "") +
                    (isOver ? " dragover" : "")
                  }
                  draggable
                  onDragStart={(e) => {
                    setDragId(b.id);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    if (overId !== b.id) setOverId(b.id);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragId) reorder(dragId, b.id);
                    endDrag();
                  }}
                  onDragEnd={endDrag}
                  onClick={() => onPickClip(clip.id)}
                  title={clip.name}
                >
                  <Grip />
                  <div
                    className="st-thumb"
                    style={{ background: posterBg(clip) }}
                  />
                  <div className="st-cmeta">
                    <ClipNameEditor clip={clip} />
                    {clip.tags && clip.tags.length > 0 && (
                      <div
                        style={{
                          display: "flex",
                          gap: 3,
                          flexWrap: "wrap",
                          marginTop: 2,
                        }}
                      >
                        {clip.tags.map((tag) => {
                          const style = getTagStyle(tag);
                          return (
                            <span
                              key={tag}
                              style={{
                                fontSize: 8.5,
                                fontWeight: 600,
                                padding: "0px 4px",
                                borderRadius: 3,
                                background: style.bg,
                                color: style.text,
                                border: `1px solid ${style.border}`,
                                lineHeight: 1.2,
                              }}
                            >
                              {tag}
                            </span>
                          );
                        })}
                      </div>
                    )}
                    <div className="st-crow">
                      <span className="st-cdur st-num">
                        {fmtClock(b.durationSec ?? clip.durationSec)}
                      </span>
                      {clip.isTemplatePlaceholder && (
                        <span
                          className="st-status"
                          style={{ color: "var(--accent)" }}
                          title={clip.templateSlotDescription}
                        >
                          empty slot
                        </span>
                      )}
                      <span className="st-beatno st-num">#{i + 1}</span>
                      <ControlButton
                        className="st-dup-btn"
                        title="Duplicate this beat"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDuplicateBeat(b.id);
                        }}
                      >
                        <CopyIcon size={12} />
                      </ControlButton>
                      {!clip.isTemplatePlaceholder && (
                        <ControlButton
                          className="st-dup-btn"
                          title="Delete clip from project"
                          aria-label={`Delete ${clip.name}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            setDeleteClipTarget(clip);
                          }}
                        >
                          <DeleteIcon size={11} />
                        </ControlButton>
                      )}
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

            {unusedClips.length > 0 && (
              <div className="st-binsub">Not in the cut</div>
            )}
            {unusedClips.map((clip) => (
              <IngestRow key={clip.id} clip={clip} addable />
            ))}
          </>
        ) : (
          state.clips
            .filter((c) => !tagFilter || c.tags?.includes(tagFilter))
            .map((clip) => (
              <IngestRow key={clip.id} clip={clip} addable={false} />
            ))
        )}
      </div>
      <Modal
        open={Boolean(deleteClipTarget)}
        title="Delete clip from project?"
        description="The media will be removed from the Clips panel."
        ariaLabel="Confirm clip deletion"
        maxWidth={430}
        onClose={() => setDeleteClipTarget(null)}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setDeleteClipTarget(null)}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (!deleteClipTarget) return;
                dispatch({
                  type: "DELETE_CLIP_FROM_PROJECT",
                  id: deleteClipTarget.id,
                });
                setDeleteClipTarget(null);
              }}
            >
              Delete clip
            </Button>
          </>
        }
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
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
            <DeleteIcon size={19} />
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.5, color: "var(--ink-2)" }}>
            <strong style={{ color: "var(--ink)" }}>
              {deleteClipTarget?.name}
            </strong>
            {deleteTargetBeatCount > 0 ? (
              <span style={{ display: "block", marginTop: 4 }}>
                {deleteTargetBeatCount} referenced beat
                {deleteTargetBeatCount === 1 ? "" : "s"} will remain in place as
                an empty slot, preserving timing and edit settings.
              </span>
            ) : (
              <span style={{ display: "block", marginTop: 4 }}>
                No main timeline beats reference this clip.
              </span>
            )}
            <span
              style={{ display: "block", marginTop: 4, color: "var(--ink-3)" }}
            >
              Overlay and split-screen references to this media will also be
              removed.
            </span>
          </div>
        </div>
      </Modal>
    </aside>
  );
}

function ClipNameEditor({ clip }: { clip: Clip }) {
  const { dispatch } = useProject();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(clip.name);

  if (editing) {
    return (
      <InputControl
        type="text"
        value={name}
        autoFocus
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          setEditing(false);
          if (name.trim() && name.trim() !== clip.name) {
            dispatch({ type: "RENAME_CLIP", id: clip.id, name: name.trim() });
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            setEditing(false);
            if (name.trim() && name.trim() !== clip.name) {
              dispatch({ type: "RENAME_CLIP", id: clip.id, name: name.trim() });
            }
          } else if (e.key === "Escape") {
            setEditing(false);
            setName(clip.name);
          }
        }}
        onClick={(e) => e.stopPropagation()}
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: "var(--ink)",
          background: "var(--panel)",
          border: "1px solid var(--accent)",
          borderRadius: 3,
          padding: "1px 4px",
          outline: "none",
          width: "100%",
          boxSizing: "border-box",
        }}
      />
    );
  }

  return (
    <div
      className="st-cname"
      title="Click the edit icon or double-click to rename clip"
      onDoubleClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
      style={{
        cursor: "text",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 4,
      }}
    >
      <span
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          flex: 1,
        }}
      >
        {clip.name}
      </span>
      <ControlButton
        type="button"
        className="st-rename-btn"
        title="Rename clip"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          setEditing(true);
        }}
        style={{
          background: "none",
          border: "none",
          color: "var(--ink-3)",
          cursor: "pointer",
          padding: "0 2px",
          fontSize: 10,
          display: "inline-flex",
          alignItems: "center",
          opacity: 0.6,
        }}
      >
        <EditIcon size={11} />
      </ControlButton>
    </div>
  );
}
