import { useProject } from "../state/ProjectContext";
import type { Cut, Clip } from "../domain/types";
import { cutDuration } from "../features/assemble/assemble";
import { fmtSecs, posterBg } from "./util";

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

  function handleAddOverlay() {
    if (clips.length === 0) return;
    const genId = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
    const newOverlay = {
      id: `overlay-${genId()}`,
      clipId: clips[0].id,
      startTimeSec: 1.0,
      durationSec: 3.0,
      inSec: 0,
      outSec: 3.0,
      blendMode: "normal" as const,
      opacity: 0.8,
      volume: 0.5,
    };
    dispatch({ type: "ADD_OVERLAY", overlay: newOverlay });
    onSelectOverlay?.(newOverlay.id);
  }

  const playheadLeft = selIndex >= 0 ? `${((selIndex + 0.5) / beats.length) * 100}%` : "-999px";

  return (
    <div className="st-tl">
      <div className="st-tlhead">
        <span className="t">The Cut</span>
        <span className="meta st-num">
          {beats.length} beats · {overlays.length} overlays · {fmtSecs(totalDur)} · {cut.aspect}
        </span>
        <button
          className="st-btn ghost"
          style={{ marginLeft: "auto", padding: "2px 8px", fontSize: 11 }}
          onClick={handleAddOverlay}
          disabled={clips.length === 0}
          title="Add a video overlay / B-roll transition layer across beats"
        >
          + Add Overlay Clip
        </button>
      </div>

      {/* Overlay Track Lane */}
      {overlays.length > 0 && (
        <div style={{ padding: "6px 12px", background: "var(--panel-2)", borderBottom: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span>🎞️ Overlay Track (B-Roll / Blend Transitions)</span>
          </div>
          <div style={{ position: "relative", height: 32, background: "var(--panel-3)", borderRadius: 6, overflow: "hidden", border: "1px solid var(--line)" }}>
            {overlays.map((ov) => {
              const leftPct = (ov.startTimeSec / totalDur) * 100;
              const widthPct = Math.max(4, (ov.durationSec / totalDur) * 100);
              const ovClip = clipById.get(ov.clipId);
              const isSel = ov.id === selectedOverlayId;

              return (
                <div
                  key={ov.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectOverlay?.(ov.id);
                  }}
                  style={{
                    position: "absolute",
                    left: `${leftPct}%`,
                    width: `${widthPct}%`,
                    top: 2,
                    bottom: 2,
                    background: isSel ? "var(--accent)" : "rgba(255, 179, 57, 0.25)",
                    border: isSel ? "2px solid #fff" : "1px solid var(--accent)",
                    borderRadius: 4,
                    color: isSel ? "#111" : "var(--accent)",
                    fontWeight: 600,
                    fontSize: 10,
                    padding: "2px 6px",
                    cursor: "pointer",
                    overflow: "hidden",
                    whiteSpace: "nowrap",
                    textOverflow: "ellipsis",
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                  title={`Overlay: ${ovClip?.name ?? "Clip"} (${ov.blendMode}, Vol ${Math.round(ov.volume * 100)}%, Opacity ${Math.round(ov.opacity * 100)}%)`}
                >
                  <span>{ov.blendMode.toUpperCase()}</span>
                  <span>·</span>
                  <span>{ovClip?.name ?? "Overlay"}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className={"st-track" + (beats.length === 0 ? " empty" : "")}>
        {beats.length === 0 ? (
          <span>No cut yet — Regenerate to build one.</span>
        ) : (
          <>
            <div className="st-playhead" style={{ left: playheadLeft }} />
            {beats.map((b, i) => {
              const clip = clipById.get(b.clipId);
              return (
                <div
                  key={b.id}
                  className={"st-beat" + (b.id === selectedBeatId ? " sel" : "")}
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
  );
}
