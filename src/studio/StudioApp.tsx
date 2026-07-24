import { useEffect, useMemo, useState } from "react";
import { useProject } from "../state/ProjectContext";
import { makeBeat } from "../features/assemble/assemble";
import { useSettings } from "../state/SettingsContext";
import { useExportSettings } from "../state/ExportSettingsContext";
import TopBar from "./TopBar";
import ClipBin from "./ClipBin";
import StagePreview from "./StagePreview";
import Timeline from "./Timeline";
import Inspector from "./Inspector";
import ExportDrawer from "./ExportDrawer";
import SettingsDrawer from "./SettingsDrawer";
import AiStoryDrawer from "./AiStoryDrawer";
import { seedProject } from "./devSeed";
import "./studio.css";
// AI actions (analyze/author/refine) now live inside AiStoryDrawer's own hook.

export default function StudioApp() {
  const { state, dispatch } = useProject();
  const { reset: resetSettings } = useSettings();
  const { reset: resetExport } = useExportSettings();

  const [selectedBeatId, setSelectedBeatId] = useState<string | null>(null);
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  const [selectedVoId, setSelectedVoId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  // Mount the export drawer lazily on first open, then keep it mounted so its
  // state survives close/reopen (only slid out of view). Reset on "Start over".
  const [exportMounted, setExportMounted] = useState(false);
  // Same lazy-mount pattern for the AI Story drawer.
  const [aiStoryOpen, setAiStoryOpen] = useState(false);
  const [aiStoryMounted, setAiStoryMounted] = useState(false);

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

  // Delete key shortcut for removing the selected overlay or VO segment
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Delete" || e.key === "Backspace") {
        const tag = (e.target as HTMLElement)?.tagName?.toUpperCase();
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        if (selectedVoId) {
          dispatch({ type: "REMOVE_VO", id: selectedVoId });
          setSelectedVoId(null);
        } else if (selectedOverlayId) {
          dispatch({ type: "REMOVE_OVERLAY", id: selectedOverlayId });
          setSelectedOverlayId(null);
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedOverlayId, selectedVoId, dispatch]);

  // Keep VO selection valid as segments change.
  useEffect(() => {
    const segs = cut?.voSegments ?? [];
    if (selectedVoId && !segs.some((s) => s.id === selectedVoId)) setSelectedVoId(null);
  }, [cut?.voSegments, selectedVoId]);

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
    if (!cut) return;
    const clip = clipById.get(clipId);
    if (!clip) return;
    const beat = makeBeat(clip, "");
    dispatch({ type: "ADD_BEAT", beat });
    setSelectedBeatId(beat.id);
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
    <div className="studio">
      <TopBar
        onExport={() => { setExportMounted(true); setExportOpen(true); }}
        onStartOver={startOver}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenAiStory={() => { setAiStoryMounted(true); setAiStoryOpen(true); }}
      />

      <div className={"st-main" + (aiStoryOpen ? " ai-open" : "")}>
        <ClipBin
          usedClipIds={usedClipIds}
          selectedClipId={selectedClip?.id ?? null}
          hasCut={!!cut}
          beats={beats}
          onPickClip={pickClip}
          onAddClip={addClipToCut}
          onDuplicateBeat={duplicateBeat}
        />

        <section className="st-col stage" style={{ position: "relative" }}>
          <div className="st-stage-inner">
            {cut ? (
              <>
                <StagePreview cut={cut} clips={clips} beat={selectedBeat} clip={selectedClip} />
                <Timeline
                  cut={cut}
                  clipById={clipById}
                  clips={clips}
                  selectedBeatId={selectedBeatId}
                  onSelectBeat={setSelectedBeatId}
                  selectedOverlayId={selectedOverlayId}
                  onSelectOverlay={(id) => { setSelectedOverlayId(id); if (id) setSelectedVoId(null); }}
                  selectedVoId={selectedVoId}
                  onSelectVo={(id) => { setSelectedVoId(id); if (id) setSelectedOverlayId(null); }}
                />
              </>
            ) : (
              <div className="st-stage-empty">
                <h2>{clips.length ? "Ready when you are" : "Start with your footage"}</h2>
                <p>
                  {clips.length
                    ? "Open ✨ AI Story (top bar) to analyze your clips, author the story & script, and refine each beat with Claude."
                    : "Drop clips into the bin on the left. Then open ✨ AI Story — Claude reads them, finds a story, and builds a captioned cut you refine here."}
                </p>
                {clips.length > 0 && (
                  <button className="st-btn ghost" style={{ marginTop: 14 }} onClick={startManualCut}>
                    Arrange the clips yourself →
                  </button>
                )}
              </div>
            )}

          </div>
        </section>

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
        />

        {/* Docked side panel — pushes the layout (see .st-main.ai-open in studio.css). */}
        {aiStoryMounted && <AiStoryDrawer open={aiStoryOpen} onClose={() => setAiStoryOpen(false)} />}
      </div>

      {exportMounted && <ExportDrawer open={exportOpen} onClose={() => setExportOpen(false)} />}
      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
