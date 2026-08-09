import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useProject } from "../state/ProjectContext";
import { cutDuration, makeBeat } from "../features/assemble/assemble";
import { stepBeatDuration } from "../domain/beatDuration";
import { stepSegmentDuration } from "../domain/segmentDuration";
import { isFromFormControl, resolveTimelineKeyAction } from "./timelineKeys";
import {
  activeTimelineTrack,
  idsInTimelineOrder,
  intentFromModifiers,
  nextSelection,
  primarySelectedId,
  pruneSelection,
  stepWithinTrack,
  type SelectionState,
} from "./timelineSelection";
import { useVoFit } from "./useVoFit";
import { useSettings } from "../state/SettingsContext";
import { useExportSettings } from "../state/ExportSettingsContext";
import TopBar from "./TopBar";
import ClipBin, { CLIP_DRAG_TYPE } from "./ClipBin";
import StagePreview from "./StagePreview";
import CoverDrawer from "./CoverDrawer";
import { captureCover } from "../features/cover/coverSource";
import Timeline from "./Timeline";
import Inspector from "./Inspector";
import ExportDrawer from "./ExportDrawer";
import SettingsDrawer from "./SettingsDrawer";
import AiStoryDrawer from "./AiStoryDrawer";
import { seedProject } from "./devSeed";
import "./studio.css";
import { ControlButton } from "../design-system/ControlPrimitives";
import { Workspace, WorkspaceMain, WorkspacePanel } from "../design-system/Workspace";
import { useClipIngest } from "./useClipIngest";
import Modal from "../design-system/Modal";
import Button from "../design-system/Button";
import DeleteIcon from "../design-system/icons/DeleteIcon";
// AI actions (analyze/author/refine) now live inside AiStoryDrawer's own hook.

import { pendingDeletionForSelection, type PendingTrackDeletion, type TrackSegmentKind } from "./timelineDeletion";

const ProductReviewDrawer = lazy(() => import("./ProductReviewDrawer"));
const MotivationalStoryDrawer = lazy(() => import("./MotivationalStoryDrawer"));
const StoryPracticeDrawer = lazy(() => import("./StoryPracticeDrawer"));

