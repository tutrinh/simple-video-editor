import { useProject } from "../state/ProjectContext";
import type { Aspect } from "../domain/types";
import { cutDuration } from "../features/assemble/assemble";
import { fmtClock } from "./util";

const ASPECTS: Aspect[] = ["16:9", "9:16", "1:1"];

interface Props {
  onExport: () => void;
  onStartOver: () => void;
}

export default function TopBar({ onExport, onStartOver }: Props) {
  const { state, dispatch } = useProject();
  const { clips, cut, title } = state;
  const titleSize = Math.min(40, Math.max(15, (title.length || "Untitled project".length) + 1));

  // Aspect is a Cut property that doesn't affect beat trims — switch it without
  // rebuilding, preserving manual edits (export letterboxes/pads to the choice).
  function setAspect(a: Aspect) {
    if (cut && cut.aspect !== a) dispatch({ type: "SET_CUT", cut: { ...cut, aspect: a } });
  }

  return (
    <header className="st-topbar">
      <div className="st-brand"><span className="dot" />VIDSTR</div>
      <div className="st-proj">
        <span aria-hidden="true">/</span>
        <input
          className="st-title"
          value={title}
          placeholder="Untitled project"
          size={titleSize}
          onChange={(e) => dispatch({ type: "SET_TITLE", title: e.target.value })}
          aria-label="Project title"
          title="Click to rename this project"
        />
      </div>
      {cut && (
        <span className="st-aspect" title="Aspect ratio of the cut">
          {ASPECTS.map((a) => (
            <button key={a} className={cut.aspect === a ? "on" : ""} onClick={() => setAspect(a)}>{a}</button>
          ))}
        </span>
      )}
      {cut && <span className="st-chip">1080p</span>}
      {cut && <span className="st-chip st-num">{fmtClock(cutDuration(cut))} · {cut.beats.length} beats</span>}
      {clips.length > 0 && <span className="st-chip st-num">{clips.length} clip{clips.length === 1 ? "" : "s"}</span>}

      <div className="st-spacer" />

      <button className="st-btn danger" onClick={onStartOver} title="Clear everything">Start over</button>
      <button className="st-btn primary" onClick={onExport} disabled={!cut}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M12 3v11M8 10l4 4 4-4M5 20h14"/></svg>
        Export video
      </button>
    </header>
  );
}
