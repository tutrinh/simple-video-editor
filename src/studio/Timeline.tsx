import { useState, useEffect, useRef, useReducer } from "react";
import { useProject } from "../state/ProjectContext";
import type { Cut, Clip, OverlayClip, OverlayBlendMode, VoSegment, SfxSegment, Sticker } from "../domain/types";
import { cutDuration } from "../features/assemble/assemble";
import { createClip } from "../features/ingest/ingest";
import { fmtSecs } from "./util";

import OverlayPickerModal from "./OverlayPickerModal";
import SfxPicker from "./SfxPicker";
import StickerPicker from "./StickerPicker";
import { stickerFileUrl } from "../lib/stickerLibrary";
import { beatSpans, resolveSticker, resolveSfx } from "../features/export/stickerCanvas";


import { sfxDuration } from "../lib/sfxLibrary";
import { assignSubLanes } from "./subLanes";
import { beatPosterBg } from "../lib/beatPosterCache";


interface Props {
  cut: Cut;
  clipById: Map<string, Clip>;
  clips: Clip[];
  selectedBeatId: string | null;
  onSelectBeat: (id: string) => void;
  selectedOverlayId?: string | null;
  onSelectOverlay?: (id: string | null) => void;
  selectedVoId?: string | null;
  onSelectVo?: (id: string | null) => void;
  selectedSfxId?: string | null;
  onSelectSfx?: (id: string | null) => void;
  selectedStickerId?: string | null;
  onSelectSticker?: (id: string | null) => void;
}

