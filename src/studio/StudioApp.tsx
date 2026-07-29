import { useEffect, useMemo, useState } from "react";
import { useProject } from "../state/ProjectContext";
import { makeBeat } from "../features/assemble/assemble";
import { useSettings } from "../state/SettingsContext";
import { useExportSettings } from "../state/ExportSettingsContext";
import TopBar from "./TopBar";
import ClipBin, { CLIP_DRAG_TYPE } from "./ClipBin";
import StagePreview from "./StagePreview";
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

type TrackSegmentKind = "overlay" | "voiceover" | "sound effect" | "sticker";

export default function StudioApp() {
  const { state, dispatch } = useProject();
  const { reset: resetSettings } = useSettings();
  const { reset: resetExport } = useExportSettings();

  const [selectedBeatId, setSelectedBeatId] = useState<string | null>(null);
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  const [selectedVoId, setSelectedVoId] = useState<string | null>(null);
  const [selectedSfxId, setSelectedSfxId] = useState<string | null>(null);
  const [selectedStickerId, setSelectedStickerId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  // Mount the export drawer lazily on first open, then keep it mounted so its
  // state survives close/reopen (only slid out of view). Reset on "Start over".
  const [exportMounted, setExportMounted] = useState(false);
  // Same lazy-mount pattern for the AI Story drawer.
  const [aiStoryOpen, setAiStoryOpen] = useState(false);
  const [aiStoryMounted, setAiStoryMounted] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [clipDragOver, setClipDragOver] = useState(false);
  const [editorHovered, setEditorHovered] = useState(false);
  const [pendingTrackDeletion, setPendingTrackDeletion] = useState<{ kind: TrackSegmentKind; id: string; label: string } | null>(null);
  const { ingestFiles, statuses } = useClipIngest();

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
      if (
        event.repeat
        || event.metaKey
        || event.ctrlKey
        || event.altKey
        || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
      ) return;

      const target = event.target as HTMLElement | null;
      if (
        target?.isContentEditable
        || target?.closest("input, textarea, select, [contenteditable='true']")
      ) return;

      event.preventDefault();
      const currentIndex = Math.max(0, beats.findIndex((beat) => beat.id === selectedBeatId));
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const nextIndex = (currentIndex + direction + beats.length) % beats.length;
      setSelectedBeatId(beats[nextIndex].id);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [beats, editorHovered, selectedBeatId]);

  function requestTrackSegmentDeletion(kind: TrackSegmentKind, id: string, label: string) {
    setPendingTrackDeletion({ kind, id, label });
  }

  function confirmTrackSegmentDeletion() {
    if (!pendingTrackDeletion) return;
    const { kind, id } = pendingTrackDeletion;
    if (kind === "sticker") {
      dispatch({ type: "REMOVE_STICKER", id });
      setSelectedStickerId(null);
    } else if (kind === "sound effect") {
      dispatch({ type: "REMOVE_SFX", id });
      setSelectedSfxId(null);
    } else if (kind === "voiceover") {
      dispatch({ type: "REMOVE_VO", id });
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
        if (selectedStickerId) {
          const segment = cut?.stickers?.find((item) => item.id === selectedStickerId);
          requestTrackSegmentDeletion("sticker", selectedStickerId, segment?.fileName ?? "Selected sticker");
        } else if (selectedSfxId) {
          const segment = cut?.sfxSegments?.find((item) => item.id === selectedSfxId);
          requestTrackSegmentDeletion("sound effect", selectedSfxId, segment?.fileName ?? "Selected sound effect");
        } else if (selectedVoId) {
          const segment = cut?.voSegments?.find((item) => item.id === selectedVoId);
          requestTrackSegmentDeletion("voiceover", selectedVoId, segment?.text ?? "Selected voiceover");
        } else if (selectedOverlayId) {
          const segment = cut?.overlays?.find((item) => item.id === selectedOverlayId);
          requestTrackSegmentDeletion("overlay", selectedOverlayId, clipById.get(segment?.clipId ?? "")?.name ?? "Selected overlay");
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [clipById, cut, selectedOverlayId, selectedVoId, selectedSfxId, selectedStickerId]);

  // Keep VO selection valid as segments change.
  useEffect(() => {
    const segs = cut?.voSegments ?? [];
    if (selectedVoId && !segs.some((s) => s.id === selectedVoId)) setSelectedVoId(null);
  }, [cut?.voSegments, selectedVoId]);

  // Keep SFX selection valid as segments change.
  useEffect(() => {
    const segs = cut?.sfxSegments ?? [];
    if (selectedSfxId && !segs.some((s) => s.id === selectedSfxId)) setSelectedSfxId(null);
  }, [cut?.sfxSegments, selectedSfxId]);

  const selIndex = beats.findIndex((b) => b.id === selectedBeatId);
  const selectedBeat = selIndex >= 0 ? beats[selIndex] : null;
  const selectedClip = selectedBeat ? clipById.get(selectedBeat.clipId) : undefined;
  const usedClipIds = useMemo(() => new Set(beats.map((b) => b.clipId)), [beats]);

  function pickClip(clipId: string) {
    const beat = beats.find((b) => b.clipId === clipId);
    if (beat) setSelectedBeatId(beat.id);
  }

  // Add any not-yet-used clip to the end of the Cut and select it — this is how
  // you pull dropped/unused clips (or ones added after generating) into the edit.
  function addClipToCut(clipId: string) {
    const clip = clipById.get(clipId);
    if (!clip) return;
    const beat = makeBeat(clip, "");
    if (!cut) {
      dispatch({ type: "SET_CUT", cut: { beats: [beat], aspect: "16:9" } });
      setSelectedBeatId(beat.id);
      return;
    }
    dispatch({ type: "ADD_BEAT", beat });
    setSelectedBeatId(beat.id);
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
    setSelectedBeatId(newBeats[0].id);
  }

  function duplicateBeat(beatId: string) {
    if (!cut) return;
    const genId = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
    const newClipId = genId();
    const newBeatId = genId();
    dispatch({ type: "DUPLICATE_BEAT", id: beatId, newClipId, newBeatId });
    setSelectedBeatId(newBeatId);
  }

  // Build a Cut without the AI — every clip in order, empty captions to fill in.
  // Makes "Generate cut" optional: you can arrange and edit the cut by hand.
  function startManualCut() {
    if (clips.length === 0) return;
    const manualCut = { beats: clips.map((c) => makeBeat(c, "")), aspect: "16:9" as const };
    dispatch({ type: "SET_CUT", cut: manualCut });
    setSelectedBeatId(manualCut.beats[0]?.id ?? null);
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
  }

  return (
    <Workspace className="studio">
      <TopBar
        onExport={() => { setExportMounted(true); setExportOpen(true); }}
        onStartOver={startOver}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenAiStory={() => { setAiStoryMounted(true); setAiStoryOpen(true); }}
      />

      <WorkspaceMain className={"st-main" + (aiStoryOpen ? " ai-open" : "")}>
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
                  />
                </div>
                <Timeline
                  cut={cut}
                  clipById={clipById}
                  clips={clips}
                  selectedBeatId={selectedBeatId}
                  onSelectBeat={setSelectedBeatId}
                  isPlaying={isPlaying}
                  selectedOverlayId={selectedOverlayId}
                  onSelectOverlay={(id) => { setSelectedOverlayId(id); if (id) { setSelectedVoId(null); setSelectedSfxId(null); } }}
                  selectedVoId={selectedVoId}
                  onSelectVo={(id) => { setSelectedVoId(id); if (id) { setSelectedOverlayId(null); setSelectedSfxId(null); } }}
                  selectedSfxId={selectedSfxId}
                  onSelectSfx={(id) => { setSelectedSfxId(id); if (id) { setSelectedOverlayId(null); setSelectedVoId(null); setSelectedStickerId(null); } }}
                  selectedStickerId={selectedStickerId}
                  onSelectSticker={(id) => { setSelectedStickerId(id); if (id) { setSelectedOverlayId(null); setSelectedVoId(null); setSelectedSfxId(null); } }}
                  onRequestDeleteSegment={requestTrackSegmentDeletion}
                />
              </>
            ) : (
              <div className="st-stage-empty st-editor-empty-drop">
                <h2>{clips.length ? "Ready when you are" : "Start with your footage"}</h2>
                <p>
                  {clips.length
                    ? "Drag a clip here to start editing, or open ✨ AI Story to build a cut with Claude."
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
          onDuplicateBeat={duplicateBeat}
          selectedOverlayId={selectedOverlayId}
          onSelectOverlay={setSelectedOverlayId}
          selectedVoId={selectedVoId}
          onSelectVo={setSelectedVoId}
          selectedSfxId={selectedSfxId}
          onSelectSfx={setSelectedSfxId}
          selectedStickerId={selectedStickerId}
          onSelectSticker={setSelectedStickerId}
          onRequestDeleteSegment={requestTrackSegmentDeletion}
        />

        {/* Docked side panel — pushes the layout (see .st-main.ai-open in studio.css). */}
        {aiStoryMounted && <AiStoryDrawer open={aiStoryOpen} onClose={() => setAiStoryOpen(false)} />}
      </WorkspaceMain>

      {exportMounted && <ExportDrawer open={exportOpen} onClose={() => setExportOpen(false)} />}
      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <Modal
        open={Boolean(pendingTrackDeletion)}
        title="Delete timeline segment?"
        description={`Remove this ${pendingTrackDeletion?.kind ?? "track"} segment from the timeline?`}
        ariaLabel="Confirm timeline segment deletion"
        maxWidth={410}
        onClose={() => setPendingTrackDeletion(null)}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setPendingTrackDeletion(null)}>Cancel</Button>
            <Button variant="danger" autoFocus onClick={confirmTrackSegmentDeletion}>Delete segment</Button>
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
              This action removes the segment from the Cut and cannot be undone.
            </p>
          </div>
        </div>
      </Modal>
    </Workspace>
  );
}
