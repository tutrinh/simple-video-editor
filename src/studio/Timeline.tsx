import { useState, useEffect, useLayoutEffect, useMemo, useRef, useReducer, type PointerEvent as ReactPointerEvent } from "react";
import { useProject } from "../state/ProjectContext";
import type { Cut, Clip, OverlayClip, OverlayBlendMode, VoSegment, SfxSegment, UserVoiceSegment, Sticker } from "../domain/types";
import { cutDuration } from "../features/assemble/assemble";
import { beatTiming } from "../domain/beatTiming";
import { createClip } from "../features/ingest/ingest";
import { fmtSecs, sliderTrackStyle } from "./util";

import OverlayPickerModal from "./OverlayPickerModal";
import SfxPicker from "./SfxPicker";
import StickerPicker from "./StickerPicker";
import { stickerFileUrl } from "../lib/stickerLibrary";
import { beatSpans, resolveSticker, resolveSfx } from "../features/export/stickerCanvas";


import { sfxDuration } from "../lib/sfxLibrary";
import { assignSubLanes } from "./subLanes";
import { moveVoGroup } from "../domain/voGroupDrag";
import type { SelectionModifiers } from "./timelineSelection";
import { beatPosterBg } from "../lib/beatPosterCache";
import { ControlButton, InputControl } from "../design-system/ControlPrimitives";
import CopyIcon from "../design-system/icons/CopyIcon";
import CloseIcon from "../design-system/icons/CloseIcon";
import DeleteIcon from "../design-system/icons/DeleteIcon";
import SplitClipPickerModal from "./SplitClipPickerModal";
import {
  anchoredScrollLeft,
  clampTimelineZoom,
  timelineCanvasWidth,
  TIMELINE_ZOOM_MAX,
  TIMELINE_ZOOM_MIN,
  TIMELINE_ZOOM_STEP,
} from "./timelineScale";
import {
  TimelineAddButton,
  TimelineCanvas,
  TimelineDivider,
  TimelineHeader,
  TimelineLane,
  TimelineLaneCanvas,
  TimelineResizeHandle,
  TimelineSegment,
  TimelineShell,
  TimelineViewport,
  TimelineZoom,
} from "../design-system/EditorTimeline";
import { activeBeatTitleCount } from "./beatTitleIndex";
import { isSupportedUserVoiceFile, makeImportedUserVoiceSegment, readAudioFileDuration } from "./importUserVoice";
import UserVoiceWaveform, { downsampleWaveform } from "./UserVoiceWaveform";
import Waveform from "../design-system/Waveform";
import { prepareMusicTrack, snapBeatEndToMusicCue, type MusicImportProgress } from "../features/music-track/musicTrack";
import { fetchMusicFile, uploadMusic } from "../lib/musicLibrary";
import MusicPicker from "./MusicPicker";
import { activeSpeedRamp } from "../domain/speedRamp";
import { SpeedRampBand, rampFrameAtProgress } from "../features/speed-ramp/SpeedRampGraph";
import { overlayCreationVisual, resolveOverlayClip } from "../domain/overlayClip";


interface Props {
  cut: Cut;
  clipById: Map<string, Clip>;
  clips: Clip[];
  selectedBeatId: string | null;
  onSelectBeat: (id: string) => void;
  isPlaying?: boolean;
  selectedOverlayId?: string | null;
  onSelectOverlay?: (id: string | null) => void;
  selectedVoId?: string | null;
  onSelectVo?: (id: string | null) => void;
  /** Every selected VO chip. Falls back to `selectedVoId` when the host doesn't multi-select. */
  selectedVoIds?: string[];
  /**
   * Pointer-down on a VO chip, with the modifiers that decide replace / toggle / range.
   * Returns the resulting selection so the drag that this same event starts can snapshot
   * the right group — reading state back would give the pre-click selection.
   */
  onSelectVoMulti?: (id: string, modifiers: SelectionModifiers, orderedIds: string[]) => string[];
  selectedSfxId?: string | null;
  onSelectSfx?: (id: string | null) => void;
  selectedUserVoiceId?: string | null;
  onSelectUserVoice?: (id: string | null) => void;
  selectedStickerId?: string | null;
  onSelectSticker?: (id: string | null) => void;
  onRequestDeleteSegment: (kind: "overlay" | "voiceover" | "sound effect" | "user voice" | "sticker", id: string, label: string) => void;
}

