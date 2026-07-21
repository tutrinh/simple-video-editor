import { useProject } from "../state/ProjectContext";
import type { Cut, Clip } from "../domain/types";
import { cutDuration } from "../features/assemble/assemble";
import { fmtSecs, posterBg } from "./util";

interface Props {
  cut: Cut;
  clipById: Map<string, Clip>;
  selectedBeatId: string | null;
  onSelectBeat: (id: string) => void;
}

export default function Timeline({ cut, clipById, selectedBeatId, onSelectBeat }: Props) {
  const { dispatch } = useProject();
  const beats = cut.beats;
  const selIndex = beats.findIndex((b) => b.id === selectedBeatId);

  function move(index: number, dir: -1 | 1) {
    const j = index + dir;
    if (j < 0 || j >= beats.length) return;
    const ids = beats.map((b) => b.id);
    [ids[index], ids[j]] = [ids[j], ids[index]];
    dispatch({ type: "REORDER_BEATS", order: ids });
  }

  const playheadLeft = selIndex >= 0 ? `${((selIndex + 0.5) / beats.length) * 100}%` : "-999px";

  return (
    <div className="st-tl">
      <div className="st-tlhead">
        <span className="t">The Cut</span>
        <span className="meta st-num">{beats.length} beats · {fmtSecs(cutDuration(cut))} · {cut.aspect}</span>
      </div>
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
                  onClick={() => onSelectBeat(b.id)}
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