export default function StudioApp() {
  const { state, dispatch } = useProject();
  const { reset: resetSettings } = useSettings();
  const { reset: resetExport } = useExportSettings();

  const [selectedBeatId, setSelectedBeatId] = useState<string | null>(null);
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  // The VO track selects a set, not one chip. `selectedVoId` stays the derived primary
  // (the last clicked one) so the Inspector and every existing single-select caller work
  // unchanged; only the timeline chips read the full set.
  const [voSelection, setVoSelection] = useState<SelectionState>({ ids: [], anchorId: null });
  const selectedVoId = primarySelectedId(voSelection);
  const setSelectedVoId = useCallback((id: string | null) => {
    setVoSelection(id ? { ids: [id], anchorId: id } : { ids: [], anchorId: null });
  }, []);

  const [selectedSfxId, setSelectedSfxId] = useState<string | null>(null);
  const [selectedUserVoiceId, setSelectedUserVoiceId] = useState<string | null>(null);
  const [selectedStickerId, setSelectedStickerId] = useState<string | null>(null);

  /**
   * The timeline holds exactly one active element. Every selection therefore starts by
   * clearing all five segment tracks from one place — enforcing this at each call site
   * is what previously let a sticker stay lit alongside a newly selected voiceover, and
   * let an overlay select without clearing anything at all.
   */
  const clearSegmentSelections = useCallback(() => {
    setVoSelection({ ids: [], anchorId: null });
    setSelectedSfxId(null);
    setSelectedUserVoiceId(null);
    setSelectedStickerId(null);
    setSelectedOverlayId(null);
  }, []);

  /**
   * A beat picked by the user, as opposed to the beat that cut playback walks through.
   * Only the former takes the active slot away from a segment — routing playback through
   * here would wipe the selection on every beat boundary.
   */
  const selectBeatFromUser = useCallback((id: string | null) => {
    setSelectedBeatId(id);
    clearSegmentSelections();
  }, [clearSegmentSelections]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [coverOpen, setCoverOpen] = useState(false);
  const [coverMounted, setCoverMounted] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [clipBinCollapsed, setClipBinCollapsed] = useState(false);
  // Mount the export drawer lazily on first open, then keep it mounted so its
  // state survives close/reopen (only slid out of view). Reset on "Start over".
  const [exportMounted, setExportMounted] = useState(false);
  // Same lazy-mount pattern for the AI Director drawer.
  const [aiStoryOpen, setAiStoryOpen] = useState(false);
  const [aiStoryMounted, setAiStoryMounted] = useState(false);
  const [productReviewOpen, setProductReviewOpen] = useState(false);
  const [productReviewMounted, setProductReviewMounted] = useState(false);
  const [motivationalStoryOpen, setMotivationalStoryOpen] = useState(false);
  const [motivationalStoryMounted, setMotivationalStoryMounted] = useState(false);
  const [storyPracticeOpen, setStoryPracticeOpen] = useState(false);
  const [storyPracticeMounted, setStoryPracticeMounted] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [clipDragOver, setClipDragOver] = useState(false);
  const [editorHovered, setEditorHovered] = useState(false);
  // Carries a list, not one id: the voiceover track multi-selects, so Delete has to be
  // able to remove the whole set rather than just the chip the Inspector happens to edit.
  const [pendingTrackDeletion, setPendingTrackDeletion] = useState<PendingTrackDeletion | null>(null);
  const { ingestFiles, statuses, importProgress } = useClipIngest();
  // One fit run for the whole editor, shared by the Inspector button and the `f` key.
  const voFit = useVoFit();

  // Dev-only fixture (?seed) to exercise the populated workspace without footage/AI.
  useEffect(() => {
    if (import.meta.env.DEV && new URLSearchParams(location.search).has("seed") && state.clips.length === 0) {
      seedProject(dispatch);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { clips, cut, story } = state;
  const clipById = useMemo(() => new Map(clips.map((c) => [c.id, c])), [clips]);
  const beats = cut?.beats ?? [];

  // Keep selection valid as the cut changes (regenerate, remove, reorder).
  useEffect(() => {
    if (beats.length === 0) { if (selectedBeatId !== null) setSelectedBeatId(null); return; }
    if (!beats.some((b) => b.id === selectedBeatId)) setSelectedBeatId(beats[0].id);
  }, [beats, selectedBeatId]);

  useEffect(() => {
    if (isPlaying || !editorHovered || beats.length === 0) return;

    function onKeyDown(event: KeyboardEvent) {
      const action = resolveTimelineKeyAction({
        key: event.key,
        repeat: event.repeat,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        fromFormControl: isFromFormControl(event.target),
      });
      if (!action) return;

      // Every shortcut acts on whatever the timeline shows as active.
      const track = activeTimelineTrack({
        voIds: voSelection.ids,
        sfxId: selectedSfxId,
        userVoiceId: selectedUserVoiceId,
        stickerId: selectedStickerId,
        overlayId: selectedOverlayId,
      });

      if (action.kind === "fit-vo") {
        const segment = (cut?.voSegments ?? []).find((candidate) => candidate.id === selectedVoId);
        if (!segment || !segment.text.trim()) return;
        event.preventDefault();
        void voFit.fitVo(segment);
        return;
      }

      if (action.kind === "resize") {
        // Resizes whatever is active. Bounds per track mirror that track's own
        // resize-right drag in Timeline, so keyboard and mouse can't disagree.
        const totalDur = cut ? cutDuration(cut) : 0;
        const room = (startTimeSec: number) => totalDur - startTimeSec;
        const step = (currentSec: number, bounds: { minSec: number; maxSec: number }) =>
          stepSegmentDuration(currentSec, bounds, action.direction);

        if (track === "beat") {
          // Same step, clamp and "custom" preset as the Inspector's duration input.
          const beat = beats.find((candidate) => candidate.id === selectedBeatId);
          const clip = beat ? clipById.get(beat.clipId) : undefined;
          if (!beat || !clip) return;

          event.preventDefault();
          const next = stepBeatDuration(beat, clip.durationSec, action.direction);
          if (next) dispatch({ type: "UPDATE_BEAT", beat: next });
          return;
        }

        event.preventDefault();
        switch (track) {
          case "vo": {
            // Resizes the whole selection, like dragging and deleting it does.
            const selected = (cut?.voSegments ?? []).filter((s) => voSelection.ids.includes(s.id));
            const resized = selected.flatMap((segment) => {
              const next = step(segment.durationSec, { minSec: 0.5, maxSec: room(segment.startTimeSec) });
              return next === null ? [] : [{ ...segment, durationSec: next }];
            });
            if (resized.length === 1) dispatch({ type: "UPDATE_VO", segment: resized[0] });
            else if (resized.length > 1) dispatch({ type: "UPDATE_VOS", segments: resized });
            break;
          }
          case "sfx": {
            const segment = cut?.sfxSegments?.find((s) => s.id === selectedSfxId);
            if (!segment) break;
            const next = step(segment.durationSec, {
              minSec: 0.1,
              // Trim-tail only: a sound effect can never outlast its source file.
              maxSec: Math.min(segment.sourceDurationSec, room(segment.startTimeSec)),
            });
            if (next !== null) dispatch({ type: "UPDATE_SFX", segment: { ...segment, durationSec: next } });
            break;
          }
          case "userVoice": {
            const segment = cut?.userVoiceSegments?.find((s) => s.id === selectedUserVoiceId);
            if (!segment) break;
            const next = step(segment.durationSec, {
              minSec: 0.1,
              maxSec: Math.min(
                segment.sourceDurationSec - (segment.sourceStartSec ?? 0),
                room(segment.startTimeSec),
              ),
            });
            if (next !== null) dispatch({ type: "UPDATE_USER_VOICE", segment: { ...segment, durationSec: next } });
            break;
          }
          case "sticker": {
            const sticker = cut?.stickers?.find((s) => s.id === selectedStickerId);
            if (!sticker) break;
            // A sticker has no source length, so the cut end is the only ceiling.
            const next = step(sticker.durationSec, { minSec: 0.1, maxSec: room(sticker.startTimeSec) });
            if (next !== null) dispatch({ type: "UPDATE_STICKER", sticker: { ...sticker, durationSec: next } });
            break;
          }
          case "overlay": {
            const overlay = cut?.overlays?.find((s) => s.id === selectedOverlayId);
            if (!overlay) break;
            const next = step(overlay.durationSec, { minSec: 0.5, maxSec: room(overlay.startTimeSec) });
            if (next !== null) dispatch({ type: "UPDATE_OVERLAY", overlay: { ...overlay, durationSec: next } });
            break;
          }
        }
        return;
      }

      // Left/Right steps through whichever track is currently active, not always the
      // beats — if a voiceover chip is lit, the arrows walk the voiceover track.
      event.preventDefault();

      if (track === "beat") {
        const nextBeatId = stepWithinTrack(beats.map((beat) => beat.id), selectedBeatId, action.direction);
        if (nextBeatId) selectBeatFromUser(nextBeatId);
        return;
      }

      const step = (
        items: { id: string; startTimeSec: number }[] | undefined,
        activeId: string | null,
      ) => stepWithinTrack(idsInTimelineOrder(items), activeId, action.direction);

      // Stepping always lands on exactly one segment, collapsing any multi-selection.
      switch (track) {
        case "vo": {
          const id = step(cut?.voSegments, selectedVoId);
          if (id) { clearSegmentSelections(); setVoSelection({ ids: [id], anchorId: id }); }
          break;
        }
        case "sfx": {
          const id = step(cut?.sfxSegments, selectedSfxId);
          if (id) { clearSegmentSelections(); setSelectedSfxId(id); }
          break;
        }
        case "userVoice": {
          const id = step(cut?.userVoiceSegments, selectedUserVoiceId);
          if (id) { clearSegmentSelections(); setSelectedUserVoiceId(id); }
          break;
        }
        case "sticker": {
          const id = step(cut?.stickers, selectedStickerId);
          if (id) { clearSegmentSelections(); setSelectedStickerId(id); }
          break;
        }
        case "overlay": {
          const id = step(cut?.overlays, selectedOverlayId);
          if (id) { clearSegmentSelections(); setSelectedOverlayId(id); }
          break;
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    beats, clipById, clearSegmentSelections, cut, dispatch, editorHovered, selectBeatFromUser,
    selectedBeatId, selectedOverlayId, selectedSfxId, selectedStickerId, selectedUserVoiceId,
    selectedVoId, voSelection.ids, voFit,
  ]);

  /** A single chip, targeted directly — the X on a chip, wherever it sits in a selection. */
  function requestTrackSegmentDeletion(kind: TrackSegmentKind, id: string, label: string) {
    setPendingTrackDeletion({ kind, ids: [id], label });
  }

  function confirmTrackSegmentDeletion() {
    if (!pendingTrackDeletion) return;
    const { kind, ids } = pendingTrackDeletion;
    const [id] = ids;

    if (kind === "sticker") {
      dispatch({ type: "REMOVE_STICKER", id });
      setSelectedStickerId(null);
    } else if (kind === "sound effect") {
      dispatch({ type: "REMOVE_SFX", id });
      setSelectedSfxId(null);
    } else if (kind === "user voice") {
      dispatch({ type: "REMOVE_USER_VOICE", id });
      setSelectedUserVoiceId(null);
    } else if (kind === "voiceover") {
      if (ids.length > 1) dispatch({ type: "REMOVE_VOS", ids });
      else dispatch({ type: "REMOVE_VO", id });
      setSelectedVoId(null);
    } else {
      dispatch({ type: "REMOVE_OVERLAY", id });
      setSelectedOverlayId(null);
    }
    setPendingTrackDeletion(null);
  }

  // Delete key shortcut requests confirmation for the selected track segment.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Delete" || e.key === "Backspace") {
        const tag = (e.target as HTMLElement)?.tagName?.toUpperCase();
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

        // The key acts on the whole selection, unlike a chip's own X button.
        const pending = pendingDeletionForSelection(
          {
            voIds: voSelection.ids,
            sfxId: selectedSfxId,
            userVoiceId: selectedUserVoiceId,
            stickerId: selectedStickerId,
            overlayId: selectedOverlayId,
          },
          (kind, id) => {
            if (kind === "sticker") return cut?.stickers?.find((s) => s.id === id)?.fileName ?? "Selected sticker";
            if (kind === "user voice") return cut?.userVoiceSegments?.find((s) => s.id === id)?.name ?? "Selected recording";
            if (kind === "sound effect") return cut?.sfxSegments?.find((s) => s.id === id)?.fileName ?? "Selected sound effect";
            if (kind === "voiceover") return cut?.voSegments?.find((s) => s.id === id)?.text?.trim() || "Selected voiceover";
            const overlay = cut?.overlays?.find((s) => s.id === id);
            return clipById.get(overlay?.clipId ?? "")?.name ?? "Selected overlay";
          },
        );
        if (pending) setPendingTrackDeletion(pending);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [clipById, cut, selectedOverlayId, voSelection.ids, selectedSfxId, selectedUserVoiceId, selectedStickerId]);

  // Keep VO selection valid as segments change — drops deleted ids and hands the anchor
  // on, rather than clearing the whole set because one chip went away.
  useEffect(() => {
    const ids = (cut?.voSegments ?? []).map((s) => s.id);
    setVoSelection((current) => pruneSelection(current, ids));
  }, [cut?.voSegments]);

  // Keep SFX selection valid as segments change.
  useEffect(() => {
    const segs = cut?.sfxSegments ?? [];
    if (selectedSfxId && !segs.some((s) => s.id === selectedSfxId)) setSelectedSfxId(null);
  }, [cut?.sfxSegments, selectedSfxId]);

  useEffect(() => {
    const segments = cut?.userVoiceSegments ?? [];
    if (selectedUserVoiceId && !segments.some((segment) => segment.id === selectedUserVoiceId)) {
      setSelectedUserVoiceId(null);
    }
  }, [cut?.userVoiceSegments, selectedUserVoiceId]);

  const pendingDeletionCount = pendingTrackDeletion?.ids.length ?? 0;

  const selIndex = beats.findIndex((b) => b.id === selectedBeatId);
  const selectedBeat = selIndex >= 0 ? beats[selIndex] : null;
  const selectedClip = selectedBeat ? clipById.get(selectedBeat.clipId) : undefined;
  const usedClipIds = useMemo(() => new Set(beats.map((b) => b.clipId)), [beats]);

  function pickClip(clipId: string) {
    const beat = beats.find((b) => b.clipId === clipId);
    if (beat) selectBeatFromUser(beat.id);
  }

  // Add any not-yet-used clip to the end of the Cut and select it — this is how
  // you pull dropped/unused clips (or ones added after generating) into the edit.
  function addClipToCut(clipId: string) {
    const clip = clipById.get(clipId);
    if (!clip) return;
    const beat = makeBeat(clip, "");
    if (!cut) {
      dispatch({ type: "SET_CUT", cut: { beats: [beat], aspect: "16:9" } });
      selectBeatFromUser(beat.id);
      return;
    }
    dispatch({ type: "ADD_BEAT", beat });
    selectBeatFromUser(beat.id);
  }

  function acceptsClipDrag(event: React.DragEvent): boolean {
    const types = Array.from(event.dataTransfer.types);
    return types.includes(CLIP_DRAG_TYPE) || types.includes("Files");
  }

  async function dropIntoEditor(event: React.DragEvent) {
    event.preventDefault();
    setClipDragOver(false);
    const clipId = event.dataTransfer.getData(CLIP_DRAG_TYPE);
    if (clipId) {
      addClipToCut(clipId);
      return;
    }

    const imported = await ingestFiles(Array.from(event.dataTransfer.files));
    if (imported.length === 0) return;
    const newBeats = imported.map((clip) => makeBeat(clip, ""));
    if (!cut) {
      dispatch({ type: "SET_CUT", cut: { beats: newBeats, aspect: "16:9" } });
    } else {
      for (const beat of newBeats) dispatch({ type: "ADD_BEAT", beat });
    }
    selectBeatFromUser(newBeats[0].id);
  }

  function duplicateBeat(beatId: string) {
    if (!cut) return;
    const genId = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
    const newClipId = genId();
    const newBeatId = genId();
    dispatch({ type: "DUPLICATE_BEAT", id: beatId, newClipId, newBeatId });
    selectBeatFromUser(newBeatId);
  }

  // Build a Cut without the AI — every clip in order, empty captions to fill in.
  // Makes "Generate cut" optional: you can arrange and edit the cut by hand.
  function startManualCut() {
    if (clips.length === 0) return;
    const manualCut = { beats: clips.map((c) => makeBeat(c, "")), aspect: "16:9" as const };
    dispatch({ type: "SET_CUT", cut: manualCut });
    selectBeatFromUser(manualCut.beats[0]?.id ?? null);
  }

  /**
   * Capture the frame the preview is showing as a Cover, and open the drawer on
   * it. `atSec` is the source time the transport is parked at — the scrubber and
   * frame-step ARE the frame picker (ADR-0021).
   */
  async function captureCoverFromBeat(atSec: number) {
    if (!cut || !selectedBeat || !selectedClip) return;
    const beatIndex = cut.beats.findIndex((b) => b.id === selectedBeat.id);
    try {
      const cover = await captureCover({ beat: selectedBeat, clip: selectedClip, clips, cut, beatIndex, atSec });
      dispatch({ type: "ADD_COVER", cover });
      setCoverMounted(true);
      setCoverOpen(true);
    } catch (e) {
      console.error("cover capture failed", e);
    }
  }

  function startOver() {
    if (!confirm("Start over? This clears all clips, the story, the cut, and every setting. This cannot be undone.")) return;
    dispatch({ type: "RESET" });
    resetSettings();
    resetExport();
    setSelectedBeatId(null);
    setExportOpen(false);
    setExportMounted(false); // fully discard the drawer's local state (video, etc.)
    setAiStoryOpen(false);
    setAiStoryMounted(false);
    setProductReviewOpen(false);
    setProductReviewMounted(false);
    setMotivationalStoryOpen(false);
    setMotivationalStoryMounted(false);
    setStoryPracticeOpen(false);
    setStoryPracticeMounted(false);
  }

  return (
    <Workspace className="studio">
      <TopBar
        onExport={() => { setExportMounted(true); setExportOpen(true); }}
        onStartOver={startOver}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenCovers={() => { setCoverMounted(true); setCoverOpen(true); }}
        onOpenAiStory={() => {
          setAiStoryMounted(true);
          setProductReviewOpen(false);
          setMotivationalStoryOpen(false);
          setStoryPracticeOpen(false);
          setAiStoryOpen(true);
        }}
        onOpenProductReview={() => {
          setProductReviewMounted(true);
          setAiStoryOpen(false);
          setMotivationalStoryOpen(false);
          setStoryPracticeOpen(false);
          setProductReviewOpen(true);
        }}
        onOpenMotivationalStory={() => {
          setMotivationalStoryMounted(true);
          setAiStoryOpen(false);
          setProductReviewOpen(false);
          setStoryPracticeOpen(false);
          setMotivationalStoryOpen(true);
        }}
        onOpenStoryPractice={() => {
          setStoryPracticeMounted(true);
          setAiStoryOpen(false);
          setProductReviewOpen(false);
          setMotivationalStoryOpen(false);
          setStoryPracticeOpen(true);
        }}
      />

      <WorkspaceMain className={"st-main" + (clipBinCollapsed ? " clips-collapsed" : "") + (aiStoryOpen || productReviewOpen || motivationalStoryOpen || storyPracticeOpen ? " drawer-open" : "")}>
        <ClipBin
          usedClipIds={usedClipIds}
          selectedClipId={selectedClip?.id ?? null}
          hasCut={!!cut}
          beats={beats}
          onPickClip={pickClip}
          onAddClip={addClipToCut}
          onDuplicateBeat={duplicateBeat}
          onFiles={ingestFiles}
          statuses={statuses}
          importProgress={importProgress}
          collapsed={clipBinCollapsed}
          onCollapsedChange={setClipBinCollapsed}
        />

        <WorkspacePanel
          className={"st-col stage" + (clipDragOver ? " clip-drag-over" : "")}
          style={{ position: "relative" }}
          onPointerEnter={() => setEditorHovered(true)}
          onPointerMove={() => {
            if (!editorHovered) setEditorHovered(true);
          }}
          onPointerLeave={() => setEditorHovered(false)}
          onDragEnter={(e) => {
            if (!acceptsClipDrag(e)) return;
            e.preventDefault();
            setClipDragOver(true);
          }}
          onDragOver={(e) => {
            if (!acceptsClipDrag(e)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            if (!clipDragOver) setClipDragOver(true);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setClipDragOver(false);
          }}
          onDrop={dropIntoEditor}
        >
          {clipDragOver && (
            <div className="st-editor-drop-hint">
              <strong>{cut ? "Add clip files to the end of the cut" : "Drop clip files to start a new cut"}</strong>
            </div>
          )}
          <div className="st-stage-inner">
            {cut ? (
              <>
                <div className="st-preview-shell">
                  <StagePreview
                    cut={cut}
                    clips={clips}
                    beat={selectedBeat}
                    clip={selectedClip}
                    keyboardShortcutsActive={editorHovered}
                    onSelectBeat={setSelectedBeatId}
                    onPlayingChange={setIsPlaying}
                    onCaptureCover={captureCoverFromBeat}
                    onRecordCreated={(id) => {
                      setSelectedUserVoiceId(id);
                      setSelectedOverlayId(null);
                      setSelectedVoId(null);
                      setSelectedSfxId(null);
                      setSelectedStickerId(null);
                    }}
                  />
                </div>
                <Timeline
                  cut={cut}
                  clipById={clipById}
                  clips={clips}
                  selectedBeatId={selectedBeatId}
                  onSelectBeat={selectBeatFromUser}
                  isPlaying={isPlaying}
                  selectedOverlayId={selectedOverlayId}
                  onSelectOverlay={(id) => { clearSegmentSelections(); setSelectedOverlayId(id); }}
                  selectedVoId={selectedVoId}
                  onSelectVo={(id) => { clearSegmentSelections(); setSelectedVoId(id); }}
                  selectedVoIds={voSelection.ids}
                  onSelectVoMulti={(id, modifiers, orderedIds) => {
                    const next = nextSelection(voSelection, id, intentFromModifiers(modifiers), orderedIds);
                    clearSegmentSelections();
                    setVoSelection(next);
                    return next.ids;
                  }}
                  selectedSfxId={selectedSfxId}
                  onSelectSfx={(id) => { clearSegmentSelections(); setSelectedSfxId(id); }}
                  selectedUserVoiceId={selectedUserVoiceId}
                  onSelectUserVoice={(id) => { clearSegmentSelections(); setSelectedUserVoiceId(id); }}
                  selectedStickerId={selectedStickerId}
                  onSelectSticker={(id) => { clearSegmentSelections(); setSelectedStickerId(id); }}
                  onRequestDeleteSegment={requestTrackSegmentDeletion}
                />
              </>
            ) : (
              <div className="st-stage-empty st-editor-empty-drop">
                <h2>{clips.length ? "Ready when you are" : "Start with your footage"}</h2>
                <p>
                  {clips.length
                    ? "Drag a clip here to start editing, or open AI Director to build a cut and shape the story."
                    : "Drop video or image files here to start a cut, or add them to the Clips panel on the left."}
                </p>
                {clips.length > 0 && (
                  <ControlButton className="st-btn ghost" style={{ marginTop: 14 }} onClick={startManualCut}>
                    Arrange the clips yourself →
                  </ControlButton>
                )}
              </div>
            )}

          </div>
        </WorkspacePanel>

        <Inspector
          beat={selectedBeat}
          clip={selectedClip}
          clips={clips}
          logline={story?.logline ?? ""}
          index={selIndex}
          total={beats.length}
          onSelectBeat={selectBeatFromUser}
          onDuplicateBeat={duplicateBeat}
          selectedOverlayId={selectedOverlayId}
          onSelectOverlay={setSelectedOverlayId}
          selectedVoId={selectedVoId}
          onSelectVo={setSelectedVoId}
          selectedSfxId={selectedSfxId}
          onSelectSfx={setSelectedSfxId}
          selectedUserVoiceId={selectedUserVoiceId}
          onSelectUserVoice={setSelectedUserVoiceId}
          selectedStickerId={selectedStickerId}
          onSelectSticker={setSelectedStickerId}
          audioPreviewSuspended={exportOpen}
          onRequestDeleteSegment={requestTrackSegmentDeletion}
          voFit={voFit}
        />

        {(aiStoryMounted || productReviewMounted || motivationalStoryMounted || storyPracticeMounted) && (
          <div className="st-creation-drawer-stack">
            {aiStoryMounted && <AiStoryDrawer open={aiStoryOpen} onClose={() => setAiStoryOpen(false)} />}
            {productReviewMounted && (
              <Suspense fallback={<div className="st-creation-drawer-loading" role="status">Loading Product Review…</div>}>
                <ProductReviewDrawer
                  open={productReviewOpen}
                  onClose={() => setProductReviewOpen(false)}
                  onApplied={(firstBeatId) => {
                    selectBeatFromUser(firstBeatId);
                    setProductReviewOpen(false);
                  }}
                />
              </Suspense>
            )}
            {motivationalStoryMounted && (
              <Suspense fallback={<div className="st-creation-drawer-loading" role="status">Loading Motivational Story…</div>}>
                <MotivationalStoryDrawer
                  open={motivationalStoryOpen}
                  onClose={() => setMotivationalStoryOpen(false)}
                  onApplied={(firstBeatId) => {
                    selectBeatFromUser(firstBeatId);
                    setMotivationalStoryOpen(false);
                  }}
                />
              </Suspense>
            )}
            {storyPracticeMounted && (
              <Suspense fallback={<div className="st-creation-drawer-loading" role="status">Loading Story Practice…</div>}>
                <StoryPracticeDrawer
                  open={storyPracticeOpen}
                  onClose={() => setStoryPracticeOpen(false)}
                />
              </Suspense>
            )}
          </div>
        )}
      </WorkspaceMain>

      {exportMounted && <ExportDrawer open={exportOpen} onClose={() => setExportOpen(false)} />}
      {coverMounted && <CoverDrawer open={coverOpen} onClose={() => setCoverOpen(false)} />}
      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <Modal
        open={Boolean(pendingTrackDeletion)}
        title={pendingDeletionCount > 1 ? `Delete ${pendingDeletionCount} timeline segments?` : "Delete timeline segment?"}
        description={
          pendingDeletionCount > 1
            ? `Remove these ${pendingDeletionCount} ${pendingTrackDeletion?.kind ?? "track"} segments from the timeline?`
            : `Remove this ${pendingTrackDeletion?.kind ?? "track"} segment from the timeline?`
        }
        ariaLabel="Confirm timeline segment deletion"
        maxWidth={410}
        onClose={() => setPendingTrackDeletion(null)}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setPendingTrackDeletion(null)}>Cancel</Button>
            <Button variant="danger" autoFocus onClick={confirmTrackSegmentDeletion}>
              {pendingDeletionCount > 1 ? `Delete ${pendingDeletionCount} segments` : "Delete segment"}
            </Button>
          </>
        )}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--ds-critical-soft)", color: "var(--danger)", display: "grid", placeItems: "center", flexShrink: 0 }}>
            <DeleteIcon size={19} />
          </div>
          <div>
            <strong style={{ display: "block", fontSize: 13 }}>{pendingTrackDeletion?.label}</strong>
            <p style={{ margin: "5px 0 0", color: "var(--ink-3)", fontSize: 11, lineHeight: 1.45 }}>
              {pendingDeletionCount > 1
                ? "This action removes them all from the Cut and cannot be undone."
                : "This action removes the segment from the Cut and cannot be undone."}
            </p>
          </div>
        </div>
      </Modal>
    </Workspace>
  );
}