export default function Timeline({
  cut,
  clipById,
  clips,
  selectedBeatId,
  onSelectBeat,
  isPlaying = false,
  selectedOverlayId,
  onSelectOverlay,
  selectedVoId,
  onSelectVo,
  selectedVoIds,
  onSelectVoMulti,
  selectedSfxId,
  onSelectSfx,
  selectedUserVoiceId,
  onSelectUserVoice,
  selectedStickerId,
  onSelectSticker,
  onRequestDeleteSegment,
}: Props) {
  const { state, dispatch } = useProject();
  const [, forceUpdate] = useReducer((x) => x + 1, 0);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [sfxPickerOpen, setSfxPickerOpen] = useState(false);
  const [stickerPickerOpen, setStickerPickerOpen] = useState(false);
  const [assignPlaceholderBeatId, setAssignPlaceholderBeatId] = useState<string | null>(null);
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const userVoiceFileInputRef = useRef<HTMLInputElement>(null);
  const [musicImport, setMusicImport] = useState<MusicImportProgress | null>(null);
  const [musicError, setMusicError] = useState("");
  const [selectedMusicCueSec, setSelectedMusicCueSec] = useState<number | null>(null);
  const [musicPickerOpen, setMusicPickerOpen] = useState(false);
  const timelineMinimapRef = useRef<HTMLDivElement>(null);
  const [timelineViewportWidth, setTimelineViewportWidth] = useState(0);
  const [timelineScrollLeft, setTimelineScrollLeft] = useState(0);
  const [timelineZoom, setTimelineZoomState] = useState(() => {
    if (typeof localStorage === "undefined") return TIMELINE_ZOOM_MIN;
    return clampTimelineZoom(Number(localStorage.getItem("vidstr_timeline_zoom") ?? TIMELINE_ZOOM_MIN));
  });
  const beats = cut.beats;
  const clipDurationById = useMemo(() => new Map(clips.map((clip) => [clip.id, clip.durationSec])), [clips]);
  const overlays = (cut.overlays ?? []).map((overlay) => resolveOverlayClip(overlay, cut.beats, clipDurationById));
  const voSegments = cut.voSegments ?? [];
  // Shift-click spans a range in timeline order, which is not the array order.
  const voSegmentsInTimelineOrder = [...voSegments].sort(
    (a, b) => a.startTimeSec - b.startTimeSec || a.id.localeCompare(b.id),
  );
  const sfxSegments = cut.sfxSegments ?? [];
  const userVoiceSegments = cut.userVoiceSegments ?? [];
  const stickers = cut.stickers ?? [];
  const musicTrack = state.musicTrack;
  const totalDur = cutDuration(cut) || 1;
  const selIndex = beats.findIndex((b) => b.id === selectedBeatId);
  const timelineWidth = timelineViewportWidth > 0
    ? timelineCanvasWidth(timelineViewportWidth, timelineZoom)
    : 0;
  const minimapViewportWidth = timelineWidth > 0
    ? Math.min(100, (timelineViewportWidth / timelineWidth) * 100)
    : 100;
  const minimapViewportStart = timelineWidth > 0
    ? Math.min(100 - minimapViewportWidth, (timelineScrollLeft / timelineWidth) * 100)
    : 0;

  useLayoutEffect(() => {
    const viewport = timelineScrollRef.current;
    if (!viewport) return;
    const measure = () => setTimelineViewportWidth(viewport.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    try { localStorage.setItem("vidstr_timeline_zoom", String(timelineZoom)); } catch {}
  }, [timelineZoom]);

  function setTimelineZoom(nextValue: number) {
    const next = clampTimelineZoom(nextValue);
    if (next === timelineZoom) return;
    const viewport = timelineScrollRef.current;
    if (!viewport || timelineViewportWidth <= 0) {
      setTimelineZoomState(next);
      return;
    }
    const anchorX = viewport.clientWidth / 2;
    const oldWidth = timelineCanvasWidth(timelineViewportWidth, timelineZoom);
    const newWidth = timelineCanvasWidth(timelineViewportWidth, next);
    const nextScrollLeft = anchoredScrollLeft(
      viewport.scrollLeft,
      anchorX,
      oldWidth,
      newWidth,
      viewport.clientWidth,
    );
    setTimelineZoomState(next);
    requestAnimationFrame(() => {
      if (timelineScrollRef.current) {
        timelineScrollRef.current.scrollLeft = nextScrollLeft;
        setTimelineScrollLeft(nextScrollLeft);
      }
    });
  }

  async function importMusicTrack(file: File) {
    setMusicError("");
    try {
      const track = await prepareMusicTrack(file, setMusicImport);
      const fileName = await uploadMusic(track.file);
      setSelectedMusicCueSec(null);
      dispatch({ type: "SET_MUSIC_TRACK", track: { ...track, fileName } });
      setMusicPickerOpen(false);
    } catch (error) {
      setMusicError(error instanceof Error ? error.message : String(error));
    } finally {
      setMusicImport(null);
    }
  }

  async function selectMusicFromLibrary(fileName: string) {
    setMusicError("");
    try {
      setMusicImport({ phase: "analyzing", progress: 0 });
      const file = await fetchMusicFile(fileName);
      const track = await prepareMusicTrack(file, setMusicImport);
      setSelectedMusicCueSec(null);
      dispatch({ type: "SET_MUSIC_TRACK", track: { ...track, fileName } });
      setMusicPickerOpen(false);
    } catch (error) {
      setMusicError(error instanceof Error ? error.message : String(error));
    } finally {
      setMusicImport(null);
    }
  }

  function seekTimelineFromMinimap(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.type === "pointermove" && event.buttons !== 1) return;
    const minimap = timelineMinimapRef.current;
    const viewport = timelineScrollRef.current;
    if (!minimap || !viewport) return;
    const rect = minimap.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const maxScroll = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    const nextScrollLeft = Math.max(0, Math.min(maxScroll, ratio * viewport.scrollWidth - viewport.clientWidth / 2));
    viewport.scrollLeft = nextScrollLeft;
    setTimelineScrollLeft(nextScrollLeft);
  }

  function move(index: number, dir: -1 | 1) {
    const j = index + dir;
    if (j < 0 || j >= beats.length) return;
    const ids = beats.map((b) => b.id);
    [ids[index], ids[j]] = [ids[j], ids[index]];
    dispatch({ type: "REORDER_BEATS", order: ids });
  }

  function addOverlayWithClip(targetClip: Clip, blendMode?: OverlayBlendMode) {
    const genId = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
    const visualDefaults = overlayCreationVisual(targetClip.name, blendMode);
    const isEffectOverlay = visualDefaults.layoutMode === "full";
    const targetBeat = selIndex >= 0 ? beats[selIndex] : undefined;
    const beatDuration = targetBeat ? beatTiming(targetBeat, clipDurationById.get(targetBeat.clipId)).timelineSec : 0;
    const beatStart = targetBeat
      ? beats.slice(0, selIndex).reduce((sum, item) => sum + beatTiming(item, clipDurationById.get(item.clipId)).timelineSec, 0)
      : 0;
    const placementDuration = !isEffectOverlay && targetBeat
      ? beatDuration
      : Math.min(5.0, targetClip.durationSec || 3.0);

    const newOverlay: OverlayClip = {
      id: `overlay-${genId()}`,
      clipId: targetClip.id,
      startTimeSec: !isEffectOverlay && targetBeat ? beatStart : 1.0,
      durationSec: placementDuration,
      inSec: 0,
      outSec: Math.min(placementDuration, targetClip.durationSec || placementDuration),
      ...visualDefaults,
      fitToBeat: !isEffectOverlay && Boolean(targetBeat),
      attachedBeatId: !isEffectOverlay ? targetBeat?.id : undefined,
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

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d") {
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
        dispatch({ type: "UPDATE_OVERLAY", overlay: { ...overlay, startTimeSec: roundedStart, durationSec: roundedDur, fitToBeat: false, attachedBeatId: undefined } });
      }
    } else if (dragStartRef.current.mode === "resize-right") {
      const newDur = Math.max(0.5, Math.min(totalDur - overlay.startTimeSec, dragStartRef.current.initialDurationSec + deltaSec));
      const roundedDur = Math.round(newDur * 10) / 10;
      if (roundedDur !== overlay.durationSec) {
        dispatch({ type: "UPDATE_OVERLAY", overlay: { ...overlay, durationSec: roundedDur, fitToBeat: false, attachedBeatId: undefined } });
      }
    } else if (dragStartRef.current.mode === "resize-left") {
      const maxDelta = dragStartRef.current.initialDurationSec - 0.5;
      const actualDelta = Math.max(-dragStartRef.current.initialStartSec, Math.min(maxDelta, deltaSec));
      const newStartSec = Math.round((dragStartRef.current.initialStartSec + actualDelta) * 10) / 10;
      const newDur = Math.round((dragStartRef.current.initialDurationSec - actualDelta) * 10) / 10;
      if (newStartSec !== overlay.startTimeSec || newDur !== overlay.durationSec) {
        dispatch({ type: "UPDATE_OVERLAY", overlay: { ...overlay, startTimeSec: newStartSec, durationSec: newDur, fitToBeat: false, attachedBeatId: undefined } });
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
  /** Every dragged chip's start when the drag began — the group move measures from these. */
  const voGroupOriginsRef = useRef<Map<string, number> | null>(null);

  // The selected set, with the single-select prop as the fallback so a host that
  // doesn't multi-select keeps working.
  const voSelectedIds = useMemo(
    () => new Set(selectedVoIds ?? (selectedVoId ? [selectedVoId] : [])),
    [selectedVoIds, selectedVoId],
  );

  // Exactly one element in the timeline is active. A selected segment owns that slot, so
  // the beat renders inactive underneath it — the beat id is deliberately kept, because
  // the stage preview and Inspector still need a current beat to show.
  const segmentSelectionActive =
    voSelectedIds.size > 0
    || Boolean(selectedSfxId)
    || Boolean(selectedUserVoiceId)
    || Boolean(selectedStickerId)
    || Boolean(selectedOverlayId);
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
  }

  async function importUserVoiceFile(file: File) {
    if (!isSupportedUserVoiceFile(file)) {
      alert("Choose an audio file such as MP3, WAV, M4A, OGG, or WebM.");
      return;
    }
    try {
      const sourceDurationSec = await readAudioFileDuration(file);
      const startTimeSec = selIndex >= 0 ? beatStarts[selIndex] : 0;
      const segment = makeImportedUserVoiceSegment(
        file,
        sourceDurationSec,
        startTimeSec,
        totalDur,
        `user-vo-${genId()}`,
      );
      dispatch({ type: "ADD_USER_VOICE", segment });
      onSelectUserVoice?.(segment.id);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Could not import that voice recording.");
    }
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
    if (segs[0]) onSelectVo?.(segs[0].id);
  }

  /**
   * Deselect every track segment. The five tracks already behave as one mutually
   * exclusive selection — picking a chip on any of them clears the other four — so a
   * background press clears all of them rather than leaving an odd track still lit.
   * Beat selection is deliberately untouched: the preview and Inspector always need a
   * current beat, and StudioApp re-selects the first one whenever it goes invalid.
   */
  function clearSegmentSelection() {
    onSelectVo?.(null);
    onSelectSfx?.(null);
    onSelectUserVoice?.(null);
    onSelectSticker?.(null);
    onSelectOverlay?.(null);
  }

  function startVoDrag(e: React.PointerEvent, seg: VoSegment, mode: "move" | "resize-left" | "resize-right") {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);

    let selectedAfterClick: string[] = [seg.id];
    if (mode === "move" && onSelectVoMulti) {
      const orderedIds = voSegmentsInTimelineOrder.map((s) => s.id);
      selectedAfterClick = onSelectVoMulti(
        seg.id,
        { shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey },
        orderedIds,
      );
    } else {
      // Resizing is always single-segment, so an edge drag collapses the selection.
      onSelectVo?.(seg.id);
    }
    setDraggingVoId(seg.id);
    voDragStartRef.current = { startX: e.clientX, initialStartSec: seg.startTimeSec, initialDurationSec: seg.durationSec, mode };

    // Snapshot the group's starts now: mid-drag the segments have already moved, so
    // deltas must always be measured against where the drag began.
    if (mode === "move") {
      const groupIds = new Set(selectedAfterClick.includes(seg.id) ? selectedAfterClick : [seg.id]);
      voGroupOriginsRef.current = new Map(
        voSegments.filter((s) => groupIds.has(s.id)).map((s) => [s.id, s.startTimeSec]),
      );
    } else {
      voGroupOriginsRef.current = null;
    }
  }

  function handleVoPointerMove(e: React.PointerEvent, seg: VoSegment) {
    if (draggingVoId !== seg.id || !voDragStartRef.current || !voTrackRef.current) return;
    const rect = voTrackRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;
    const deltaSec = ((e.clientX - voDragStartRef.current.startX) / rect.width) * totalDur;
    const st = voDragStartRef.current;

    if (st.mode === "move") {
      const origins = voGroupOriginsRef.current;
      const group = origins ? voSegments.filter((s) => origins.has(s.id)) : [];

      if (origins && group.length > 1) {
        // Group move: one clamped delta for the whole set, so the gaps hold.
        const moved = moveVoGroup(group, origins, deltaSec, totalDur);
        if (moved.length > 0) dispatch({ type: "UPDATE_VOS", segments: moved });
        return;
      }

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
      voGroupOriginsRef.current = null;
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
  }

  function startSfxDrag(e: React.PointerEvent, seg: SfxSegment, mode: "move" | "resize-right") {
    const drawn = resolveSfx(seg, beatSpans(beats));
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    onSelectSfx?.(seg.id);
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

  // ── User VO track drag/trim ──
  const userVoiceTrackRef = useRef<HTMLDivElement>(null);
  const [draggingUserVoiceId, setDraggingUserVoiceId] = useState<string | null>(null);
  const userVoiceDragStartRef = useRef<{
    startX: number;
    initialStartSec: number;
    initialDurationSec: number;
    mode: "move" | "resize-right";
  } | null>(null);

  function startUserVoiceDrag(e: React.PointerEvent, segment: UserVoiceSegment, mode: "move" | "resize-right") {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    onSelectUserVoice?.(segment.id);
    setDraggingUserVoiceId(segment.id);
    userVoiceDragStartRef.current = {
      startX: e.clientX,
      initialStartSec: segment.startTimeSec,
      initialDurationSec: segment.durationSec,
      mode,
    };
  }

  function handleUserVoicePointerMove(e: React.PointerEvent, segment: UserVoiceSegment) {
    const start = userVoiceDragStartRef.current;
    if (draggingUserVoiceId !== segment.id || !start || !userVoiceTrackRef.current) return;
    const rect = userVoiceTrackRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;
    const deltaSec = ((e.clientX - start.startX) / rect.width) * totalDur;
    if (start.mode === "move") {
      const maxStart = Math.max(0, totalDur - 0.1);
      const nextStart = Math.round(Math.max(0, Math.min(maxStart, start.initialStartSec + deltaSec)) * 10) / 10;
      const nextDuration = Math.round(Math.min(segment.durationSec, Math.max(0.1, totalDur - nextStart)) * 10) / 10;
      if (nextStart !== segment.startTimeSec || nextDuration !== segment.durationSec) {
        dispatch({ type: "UPDATE_USER_VOICE", segment: { ...segment, startTimeSec: nextStart, durationSec: nextDuration } });
      }
    } else {
      const maxDuration = Math.min(
        segment.sourceDurationSec - (segment.sourceStartSec ?? 0),
        totalDur - segment.startTimeSec,
      );
      const nextDuration = Math.round(Math.max(0.1, Math.min(maxDuration, start.initialDurationSec + deltaSec)) * 10) / 10;
      if (nextDuration !== segment.durationSec) {
        dispatch({ type: "UPDATE_USER_VOICE", segment: { ...segment, durationSec: nextDuration } });
      }
    }
  }

  function endUserVoiceDrag(e: React.PointerEvent) {
    if (!draggingUserVoiceId) return;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
    setDraggingUserVoiceId(null);
    userVoiceDragStartRef.current = null;
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

  function snapSelectedBeatToCue(cueTimeSec: number) {
    if (selIndex < 0) {
      setMusicError("Select a Beat first, then click a cue marker.");
      return;
    }
    const beat = beats[selIndex];
    const clip = clipById.get(beat.clipId);
    if (cueTimeSec - beatStarts[selIndex] < 0.1) {
      setMusicError("Choose a cue after the selected Beat's start.");
      return;
    }
    const resized = snapBeatEndToMusicCue(beat, clip?.durationSec ?? beat.durationSec, beatStarts[selIndex], cueTimeSec);
    if (!resized) {
      setMusicError("That cue does not produce a different valid Beat duration.");
      return;
    }
    setMusicError("");
    dispatch({ type: "UPDATE_BEAT", beat: resized });
    setSelectedMusicCueSec(null);
  }

  // Playhead sits at the midpoint of the selected beat (as % of totalDur)
  const playheadLeft = selIndex >= 0
    ? `${((beatStarts[selIndex] + beats[selIndex].durationSec / 2) / totalDur) * 100}%`
    : "-999px";

  useEffect(() => {
    const viewport = timelineScrollRef.current;
    if (!viewport || selIndex < 0) return;

    const padding = 12;
    const beatStart = (beatStarts[selIndex] / totalDur) * viewport.scrollWidth;
    const beatEnd = ((beatStarts[selIndex] + beats[selIndex].durationSec) / totalDur) * viewport.scrollWidth;
    const visibleStart = viewport.scrollLeft;
    const visibleEnd = visibleStart + viewport.clientWidth;
    const beatWidth = beatEnd - beatStart;
    let nextScrollLeft = visibleStart;

    if (beatWidth > viewport.clientWidth - padding * 2 || beatStart < visibleStart + padding) {
      nextScrollLeft = beatStart - padding;
    } else if (beatEnd > visibleEnd - padding) {
      nextScrollLeft = beatEnd - viewport.clientWidth + padding;
    }

    const maxScroll = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    nextScrollLeft = Math.max(0, Math.min(maxScroll, nextScrollLeft));
    if (Math.abs(nextScrollLeft - visibleStart) > 0.5) {
      viewport.scrollLeft = nextScrollLeft;
      setTimelineScrollLeft(nextScrollLeft);
    }
  }, [beats, selIndex, timelineWidth, totalDur]);

  return (
    <TimelineShell>
      <TimelineHeader
        title="The Cut"
        meta={`${beats.length} beats / ${overlays.length} overlays / ${userVoiceSegments.length} User VO / ${voSegments.length} generated VO / ${sfxSegments.length} SFX / ${stickers.length} stickers${musicTrack ? " / music analyzed" : ""} / ${fmtSecs(totalDur)} / ${cut.aspect}`}
        actions={<>
          <div style={{ position: "relative" }}>
            <TimelineAddButton
              onClick={() => setMusicPickerOpen((open) => !open)}
              disabled={musicImport !== null}
              title="Choose from the app Music library or import audio from a file or video"
              aria-pressed={musicPickerOpen}
            >
              {musicImport
                ? `${musicImport.phase === "extracting" ? "Extracting" : "Analyzing"} ${Math.round(musicImport.progress * 100)}%`
                : musicTrack ? "Replace music" : "Music"}
            </TimelineAddButton>
            {musicPickerOpen && (
              <MusicPicker
                busy={musicImport !== null}
                onPick={(fileName) => { void selectMusicFromLibrary(fileName); }}
                onImport={(file) => { void importMusicTrack(file); }}
                onDelete={(fileName) => {
                  if (musicTrack?.fileName !== fileName) return;
                  setSelectedMusicCueSec(null);
                  dispatch({ type: "REMOVE_MUSIC_TRACK" });
                }}
                onClose={() => setMusicPickerOpen(false)}
              />
            )}
          </div>
          <InputControl
            ref={userVoiceFileInputRef}
            type="file"
            accept="audio/*,.aac,.flac,.m4a,.mp3,.mp4,.oga,.ogg,.opus,.wav,.webm"
            style={{ display: "none" }}
            aria-label="Import User VO audio"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) void importUserVoiceFile(file);
            }}
          />
          <TimelineAddButton
            onClick={() => {
              setSfxPickerOpen(false);
              setStickerPickerOpen(false);
              setPickerOpen(false);
              userVoiceFileInputRef.current?.click();
            }}
            title="Import an audio file onto the User VO track at the selected Beat"
          >
            Import VO
          </TimelineAddButton>
          {voSegments.length === 0 && beats.some((b) => b.captionText.trim()) && (
            <TimelineAddButton onClick={seedVoFromBeats} title="Create VO segments from beat captions">Seed VO</TimelineAddButton>
          )}
          <TimelineAddButton
            onClick={() => {
              setSfxPickerOpen(false);
              setStickerPickerOpen(false);
              setPickerOpen(false);
              addVoSegment();
            }}
            title="Add a voiceover segment"
          >
            VO
          </TimelineAddButton>
          <div style={{ position: "relative" }}>
            <TimelineAddButton
              onClick={() => {
                setStickerPickerOpen(false);
                setPickerOpen(false);
                setSfxPickerOpen((open) => !open);
              }}
              aria-pressed={sfxPickerOpen}
            >
              SFX
            </TimelineAddButton>
          {sfxPickerOpen && (
            <SfxPicker onPick={(fileName) => addSfxFromLibrary(fileName)} onClose={() => setSfxPickerOpen(false)} />
          )}
          </div>
          <div style={{ position: "relative" }}>
            <TimelineAddButton
              onClick={() => {
                setSfxPickerOpen(false);
                setPickerOpen(false);
                setStickerPickerOpen((open) => !open);
              }}
              aria-pressed={stickerPickerOpen}
            >
              Sticker
          </TimelineAddButton>
          {stickerPickerOpen && (
            <StickerPicker onPick={(fileName) => addStickerFromLibrary(fileName)} onClose={() => setStickerPickerOpen(false)} />
          )}
          </div>
          <div style={{ position: "relative" }}>
            <TimelineAddButton
              onClick={() => {
                setSfxPickerOpen(false);
                setStickerPickerOpen(false);
                setPickerOpen((open) => !open);
              }}
              aria-pressed={pickerOpen}
            >
              Video overlay
            </TimelineAddButton>
            <OverlayPickerModal isOpen={pickerOpen} onClose={() => setPickerOpen(false)} cut={cut} clips={clips} onSelectClip={(clip, blend) => addOverlayWithClip(clip, blend)} onImportStockOverlay={(category, file, blend) => importAndAddStockOverlay(category, file, blend)} onImportFiles={importUploadedFiles} />
          </div>
        </>}
      />

      {musicError && <div className="st-music-track-error" role="status">{musicError}</div>}

      <div className={"st-beat-audio-master" + (cut.beatAudioMuted ? " muted" : "")}>
        <strong>Beat audio</strong>
        <InputControl
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={cut.beatAudioMasterVolume ?? 1}
          onChange={(event) => dispatch({
            type: "SET_CUT",
            cut: { ...cut, beatAudioMasterVolume: Number(event.target.value) },
          })}
          aria-label="Master volume for all Beat audio"
          title="Master volume for the original audio in every Beat"
          style={sliderTrackStyle(cut.beatAudioMasterVolume ?? 1, 0, 1)}
        />
        <output>{Math.round((cut.beatAudioMasterVolume ?? 1) * 100)}%</output>
        <ControlButton
          type="button"
          className="st-beat-audio-master-mute"
          aria-pressed={Boolean(cut.beatAudioMuted)}
          onClick={() => dispatch({
            type: "SET_CUT",
            cut: { ...cut, beatAudioMuted: !cut.beatAudioMuted },
          })}
          title={cut.beatAudioMuted ? "Unmute all Beat audio" : "Mute all Beat audio"}
        >
          {cut.beatAudioMuted ? "Unmute all Beats" : "Mute all Beats"}
        </ControlButton>
      </div>

      <TimelineZoom value={timelineZoom} min={TIMELINE_ZOOM_MIN} max={TIMELINE_ZOOM_MAX} step={TIMELINE_ZOOM_STEP} onChange={setTimelineZoom} onFit={() => setTimelineZoom(TIMELINE_ZOOM_MIN)} />

      <div className="ui-timeline-minimap">
        <span>Overview</span>
        <div
          ref={timelineMinimapRef}
          className="ui-timeline-minimap-track"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            seekTimelineFromMinimap(event);
          }}
          onPointerMove={seekTimelineFromMinimap}
          title="Click or drag to navigate the timeline"
          aria-label="Timeline overview"
        >
          {beats.map((beat, index) => {
            const start = beats.slice(0, index).reduce((sum, item) => sum + item.durationSec, 0);
            return (
              <span
                key={beat.id}
                className={"ui-timeline-minimap-beat" + (beat.id === selectedBeatId ? " selected" : "")}
                style={{
                  left: `${(start / totalDur) * 100}%`,
                  width: `${(beat.durationSec / totalDur) * 100}%`,
                }}
              >
                {String(index + 1).padStart(2, "0")}
              </span>
            );
          })}
          <span
            className="ui-timeline-minimap-window"
            style={{ left: `${minimapViewportStart}%`, width: `${minimapViewportWidth}%` }}
          />
          <span
            className="ui-timeline-minimap-marker"
            style={{ left: `${minimapViewportStart + minimapViewportWidth / 2}%` }}
          />
        </div>
      </div>

      {/* Scrollable Timeline Tracks Container */}
      <TimelineViewport
        viewportRef={timelineScrollRef}
        className="no-scrollbar"
        onScroll={(event) => setTimelineScrollLeft(event.currentTarget.scrollLeft)}
      >
        <TimelineCanvas
          style={timelineWidth > 0 ? { width: `${timelineWidth}px`, minWidth: "100%" } : { minWidth: "100%" }}
          // Pressing anywhere on the timeline that is not a segment clears the track
          // selection. Every chip's drag-start calls stopPropagation, so this only ever
          // sees genuine background presses — a chip would otherwise select itself here
          // and then be deselected by this handler on the way up.
          onPointerDown={clearSegmentSelection}
        >
          {/* ── SHARED TIME RULER + BOTH TRACKS ── */}
          <div className="st-tl-ruler-area">
            {/* Overlay Track Lane — video clips placed over beats on a proportional ruler */}

            {overlays.length > 0 && (() => {
              const overlaysWithLanes = assignSubLanes(overlays);
              const maxLane = Math.max(0, ...overlaysWithLanes.map((o) => o.lane));
              const canvasHeight = Math.max(34, (maxLane + 1) * 28 + 4);

              return (
                <TimelineLane label="Video Overlay" hint="Independent video layer · drag to move or trim">
                  <TimelineLaneCanvas
                    canvasRef={overlayTrackRef}
                    className="st-ov-canvas"
                    style={{ height: canvasHeight }}
                  >
                    {/* Beat dividers shown inside the overlay canvas for alignment reference */}
                    {beats.map((b, i) => {
                      if (i === 0) return null;
                      const leftPct = (beatStarts[i] / totalDur) * 100;
                      return (
                        <TimelineDivider
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
                        <TimelineSegment
                          key={ov.id}
                          selected={isSel}
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
                          <TimelineResizeHandle
                            onPointerDown={(e) => startOverlayDrag(e, ov, "resize-left")}
                            edge="left"
                            className="st-ov-resize-handle left"
                            title="Drag left edge to adjust start time"
                          />

                          <span className="st-ov-chip-mode">{ov.layoutMode === "pip" ? "PIP" : ov.blendMode.toUpperCase()}</span>
                          <span className="st-ov-chip-dot">·</span>
                          <span className="st-ov-chip-name">
                            {ovClip?.name ?? "Overlay"}
                          </span>
                          <span className="st-ov-chip-time">
                            {ov.startTimeSec.toFixed(1)}s–{(ov.startTimeSec + ov.durationSec).toFixed(1)}s
                          </span>

                          <ControlButton
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
                            <CopyIcon size={9} />
                          </ControlButton>

                          <ControlButton
                            type="button"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              onRequestDeleteSegment("overlay", ov.id, ovClip?.name ?? "Overlay clip");
                            }}
                            className="st-ov-action-btn"
                            title="Remove overlay clip"
                          >
                            <CloseIcon size={9} />
                          </ControlButton>

                          {/* Right Resize Handle */}
                          <TimelineResizeHandle
                            onPointerDown={(e) => startOverlayDrag(e, ov, "resize-right")}
                            edge="right"
                            className="st-ov-resize-handle right"
                            title="Drag right edge to adjust duration"
                          />
                        </TimelineSegment>
                      );
                    })}
                  </TimelineLaneCanvas>
                </TimelineLane>
              );
            })()}

            {musicTrack && (
              <TimelineLane
                className="st-music-lane"
                label="Music"
                hint={`${musicTrack.sourceKind === "video-audio" ? "Audio extracted from video" : "Audio track"} · click a cue to select it, then apply it to a Beat`}
                actions={(
                  <div className="st-music-track-controls">
                    <span title={musicTrack.name}>{musicTrack.name}</span>
                    <InputControl
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={musicTrack.volume}
                      onPointerDown={(event) => event.stopPropagation()}
                      onChange={(event) => dispatch({ type: "UPDATE_MUSIC_TRACK_VOLUME", volume: Number(event.target.value) })}
                      aria-label="Music volume"
                      style={sliderTrackStyle(musicTrack.volume, 0, 1)}
                    />
                    <output>{Math.round(musicTrack.volume * 100)}%</output>
                    <ControlButton
                      type="button"
                      className="st-music-mute"
                      aria-pressed={!!musicTrack.muted}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={() => dispatch({ type: "SET_MUSIC_TRACK_MUTED", muted: !musicTrack.muted })}
                      title={musicTrack.muted ? "Unmute music in preview and export" : "Mute music in preview and export"}
                    >
                      {musicTrack.muted ? "Unmute" : "Mute"}
                    </ControlButton>
                    {selectedMusicCueSec !== null && (
                      <ControlButton
                        type="button"
                        className="st-music-apply-cue"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={() => snapSelectedBeatToCue(selectedMusicCueSec)}
                        title={`Resize the selected Beat so it ends at ${fmtSecs(selectedMusicCueSec)}`}
                      >
                        Set Beat end · {fmtSecs(selectedMusicCueSec)}
                      </ControlButton>
                    )}
                    <ControlButton
                      type="button"
                      className="st-music-delete"
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={() => {
                        setSelectedMusicCueSec(null);
                        dispatch({ type: "REMOVE_MUSIC_TRACK" });
                      }}
                      title="Delete music from this project"
                    >
                      <DeleteIcon size={10} /> Delete music
                    </ControlButton>
                  </div>
                )}
              >
                <TimelineLaneCanvas className="st-music-canvas" style={{ height: 54 }}>
                  {beats.map((beat, index) => index === 0 ? null : (
                    <TimelineDivider key={beat.id} className="st-vo-divider" style={{ left: `${(beatStarts[index] / totalDur) * 100}%` }} />
                  ))}
                  <div
                    className="st-music-waveform"
                    style={{ width: `${Math.max(1, (musicTrack.durationSec / totalDur) * 100)}%` }}
                    title={`${musicTrack.name} · ${fmtSecs(musicTrack.durationSec)} · ${musicTrack.cueMarkers.length} cues`}
                  >
                    <Waveform
                      bars={downsampleWaveform(musicTrack.waveform, 36).map((amplitude) => ({ amplitude, tone: "safe" as const }))}
                      variant="timeline"
                      ariaLabel={`${musicTrack.name} waveform with ${musicTrack.cueMarkers.length} edit cues`}
                      markers={musicTrack.cueMarkers.map((marker) => ({
                        pct: (marker.timeSec / musicTrack.durationSec) * 100,
                        strength: marker.strength,
                        active: selectedMusicCueSec === marker.timeSec,
                        label: `Cue at ${fmtSecs(marker.timeSec)}. Select this cue.`,
                        onActivate: () => {
                          setMusicError("");
                          setSelectedMusicCueSec(marker.timeSec);
                        },
                      }))}
                    />
                  </div>
                </TimelineLaneCanvas>
              </TimelineLane>
            )}

            {/* User VO is always visible so the recording destination is clear before the first take. */}
            {(() => {
              const withLanes = assignSubLanes(userVoiceSegments);
              const maxLane = Math.max(0, ...withLanes.map((segment) => segment.lane));
              const canvasHeight = Math.max(34, (maxLane + 1) * 28 + 4);
              return (
                <TimelineLane
                  className="st-user-vo-lane"
                  label="User VO"
                  hint={userVoiceSegments.length ? "Drag to move or trim" : "Record from the Beat or Cut preview"}
                >
                  <TimelineLaneCanvas canvasRef={userVoiceTrackRef} className="st-vo-canvas" style={{ height: canvasHeight }}>
                    {beats.map((beat, index) => index === 0 ? null : (
                      <TimelineDivider key={beat.id} className="st-vo-divider" style={{ left: `${(beatStarts[index] / totalDur) * 100}%` }} />
                    ))}
                    {withLanes.map((segment) => {
                      const selected = segment.id === selectedUserVoiceId;
                      return (
                        <TimelineSegment
                          key={segment.id}
                          tone="voice"
                          selected={selected}
                          onPointerDown={(event) => startUserVoiceDrag(event, segment, "move")}
                          onPointerMove={(event) => handleUserVoicePointerMove(event, segment)}
                          onPointerUp={endUserVoiceDrag}
                          className={"st-vo-chip st-user-vo-chip" + (selected ? " sel" : "")}
                          style={{
                            left: `${(segment.startTimeSec / totalDur) * 100}%`,
                            width: `${Math.max(1, (segment.durationSec / totalDur) * 100)}%`,
                            top: 3 + segment.lane * 28,
                            height: 24,
                            bottom: "auto",
                            zIndex: selected ? 30 : 2 + segment.lane,
                          }}
                          title={`${segment.name} · ${segment.startTimeSec.toFixed(1)}s–${(segment.startTimeSec + segment.durationSec).toFixed(1)}s · vol ${Math.round(segment.volume * 100)}%`}
                        >
                          <UserVoiceWaveform
                            file={segment.file}
                            durationSec={segment.durationSec}
                            sourceDurationSec={segment.sourceDurationSec}
                            sourceStartSec={segment.sourceStartSec}
                            volume={segment.volume}
                            levelDb={segment.levelDb}
                            variant="timeline"
                          />
                          <span className="st-vo-chip-icon">🎙</span>
                          <span className="st-vo-chip-text">{segment.name}</span>
                          <span className="st-vo-chip-time">{segment.startTimeSec.toFixed(1)}s–{(segment.startTimeSec + segment.durationSec).toFixed(1)}s</span>
                          <ControlButton
                            type="button"
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => {
                              event.stopPropagation();
                              const newId = `user-vo-${genId()}`;
                              dispatch({ type: "DUPLICATE_USER_VOICE", id: segment.id, newUserVoiceId: newId });
                              onSelectUserVoice?.(newId);
                            }}
                            className="st-vo-action-btn"
                            title="Duplicate recording"
                          >
                            <CopyIcon size={9} />
                          </ControlButton>
                          <ControlButton
                            type="button"
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => {
                              event.stopPropagation();
                              onRequestDeleteSegment("user voice", segment.id, segment.name);
                            }}
                            className="st-vo-action-btn"
                            title="Remove recording"
                          >
                            <CloseIcon size={9} />
                          </ControlButton>
                          <TimelineResizeHandle
                            edge="right"
                            onPointerDown={(event) => startUserVoiceDrag(event, segment, "resize-right")}
                            className="st-vo-resize-handle right"
                            title="Drag to trim the recording's tail"
                          />
                        </TimelineSegment>
                      );
                    })}
                  </TimelineLaneCanvas>
                </TimelineLane>
              );
            })()}

            {/* VO Track Lane — narration + captions on an independent proportional ruler */}
            {voSegments.length > 0 && (() => {
              const voWithLanes = assignSubLanes(voSegments);
              const maxLane = Math.max(0, ...voWithLanes.map((s) => s.lane));
              const canvasHeight = Math.max(34, (maxLane + 1) * 28 + 4);

              return (
                <TimelineLane
                  label="Voiceover"
                  hint={
                    voSelectedIds.size > 1
                      ? `${voSelectedIds.size} selected · drag to move them together`
                      : "Drag to move or resize · ⇧ or ⌘ click to select several"
                  }
                >
                  <TimelineLaneCanvas canvasRef={voTrackRef} className="st-vo-canvas" style={{ height: canvasHeight }}>
                    {/* Beat dividers for alignment reference */}
                    {beats.map((b, i) => {
                      if (i === 0) return null;
                      return <TimelineDivider key={b.id} className="st-vo-divider" style={{ left: `${(beatStarts[i] / totalDur) * 100}%` }} />;
                    })}

                    {voWithLanes.map((seg) => {
                      const leftPct = (seg.startTimeSec / totalDur) * 100;
                      const widthPct = Math.max(1, (seg.durationSec / totalDur) * 100);
                      const isSel = voSelectedIds.has(seg.id);
                      const isPrimary = seg.id === selectedVoId;
                      const snippet = seg.text.trim() || "Empty — type in Inspector";
                      return (
                        <TimelineSegment
                          key={seg.id}
                          tone="voice"
                          selected={isSel}
                          aria-selected={isSel}
                          onPointerDown={(e) => startVoDrag(e, seg, "move")}
                          onPointerMove={(e) => handleVoPointerMove(e, seg)}
                          onPointerUp={endVoDrag}
                          className={"st-vo-chip" + (isSel ? " sel" : "") + (isPrimary && voSelectedIds.size > 1 ? " primary" : "") + (seg.text.trim() ? "" : " empty")}
                          style={{
                            left: `${leftPct}%`,
                            width: `${widthPct}%`,
                            top: 3 + seg.lane * 28,
                            height: 24,
                            bottom: "auto",
                            zIndex: isSel ? 30 : 2 + seg.lane,
                          }}
                          title={`${snippet} · ${seg.startTimeSec.toFixed(1)}s–${(seg.startTimeSec + seg.durationSec).toFixed(1)}s · ${seg.captionVisible ? "caption visible" : "voiceover only"}${voSelectedIds.size > 1 && isSel ? ` · 1 of ${voSelectedIds.size} selected` : ""}`}
                        >
                          <TimelineResizeHandle edge="left" onPointerDown={(e) => startVoDrag(e, seg, "resize-left")} className="st-vo-resize-handle left" title="Drag to adjust start time" />

                          <span className="st-vo-chip-icon">{seg.captionVisible ? "👁" : "🔇"}</span>
                          <span className="st-vo-chip-text">{snippet}</span>
                          <span className="st-vo-chip-time">{seg.startTimeSec.toFixed(1)}s–{(seg.startTimeSec + seg.durationSec).toFixed(1)}s</span>

                          <ControlButton
                            type="button"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => { e.stopPropagation(); const newId = `vo-${genId()}`; dispatch({ type: "DUPLICATE_VO", id: seg.id, newVoId: newId }); onSelectVo?.(newId); }}
                            className="st-vo-action-btn"
                            title="Duplicate VO segment"
                          >
                            <CopyIcon size={9} />
                          </ControlButton>

                          <ControlButton
                            type="button"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => { e.stopPropagation(); onRequestDeleteSegment("voiceover", seg.id, seg.text || "Voiceover segment"); }}
                            className="st-vo-action-btn"
                            title="Remove VO segment"
                          >
                            <CloseIcon size={9} />
                          </ControlButton>

                          <TimelineResizeHandle edge="right" onPointerDown={(e) => startVoDrag(e, seg, "resize-right")} className="st-vo-resize-handle right" title="Drag to adjust duration" />
                        </TimelineSegment>
                      );
                    })}
                  </TimelineLaneCanvas>
                </TimelineLane>
              );
            })()}

            {/* SFX Track Lane — sound effects on the same proportional ruler */}
            {sfxSegments.length > 0 && (() => {
              const resolvedSfxList = sfxSegments.map((s) => resolveSfx(s, beatSpans(beats)));
              const sfxWithLanes = assignSubLanes(resolvedSfxList);
              const maxLane = Math.max(0, ...sfxWithLanes.map((s) => s.lane));

              const canvasHeight = Math.max(34, (maxLane + 1) * 28 + 4);

              return (
                <TimelineLane label="Sound effects" hint="Drag to move or trim">
                  <TimelineLaneCanvas canvasRef={sfxTrackRef} className="st-vo-canvas" style={{ height: canvasHeight }}>
                    {beats.map((b, i) => {
                      if (i === 0) return null;
                      return <TimelineDivider key={b.id} className="st-vo-divider" style={{ left: `${(beatStarts[i] / totalDur) * 100}%` }} />;
                    })}

                    {sfxWithLanes.map((seg) => {
                      const leftPct = (seg.startTimeSec / totalDur) * 100;
                      const widthPct = Math.max(1, (seg.durationSec / totalDur) * 100);
                      const isSel = seg.id === selectedSfxId;
                      return (
                        <TimelineSegment
                          key={seg.id}
                          tone="sfx"
                          selected={isSel}
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

                          <ControlButton
                            type="button"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => { e.stopPropagation(); const newId = `sfx-${genId()}`; dispatch({ type: "DUPLICATE_SFX", id: seg.id, newSfxId: newId }); onSelectSfx?.(newId); }}
                            className="st-vo-action-btn"
                            title="Duplicate SFX segment"
                          >
                            <CopyIcon size={9} />
                          </ControlButton>

                          <ControlButton
                            type="button"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => { e.stopPropagation(); onRequestDeleteSegment("sound effect", seg.id, seg.fileName); }}
                            className="st-vo-action-btn"
                            title="Remove SFX segment"
                          >
                            <CloseIcon size={9} />
                          </ControlButton>

                          <TimelineResizeHandle edge="right" onPointerDown={(e) => startSfxDrag(e, seg, "resize-right")} className="st-vo-resize-handle right" title="Drag to trim the sound's tail" />
                        </TimelineSegment>
                      );
                    })}
                  </TimelineLaneCanvas>
                </TimelineLane>
              );
            })()}

            {stickers.length > 0 && (() => {
              const resolvedStickers = stickers.map((raw) => ({ raw, ...resolveSticker(raw, beatSpans(beats)) }));
              const stickersWithLanes = assignSubLanes(resolvedStickers);
              const maxLane = Math.max(0, ...stickersWithLanes.map((s) => s.lane));
              const canvasHeight = Math.max(34, (maxLane + 1) * 28 + 4);

              return (
                <TimelineLane label="Elements" hint="Drag to move or trim">
                  <TimelineLaneCanvas canvasRef={stickerTrackRef} className="st-vo-canvas" style={{ height: canvasHeight }}>
                    {beats.map((b, i) => {
                      if (i === 0) return null;
                      return <TimelineDivider key={b.id} className="st-vo-divider" style={{ left: `${(beatStarts[i] / totalDur) * 100}%` }} />;
                    })}

                    {stickersWithLanes.map(({ raw, ...st }) => {
                      const pinned = !!raw.fitToBeat;
                      const leftPct = (st.startTimeSec / totalDur) * 100;
                      const widthPct = Math.max(1, (st.durationSec / totalDur) * 100);
                      const isSel = st.id === selectedStickerId;
                      return (
                        <TimelineSegment
                          key={st.id}
                          tone="sticker"
                          selected={isSel}
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

                          <ControlButton
                            type="button"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => { e.stopPropagation(); const newId = `sticker-${genId()}`; dispatch({ type: "DUPLICATE_STICKER", id: raw.id, newStickerId: newId }); onSelectSticker?.(newId); }}
                            className="st-vo-action-btn"
                            title="Duplicate sticker"
                          >
                            <CopyIcon size={9} />
                          </ControlButton>

                          <ControlButton
                            type="button"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => { e.stopPropagation(); onRequestDeleteSegment("sticker", raw.id, raw.fileName); }}
                            className="st-vo-action-btn"
                            title="Remove sticker"
                          >
                            <CloseIcon size={9} />
                          </ControlButton>

                          {!pinned && (
                            <TimelineResizeHandle edge="right" onPointerDown={(e) => startStickerDrag(e, raw, "resize-right")} className="st-vo-resize-handle right" title="Drag to change how long the sticker shows" />
                          )}
                        </TimelineSegment>
                      );
                    })}
                  </TimelineLaneCanvas>
                </TimelineLane>
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
                    const activeTitleCount = activeBeatTitleCount(b);
                    const speedRamp = activeSpeedRamp(b);
                    // Width proportional to beat duration
                    const widthPct = (b.durationSec / totalDur) * 100;
                    return (
                      <div
                        key={b.id}
                        className={"st-beat" + (b.id === selectedBeatId && !segmentSelectionActive ? " sel" : "")}
                        style={{ flex: `0 0 ${widthPct}%`, minWidth: `${widthPct}%` }}
                        onClick={() => {
                          if (isPlaying) return;
                          // onSelectBeat takes the active slot back from any segment.
                          onSelectBeat(b.id);
                        }}
                      >
                        <div className="st-bt" style={{ background: beatPosterBg(b, clip, forceUpdate), position: "relative" }}>
                          {speedRamp && (
                            <div className="st-beat-speed-ramp" title={`Speed ramp · middle from F${rampFrameAtProgress(speedRamp.firstPoint, b.durationSec)} to F${rampFrameAtProgress(speedRamp.secondPoint, b.durationSec)}`}>
                              <SpeedRampBand
                                ramp={speedRamp}
                                compact
                                interactive={b.id === selectedBeatId && !isPlaying}
                                durationSec={beatTiming(b, clip?.durationSec).timelineSec}
                                sourceWindowSec={beatTiming(b, clip?.durationSec).windowSec}
                                onChange={(nextRamp) => {
                                  const next = { ...b, speedRamp: nextRamp };
                                  dispatch({
                                    type: "UPDATE_BEAT",
                                    beat: { ...next, durationSec: beatTiming(next, clip?.durationSec).timelineSec, durationPreset: "custom" },
                                  });
                                }}
                              />
                            </div>
                          )}
                          {clip?.isTemplatePlaceholder && (
                            <div style={{ position: "absolute", inset: 0, zIndex: 4, display: "grid", placeContent: "center", justifyItems: "center", gap: 5, padding: 6, background: "repeating-linear-gradient(135deg, var(--panel-3) 0 8px, var(--panel-2) 8px 16px)", color: "var(--accent)", fontSize: 9, fontWeight: 800, letterSpacing: ".08em", textAlign: "center" }}>
                              <span>EMPTY SLOT</span>
                              <ControlButton
                                className="st-btn primary"
                                style={{ padding: "2px 6px", fontSize: 9, letterSpacing: 0, whiteSpace: "nowrap" }}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setAssignPlaceholderBeatId(b.id);
                                }}
                              >
                                Assign clip
                              </ControlButton>
                            </div>
                          )}
                          {b.splitScreen && b.splitScreen.layout !== "none" && (
                            <span style={{ position: "absolute", top: 4, right: 4, background: "rgba(139,124,255,0.9)", color: "#fff", fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 3, zIndex: 5, backdropFilter: "blur(4px)" }}>
                              🥞 Split
                            </span>
                          )}
                          {activeTitleCount > 0 && (
                            <span
                              className="st-beat-title-badge"
                              title={`${activeTitleCount} active title layer${activeTitleCount === 1 ? "" : "s"}`}
                              aria-label={`Beat has ${activeTitleCount} active title layer${activeTitleCount === 1 ? "" : "s"}`}
                            >
                              T{activeTitleCount > 1 ? activeTitleCount : ""}
                            </span>
                          )}
                          {b.storyPurpose && (
                            <span className="st-beat-purpose-badge" title={`Beat purpose: ${b.storyPurpose}`}>
                              {b.storyPurpose === "cta" ? "CTA" : b.storyPurpose}
                            </span>
                          )}
                          <span className="bn st-num">{String(i + 1).padStart(2, "0")}</span>
                        </div>

                        <div
                          className={"st-bcap" + (b.templateSlotDescription ? " template-slot" : "")}
                          title={b.templateSlotDescription ?? b.captionText}
                        >
                          {b.templateSlotDescription ? (
                            <><strong>Slot:</strong> {b.templateSlotDescription}</>
                          ) : b.captionText}
                        </div>
                        <div className="st-bdur">
                          <span className="st-num">{fmtSecs(b.durationSec)}</span>
                          <span className="st-reorder">
                            <ControlButton
                              title="Move earlier"
                              onClick={(e) => { e.stopPropagation(); move(i, -1); }}
                              disabled={i === 0}
                            >◄</ControlButton>
                            <ControlButton
                              title="Move later"
                              onClick={(e) => { e.stopPropagation(); move(i, 1); }}
                              disabled={i === beats.length - 1}
                            >►</ControlButton>
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
            </div>

          </div>
        </TimelineCanvas>
      </TimelineViewport>
      {assignPlaceholderBeatId && (() => {
        const targetBeat = beats.find((beat) => beat.id === assignPlaceholderBeatId);
        const availableClips = clips.filter((candidate) => !candidate.isTemplatePlaceholder);
        return targetBeat ? (
          <SplitClipPickerModal
            title={`Assign Clip · ${targetBeat.templateSlotDescription ?? "Template slot"}`}
            activeClipId=""
            clips={availableClips}
            onSelectClip={(clipId) => {
              dispatch({ type: "FILL_TEMPLATE_SLOT", beatId: targetBeat.id, clipId });
              setAssignPlaceholderBeatId(null);
            }}
            onClose={() => setAssignPlaceholderBeatId(null)}
          />
        ) : null;
      })()}
    </TimelineShell>
  );
}