export default function Timeline({
  cut,
  clipById,
  clips,
  selectedBeatId,
  onSelectBeat,
  selectedOverlayId,
  onSelectOverlay,
  selectedVoId,
  onSelectVo,
  selectedSfxId,
  onSelectSfx,
  selectedStickerId,
  onSelectSticker,
}: Props) {
  const { dispatch } = useProject();
  const [, forceUpdate] = useReducer((x) => x + 1, 0);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [sfxPickerOpen, setSfxPickerOpen] = useState(false);
  const [stickerPickerOpen, setStickerPickerOpen] = useState(false);
  const beats = cut.beats;
  const overlays = cut.overlays ?? [];
  const voSegments = cut.voSegments ?? [];
  const sfxSegments = cut.sfxSegments ?? [];
  const stickers = cut.stickers ?? [];
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

  async function importUploadedFiles(files: File[], category: string) {
    const created: Clip[] = [];
    for (const f of files) {
      try {
        const clip = await createClip(f);
        created.push(clip);
        // Persist to overlays/ directory on disk (best-effort — dev server only)
        fetch(
          `/api/overlays/upload?name=${encodeURIComponent(f.name)}&category=${encodeURIComponent(category)}`,
          { method: "POST", body: f, headers: { "content-type": "application/octet-stream" } },
        ).catch(() => {}); // fire-and-forget; don't block timeline use
      } catch (e) {
        console.warn("Failed to import overlay file:", f.name, e);
      }
    }
    if (!created.length) return;
    dispatch({ type: "ADD_CLIPS", clips: created });
    for (const clip of created) {
      addOverlayWithClip(clip);
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
      const maxStart = Math.max(0, totalDur - 0.5);
      const newStartSec = Math.max(0, Math.min(maxStart, dragStartRef.current.initialStartSec + deltaSec));
      const roundedStart = Math.round(newStartSec * 10) / 10;
      const maxDur = Math.max(0.5, totalDur - roundedStart);
      const roundedDur = Math.round(Math.min(overlay.durationSec, maxDur) * 10) / 10;
      if (roundedStart !== overlay.startTimeSec || roundedDur !== overlay.durationSec) {
        dispatch({ type: "UPDATE_OVERLAY", overlay: { ...overlay, startTimeSec: roundedStart, durationSec: roundedDur } });
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

  // ── VO track drag/resize (mirrors the overlay track) ──
  const voTrackRef = useRef<HTMLDivElement>(null);
  const [draggingVoId, setDraggingVoId] = useState<string | null>(null);
  const voDragStartRef = useRef<{ startX: number; initialStartSec: number; initialDurationSec: number; mode: "move" | "resize-left" | "resize-right" } | null>(null);
  const genId = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));

  function addVoSegment() {
    const seg: VoSegment = {
      id: `vo-${genId()}`,
      text: "",
      startTimeSec: Math.round((selIndex >= 0 ? beatStarts[selIndex] : 0) * 10) / 10,
      durationSec: Math.min(2.5, totalDur),
      captionVisible: true,
    };
    dispatch({ type: "ADD_VO", segment: seg });
    onSelectVo?.(seg.id);
    onSelectOverlay?.(null);
  }

  // Migration/convenience: turn existing beat captions into VO segments placed at
  // each beat's start, so authored captions aren't lost when captions move to the track.
  function seedVoFromBeats() {
    let acc = 0;
    const segs: VoSegment[] = [];
    for (const b of beats) {
      const text = b.captionText.trim();
      const dur = b.durationSec || Math.max(0.1, b.outSec - b.inSec);
      if (text) segs.push({ id: `vo-${genId()}`, text, startTimeSec: Math.round(acc * 10) / 10, durationSec: Math.round(dur * 10) / 10, captionVisible: true });
      acc += dur;
    }
    for (const s of segs) dispatch({ type: "ADD_VO", segment: s });
    if (segs[0]) { onSelectVo?.(segs[0].id); onSelectOverlay?.(null); }
  }

  function startVoDrag(e: React.PointerEvent, seg: VoSegment, mode: "move" | "resize-left" | "resize-right") {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    onSelectVo?.(seg.id);
    onSelectOverlay?.(null);
    setDraggingVoId(seg.id);
    voDragStartRef.current = { startX: e.clientX, initialStartSec: seg.startTimeSec, initialDurationSec: seg.durationSec, mode };
  }

  function handleVoPointerMove(e: React.PointerEvent, seg: VoSegment) {
    if (draggingVoId !== seg.id || !voDragStartRef.current || !voTrackRef.current) return;
    const rect = voTrackRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;
    const deltaSec = ((e.clientX - voDragStartRef.current.startX) / rect.width) * totalDur;
    const st = voDragStartRef.current;

    if (st.mode === "move") {
      const maxStart = Math.max(0, totalDur - 0.5);
      const newStartSec = Math.max(0, Math.min(maxStart, st.initialStartSec + deltaSec));
      const roundedStart = Math.round(newStartSec * 10) / 10;
      const maxDur = Math.max(0.5, totalDur - roundedStart);
      const roundedDur = Math.round(Math.min(seg.durationSec, maxDur) * 10) / 10;
      if (roundedStart !== seg.startTimeSec || roundedDur !== seg.durationSec) {
        dispatch({ type: "UPDATE_VO", segment: { ...seg, startTimeSec: roundedStart, durationSec: roundedDur } });
      }
    } else if (st.mode === "resize-right") {
      const newDur = Math.max(0.5, Math.min(totalDur - seg.startTimeSec, st.initialDurationSec + deltaSec));
      const rounded = Math.round(newDur * 10) / 10;
      if (rounded !== seg.durationSec) dispatch({ type: "UPDATE_VO", segment: { ...seg, durationSec: rounded } });
    } else {
      const maxDelta = st.initialDurationSec - 0.5;
      const actualDelta = Math.max(-st.initialStartSec, Math.min(maxDelta, deltaSec));
      const newStartSec = Math.round((st.initialStartSec + actualDelta) * 10) / 10;
      const newDur = Math.round((st.initialDurationSec - actualDelta) * 10) / 10;
      if (newStartSec !== seg.startTimeSec || newDur !== seg.durationSec) {
        dispatch({ type: "UPDATE_VO", segment: { ...seg, startTimeSec: newStartSec, durationSec: newDur } });
      }
    }
  }

  function endVoDrag(e: React.PointerEvent) {
    if (draggingVoId) {
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
      setDraggingVoId(null);
      voDragStartRef.current = null;
    }
  }

  // ── SFX track drag/resize (move + trim-tail only; no start-trim, no loop) ──
  const sfxTrackRef = useRef<HTMLDivElement>(null);
  const [draggingSfxId, setDraggingSfxId] = useState<string | null>(null);
  const sfxDragStartRef = useRef<{ startX: number; initialStartSec: number; initialDurationSec: number; mode: "move" | "resize-right" } | null>(null);

  /** Place a sound from the library as an SFX segment at the selected beat's start. */
  async function addSfxFromLibrary(fileName: string) {
    const dur = (await sfxDuration(fileName)) || 1;
    const rounded = Math.round(dur * 10) / 10;
    const start = Math.round((selIndex >= 0 ? beatStarts[selIndex] : 0) * 10) / 10;
    const seg: SfxSegment = {
      id: `sfx-${genId()}`,
      fileName,
      startTimeSec: Math.min(start, Math.max(0, totalDur - rounded)),
      durationSec: rounded,
      sourceDurationSec: dur,
      volume: 1,
    };
    dispatch({ type: "ADD_SFX", segment: seg });
    onSelectSfx?.(seg.id);
    onSelectVo?.(null);
    onSelectOverlay?.(null);
    onSelectSticker?.(null);
  }

  function startSfxDrag(e: React.PointerEvent, seg: SfxSegment, mode: "move" | "resize-right") {
    const drawn = resolveSfx(seg, beatSpans(beats));
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    onSelectSfx?.(seg.id);
    onSelectVo?.(null);
    onSelectOverlay?.(null);
    onSelectSticker?.(null);
    setDraggingSfxId(seg.id);
    sfxDragStartRef.current = { startX: e.clientX, initialStartSec: drawn.startTimeSec, initialDurationSec: drawn.durationSec, mode };
  }

  function handleSfxPointerMove(e: React.PointerEvent, seg: SfxSegment) {
    if (draggingSfxId !== seg.id || !sfxDragStartRef.current || !sfxTrackRef.current) return;
    const rect = sfxTrackRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;
    const deltaSec = ((e.clientX - sfxDragStartRef.current.startX) / rect.width) * totalDur;
    const st = sfxDragStartRef.current;

    if (st.mode === "move") {
      if (seg.fitToBeat) {
        const cursorPct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const cursorSec = cursorPct * totalDur;
        const spans = beatSpans(beats);
        const targetSpan = spans.find((s) => cursorSec >= s.startSec && cursorSec < s.startSec + s.durationSec) ?? spans[spans.length - 1];
        if (targetSpan && targetSpan.startSec !== seg.startTimeSec) {
          dispatch({ type: "UPDATE_SFX", segment: { ...seg, startTimeSec: targetSpan.startSec } });
        }
        return;
      }
      const maxStart = Math.max(0, totalDur - 0.5);
      const newStartSec = Math.max(0, Math.min(maxStart, st.initialStartSec + deltaSec));
      const roundedStart = Math.round(newStartSec * 10) / 10;
      const maxDur = Math.max(0.1, Math.min(seg.sourceDurationSec, totalDur - roundedStart));
      const roundedDur = Math.round(Math.min(seg.durationSec, maxDur) * 10) / 10;
      if (roundedStart !== seg.startTimeSec || roundedDur !== seg.durationSec) {
        dispatch({ type: "UPDATE_SFX", segment: { ...seg, startTimeSec: roundedStart, durationSec: roundedDur } });
      }
    } else {
      // Trim-tail: clamp to [0.1, min(sourceLength, room-to-cut-end)].
      const maxDur = Math.min(seg.sourceDurationSec, totalDur - seg.startTimeSec);
      const newDur = Math.max(0.1, Math.min(maxDur, st.initialDurationSec + deltaSec));
      const rounded = Math.round(newDur * 10) / 10;
      if (rounded !== seg.durationSec) dispatch({ type: "UPDATE_SFX", segment: { ...seg, durationSec: rounded } });
    }
  }


  function endSfxDrag(e: React.PointerEvent) {
    if (draggingSfxId) {
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
      setDraggingSfxId(null);
      sfxDragStartRef.current = null;
    }
  }

  // ── Sticker track drag/resize (mirrors the SFX track: move + trim-tail) ──
  const stickerTrackRef = useRef<HTMLDivElement>(null);
  const [draggingStickerId, setDraggingStickerId] = useState<string | null>(null);
  const stickerDragStartRef = useRef<{ startX: number; initialStartSec: number; initialDurationSec: number; mode: "move" | "resize-right" } | null>(null);

  /** Place an asset from the library as a Sticker at the selected beat's start. */
  function addStickerFromLibrary(fileName: string) {
    const start = Math.round((selIndex >= 0 ? beatStarts[selIndex] : 0) * 10) / 10;
    const durationSec = Math.min(2, Math.max(0.5, totalDur));
    const sticker: Sticker = {
      id: `sticker-${genId()}`,
      fileName,
      startTimeSec: Math.min(start, Math.max(0, totalDur - durationSec)),
      durationSec,
      // Centred at a quarter of the frame's width — visible immediately, then
      // dragged/scaled from the Inspector.
      x: 0.5,
      y: 0.5,
      scale: 0.25,
      rotation: 0,
      opacity: 1,
      tintColor: "#ffffff",
      tintStrength: 0,
    };
    dispatch({ type: "ADD_STICKER", sticker });
    onSelectSticker?.(sticker.id);
    onSelectSfx?.(null);
    onSelectVo?.(null);
    onSelectOverlay?.(null);
  }

  function startStickerDrag(e: React.PointerEvent, st: Sticker, mode: "move" | "resize-right") {
    // Drag from where the chip is DRAWN, not from the stored start. A pinned
    // sticker is drawn at its beat's start while its stored start sits somewhere
    // inside that beat, so using the stored value made the pixels you drag not
    // match the distance needed to reach the next beat.
    const drawn = resolveSticker(st, beatSpans(beats));
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    onSelectSticker?.(st.id);
    onSelectSfx?.(null);
    onSelectVo?.(null);
    onSelectOverlay?.(null);
    setDraggingStickerId(st.id);
    stickerDragStartRef.current = { startX: e.clientX, initialStartSec: drawn.startTimeSec, initialDurationSec: drawn.durationSec, mode };
  }

  function handleStickerPointerMove(e: React.PointerEvent, st: Sticker) {
    if (draggingStickerId !== st.id || !stickerDragStartRef.current || !stickerTrackRef.current) return;
    const rect = stickerTrackRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;
    const deltaSec = ((e.clientX - stickerDragStartRef.current.startX) / rect.width) * totalDur;
    const d = stickerDragStartRef.current;

    if (d.mode === "move") {
      if (st.fitToBeat) {
        const cursorPct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const cursorSec = cursorPct * totalDur;
        const spans = beatSpans(beats);
        const targetSpan = spans.find((s) => cursorSec >= s.startSec && cursorSec < s.startSec + s.durationSec) ?? spans[spans.length - 1];
        if (targetSpan && targetSpan.startSec !== st.startTimeSec) {
          dispatch({ type: "UPDATE_STICKER", sticker: { ...st, startTimeSec: targetSpan.startSec } });
        }
        return;
      }
      const maxStart = Math.max(0, totalDur - 0.5);
      const newStartSec = Math.max(0, Math.min(maxStart, d.initialStartSec + deltaSec));
      const roundedStart = Math.round(newStartSec * 10) / 10;
      const maxDur = Math.max(0.5, totalDur - roundedStart);
      const roundedDur = Math.round(Math.min(st.durationSec, maxDur) * 10) / 10;
      if (roundedStart !== st.startTimeSec || roundedDur !== st.durationSec) {
        dispatch({ type: "UPDATE_STICKER", sticker: { ...st, startTimeSec: roundedStart, durationSec: roundedDur } });
      }
    } else {
      // Trim-tail: a Sticker has no source length, so the only ceiling is the cut end.
      const maxDur = totalDur - st.startTimeSec;
      const newDur = Math.max(0.1, Math.min(maxDur, d.initialDurationSec + deltaSec));
      const rounded = Math.round(newDur * 10) / 10;
      if (rounded !== st.durationSec) dispatch({ type: "UPDATE_STICKER", sticker: { ...st, durationSec: rounded } });
    }
  }


  function endStickerDrag(e: React.PointerEvent) {
    if (draggingStickerId) {
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
      setDraggingStickerId(null);
      stickerDragStartRef.current = null;
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
          {beats.length} beats · {overlays.length} overlays · {voSegments.length} VO · {sfxSegments.length} SFX · {stickers.length} stickers · {fmtSecs(totalDur)} · {cut.aspect}
        </span>
        {voSegments.length === 0 && beats.some((b) => b.captionText.trim()) && (
          <button
            className="st-btn ghost"
            style={{ padding: "2px 8px", fontSize: 11, marginLeft: "auto" }}
            onClick={seedVoFromBeats}
            title="Create VO segments from your beats' captions, placed at each beat's start"
          >
            ↧ Seed VO from beats
          </button>
        )}
        <button
          className="st-btn ghost"
          style={{ padding: "2px 8px", fontSize: 11, marginLeft: voSegments.length === 0 && beats.some((b) => b.captionText.trim()) ? undefined : "auto" }}
          onClick={addVoSegment}
          title="Add a voiceover segment to the VO track (type its narration in the Inspector)"
        >
          + Add VO
        </button>
        <div style={{ position: "relative" }}>
          <button
            className="st-btn ghost"
            style={{ padding: "2px 8px", fontSize: 11, borderColor: sfxPickerOpen ? "var(--accent)" : undefined }}
            onClick={() => setSfxPickerOpen((o) => !o)}
            title="Add a sound effect to the SFX track (pick or upload a sound)"
          >
            + Add SFX
          </button>
          {sfxPickerOpen && (
            <SfxPicker onPick={(fileName) => addSfxFromLibrary(fileName)} onClose={() => setSfxPickerOpen(false)} />
          )}
        </div>
        <div style={{ position: "relative" }}>
          <button
            className="st-btn ghost"
            style={{ padding: "2px 8px", fontSize: 11, borderColor: stickerPickerOpen ? "var(--accent)" : undefined }}
            onClick={() => setStickerPickerOpen((o) => !o)}
            title="Add a sticker to the Sticker track (pick or upload an image)"
          >
            + Add Sticker
          </button>
          {stickerPickerOpen && (
            <StickerPicker onPick={(fileName) => addStickerFromLibrary(fileName)} onClose={() => setStickerPickerOpen(false)} />
          )}
        </div>
        <div style={{ position: "relative" }}>
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
            onImportFiles={importUploadedFiles}
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
            {/* Overlay Track Lane — video clips placed over beats on a proportional ruler */}

            {overlays.length > 0 && (() => {
              const overlaysWithLanes = assignSubLanes(overlays);
              const maxLane = Math.max(0, ...overlaysWithLanes.map((o) => o.lane));
              const canvasHeight = Math.max(34, (maxLane + 1) * 28 + 4);

              return (
                <div className="st-ov-lane">
                  <div className="st-ov-label">
                    🎞️ Overlay Track <span className="st-ov-label-hint">(Drag to reposition · Drag edges to resize)</span>
                  </div>

                  <div
                    ref={overlayTrackRef}
                    className="st-ov-canvas"
                    style={{ height: canvasHeight }}
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
                    {overlaysWithLanes.map((ov) => {
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
                            top: 3 + ov.lane * 28,
                            height: 24,
                            bottom: "auto",
                            zIndex: isSel ? 30 : 2 + ov.lane,
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
              );
            })()}

            {/* VO Track Lane — narration + captions on an independent proportional ruler */}
            {voSegments.length > 0 && (() => {
              const voWithLanes = assignSubLanes(voSegments);
              const maxLane = Math.max(0, ...voWithLanes.map((s) => s.lane));
              const canvasHeight = Math.max(34, (maxLane + 1) * 28 + 4);

              return (
                <div className="st-vo-lane">
                  <div className="st-vo-label">
                    🎙️ VO Track <span className="st-vo-label-hint">(Drag to reposition · Drag edges to resize)</span>
                  </div>

                  <div ref={voTrackRef} className="st-vo-canvas" style={{ height: canvasHeight }}>
                    {/* Beat dividers for alignment reference */}
                    {beats.map((b, i) => {
                      if (i === 0) return null;
                      return <div key={b.id} className="st-vo-divider" style={{ left: `${(beatStarts[i] / totalDur) * 100}%` }} />;
                    })}

                    {voWithLanes.map((seg) => {
                      const leftPct = (seg.startTimeSec / totalDur) * 100;
                      const widthPct = Math.max(1, (seg.durationSec / totalDur) * 100);
                      const isSel = seg.id === selectedVoId;
                      const snippet = seg.text.trim() || "Empty — type in Inspector";
                      return (
                        <div
                          key={seg.id}
                          onPointerDown={(e) => startVoDrag(e, seg, "move")}
                          onPointerMove={(e) => handleVoPointerMove(e, seg)}
                          onPointerUp={endVoDrag}
                          className={"st-vo-chip" + (isSel ? " sel" : "") + (seg.text.trim() ? "" : " empty")}
                          style={{
                            left: `${leftPct}%`,
                            width: `${widthPct}%`,
                            top: 3 + seg.lane * 28,
                            height: 24,
                            bottom: "auto",
                            zIndex: isSel ? 30 : 2 + seg.lane,
                          }}
                          title={`${snippet} · ${seg.startTimeSec.toFixed(1)}s–${(seg.startTimeSec + seg.durationSec).toFixed(1)}s · ${seg.captionVisible ? "caption visible" : "voiceover only"}`}
                        >
                          <div onPointerDown={(e) => startVoDrag(e, seg, "resize-left")} className="st-vo-resize-handle left" title="Drag to adjust start time" />

                          <span className="st-vo-chip-icon">{seg.captionVisible ? "👁" : "🔇"}</span>
                          <span className="st-vo-chip-text">{snippet}</span>
                          <span className="st-vo-chip-time">{seg.startTimeSec.toFixed(1)}s–{(seg.startTimeSec + seg.durationSec).toFixed(1)}s</span>

                          <button
                            type="button"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => { e.stopPropagation(); const newId = `vo-${genId()}`; dispatch({ type: "DUPLICATE_VO", id: seg.id, newVoId: newId }); onSelectVo?.(newId); }}
                            className="st-vo-action-btn"
                            title="Duplicate VO segment"
                          >
                            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                            </svg>
                          </button>

                          <button
                            type="button"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => { e.stopPropagation(); dispatch({ type: "REMOVE_VO", id: seg.id }); if (selectedVoId === seg.id) onSelectVo?.(null); }}
                            className="st-vo-action-btn"
                            title="Remove VO segment"
                          >
                            <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                              <line x1="2" y1="2" x2="10" y2="10" />
                              <line x1="10" y1="2" x2="2" y2="10" />
                            </svg>
                          </button>

                          <div onPointerDown={(e) => startVoDrag(e, seg, "resize-right")} className="st-vo-resize-handle right" title="Drag to adjust duration" />
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* SFX Track Lane — sound effects on the same proportional ruler */}
            {sfxSegments.length > 0 && (() => {
              const resolvedSfxList = sfxSegments.map((s) => resolveSfx(s, beatSpans(beats)));
              const sfxWithLanes = assignSubLanes(resolvedSfxList);
              const maxLane = Math.max(0, ...sfxWithLanes.map((s) => s.lane));

              const canvasHeight = Math.max(34, (maxLane + 1) * 28 + 4);

              return (
                <div className="st-vo-lane st-sfx-lane">
                  <div className="st-vo-label">
                    🔊 SFX Track <span className="st-vo-label-hint">(Drag to reposition · Drag right edge to trim)</span>
                  </div>

                  <div ref={sfxTrackRef} className="st-vo-canvas" style={{ height: canvasHeight }}>
                    {beats.map((b, i) => {
                      if (i === 0) return null;
                      return <div key={b.id} className="st-vo-divider" style={{ left: `${(beatStarts[i] / totalDur) * 100}%` }} />;
                    })}

                    {sfxWithLanes.map((seg) => {
                      const leftPct = (seg.startTimeSec / totalDur) * 100;
                      const widthPct = Math.max(1, (seg.durationSec / totalDur) * 100);
                      const isSel = seg.id === selectedSfxId;
                      return (
                        <div
                          key={seg.id}
                          onPointerDown={(e) => startSfxDrag(e, seg, "move")}
                          onPointerMove={(e) => handleSfxPointerMove(e, seg)}
                          onPointerUp={endSfxDrag}
                          className={"st-vo-chip st-sfx-chip" + (isSel ? " sel" : "")}
                          style={{
                            left: `${leftPct}%`,
                            width: `${widthPct}%`,
                            top: 3 + seg.lane * 28,
                            height: 24,
                            bottom: "auto",
                            zIndex: isSel ? 30 : 2 + seg.lane,
                          }}
                          title={`${seg.fileName} · ${seg.startTimeSec.toFixed(1)}s–${(seg.startTimeSec + seg.durationSec).toFixed(1)}s · vol ${Math.round(seg.volume * 100)}%`}
                        >
                          <span className="st-vo-chip-icon">{seg.volume === 0 ? "🔇" : "🔊"}</span>
                          <span className="st-vo-chip-text">{seg.fileName}</span>
                          <span className="st-vo-chip-time">{seg.startTimeSec.toFixed(1)}s–{(seg.startTimeSec + seg.durationSec).toFixed(1)}s</span>

                          <button
                            type="button"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => { e.stopPropagation(); const newId = `sfx-${genId()}`; dispatch({ type: "DUPLICATE_SFX", id: seg.id, newSfxId: newId }); onSelectSfx?.(newId); }}
                            className="st-vo-action-btn"
                            title="Duplicate SFX segment"
                          >
                            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                            </svg>
                          </button>

                          <button
                            type="button"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => { e.stopPropagation(); dispatch({ type: "REMOVE_SFX", id: seg.id }); if (selectedSfxId === seg.id) onSelectSfx?.(null); }}
                            className="st-vo-action-btn"
                            title="Remove SFX segment"
                          >
                            <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                              <line x1="2" y1="2" x2="10" y2="10" />
                              <line x1="10" y1="2" x2="2" y2="10" />
                            </svg>
                          </button>

                          <div onPointerDown={(e) => startSfxDrag(e, seg, "resize-right")} className="st-vo-resize-handle right" title="Drag to trim the sound's tail" />
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {stickers.length > 0 && (() => {
              const resolvedStickers = stickers.map((raw) => ({ raw, ...resolveSticker(raw, beatSpans(beats)) }));
              const stickersWithLanes = assignSubLanes(resolvedStickers);
              const maxLane = Math.max(0, ...stickersWithLanes.map((s) => s.lane));
              const canvasHeight = Math.max(34, (maxLane + 1) * 28 + 4);

              return (
                <div className="st-vo-lane st-sticker-lane">
                  <div className="st-vo-label">
                    🩹 Sticker Track <span className="st-vo-label-hint">(Drag to reposition · Drag right edge to trim · Place it in the Inspector)</span>
                  </div>

                  <div ref={stickerTrackRef} className="st-vo-canvas" style={{ height: canvasHeight }}>
                    {beats.map((b, i) => {
                      if (i === 0) return null;
                      return <div key={b.id} className="st-vo-divider" style={{ left: `${(beatStarts[i] / totalDur) * 100}%` }} />;
                    })}

                    {stickersWithLanes.map(({ raw, ...st }) => {
                      const pinned = !!raw.fitToBeat;
                      const leftPct = (st.startTimeSec / totalDur) * 100;
                      const widthPct = Math.max(1, (st.durationSec / totalDur) * 100);
                      const isSel = st.id === selectedStickerId;
                      return (
                        <div
                          key={st.id}
                          onPointerDown={(e) => startStickerDrag(e, raw, "move")}
                          onPointerMove={(e) => handleStickerPointerMove(e, raw)}
                          onPointerUp={endStickerDrag}
                          className={"st-vo-chip st-sticker-chip" + (isSel ? " sel" : "") + (pinned ? " pinned" : "")}
                          style={{
                            left: `${leftPct}%`,
                            width: `${widthPct}%`,
                            top: 3 + st.lane * 28,
                            height: 24,
                            bottom: "auto",
                            zIndex: isSel ? 30 : 2 + st.lane,
                          }}
                          title={`${st.fileName} · ${st.startTimeSec.toFixed(1)}s–${(st.startTimeSec + st.durationSec).toFixed(1)}s · ${Math.round(st.scale * 100)}% · ${st.rotation.toFixed(0)}°${pinned ? " · fits its beat — drag to another beat to move it" : ""}`}
                        >
                          <span className="st-vo-chip-icon"><img src={stickerFileUrl(st.fileName)} alt="" /></span>
                          <span className="st-vo-chip-text">{st.fileName}</span>
                          <span className="st-vo-chip-time">{st.startTimeSec.toFixed(1)}s–{(st.startTimeSec + st.durationSec).toFixed(1)}s</span>

                          <button
                            type="button"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => { e.stopPropagation(); const newId = `sticker-${genId()}`; dispatch({ type: "DUPLICATE_STICKER", id: raw.id, newStickerId: newId }); onSelectSticker?.(newId); }}
                            className="st-vo-action-btn"
                            title="Duplicate sticker"
                          >
                            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                            </svg>
                          </button>

                          <button
                            type="button"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => { e.stopPropagation(); dispatch({ type: "REMOVE_STICKER", id: raw.id }); if (selectedStickerId === raw.id) onSelectSticker?.(null); }}
                            className="st-vo-action-btn"
                            title="Remove sticker"
                          >
                            <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                              <line x1="2" y1="2" x2="10" y2="10" />
                              <line x1="10" y1="2" x2="2" y2="10" />
                            </svg>
                          </button>

                          {!pinned && (
                            <div onPointerDown={(e) => startStickerDrag(e, raw, "resize-right")} className="st-vo-resize-handle right" title="Drag to change how long the sticker shows" />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

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
                        <div className="st-bt" style={{ background: beatPosterBg(b, clip, forceUpdate), position: "relative" }}>
                          {b.splitScreen && b.splitScreen.layout !== "none" && (
                            <span style={{ position: "absolute", top: 4, right: 4, background: "rgba(139,124,255,0.9)", color: "#fff", fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 3, zIndex: 5, backdropFilter: "blur(4px)" }}>
                              🥞 Split
                            </span>
                          )}
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
