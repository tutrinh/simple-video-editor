import { useEffect, useMemo, useState } from "react";
import { useProject } from "../state/ProjectContext";
import { makeBeat } from "../features/assemble/assemble";
import { useSettings } from "../state/SettingsContext";
import { useExportSettings } from "../state/ExportSettingsContext";
import { useRegenerate } from "./useRegenerate";
import TopBar from "./TopBar";
import ClipBin from "./ClipBin";
import StagePreview from "./StagePreview";
import Inspector from "./Inspector";
import ExportDrawer from "./ExportDrawer";
import { seedProject } from "./devSeed";
import StoryBar from "./StoryBar";
import "./studio.css";

export default function StudioApp() {
  const { state, dispatch } = useProject();
  const { reset: resetSettings } = useSettings();
  const { reset: resetExport } = useExportSettings();
  const regen = useRegenerate();

  const [selectedBeatId, setSelectedBeatId] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

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
  }

  return (
    <div className="studio">
      <TopBar
        onExport={() => setExportOpen(true)}
        onStartOver={startOver}
      />

      <div className="st-main">
        <ClipBin
          usedClipIds={usedClipIds}
          selectedClipId={selectedClip?.id ?? null}
          hasCut={!!cut}
          beats={beats}
          onPickClip={pickClip}
          onAddClip={addClipToCut}
          onDuplicateBeat={duplicateBeat}
          onAnalyzeClips={regen.analyzeClips}
          busy={regen.busy}
        />

        <section className="st-col stage" style={{ position: "relative" }}>
          <div className="st-stage-inner">
            {regen.error && (
              <div className="st-err" onClick={regen.clearError} title="Dismiss" style={{ cursor: "pointer" }}>
                ⚠ {regen.error} · (click to dismiss)
              </div>
            )}

            {cut ? (
              <StagePreview cut={cut} clips={clips} beat={selectedBeat} clip={selectedClip} />
            ) : (
              <div className="st-stage-empty">
                <h2>{clips.length ? "Ready when you are" : "Start with your footage"}</h2>
                <p>
                  {clips.length
                    ? "Click '1. Analyze Clips' to describe scenes with Claude, or '2. Author Story & Script' to build your Vlog story."
                    : "Drop clips into the bin on the left. Claude reads them, finds a story, and builds a captioned cut you refine here."}
                </p>
                {clips.length > 0 && (
                  <button className="st-btn ghost" style={{ marginTop: 14 }} onClick={startManualCut}>
                    Arrange the clips yourself →
                  </button>
                )}
              </div>
            )}

            {clips.length > 0 && (
              <StoryBar onAuthor={regen.authorScript} busy={regen.busy} />
            )}
          </div>

          {regen.busy && (
            <div className="st-regen">
              <div className="spinner" />
              <div className="lab">{regen.label || "Working…"}</div>
            </div>
          )}
        </section>

        <Inspector
          beat={selectedBeat}
          clip={selectedClip}
          clips={clips}
          logline={story?.logline ?? ""}
          index={selIndex}
          total={beats.length}
          onDuplicateBeat={duplicateBeat}
        />
      </div>

      {exportOpen && <ExportDrawer onClose={() => setExportOpen(false)} />}
    </div>
  );
}
