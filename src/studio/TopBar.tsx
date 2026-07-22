import { useState } from "react";
import { useProject } from "../state/ProjectContext";
import { useTheme } from "../state/ThemeContext";
import type { Aspect } from "../domain/types";
import { cutDuration } from "../features/assemble/assemble";
import { fmtClock, getFilterPreset } from "./util";
import FilterPresetModal from "./FilterPresetModal";

const ASPECTS: Aspect[] = ["16:9", "9:16", "1:1"];

interface Props {
  onExport: () => void;
  onStartOver: () => void;
}

export default function TopBar({ onExport, onStartOver }: Props) {
  const { state, dispatch } = useProject();
  const { theme, toggleTheme } = useTheme();
  const { clips, cut, title } = state;
  const titleSize = Math.min(40, Math.max(15, (title.length || "Untitled project".length) + 1));
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const activeGlobalFilter = getFilterPreset(cut?.globalFilterId);

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
      {cut && (
        <button
          className="st-btn ghost"
          style={{
            fontSize: 11,
            padding: "3px 10px",
            borderRadius: 999,
            borderColor: activeGlobalFilter ? "var(--accent)" : undefined,
            color: activeGlobalFilter ? "var(--accent)" : "var(--ink-2)",
            background: activeGlobalFilter ? "var(--accent-subtle, rgba(255,179,57,0.15))" : undefined,
          }}
          onClick={() => setFilterModalOpen(true)}
          title="Choose a global color grading filter preset for the cut"
        >
          🎨 {activeGlobalFilter ? activeGlobalFilter.name : "Color Filter"}
        </button>
      )}
      {cut && <span className="st-chip">1080p</span>}
      {cut && <span className="st-chip st-num">{fmtClock(cutDuration(cut))} · {cut.beats.length} beats</span>}
      {clips.length > 0 && <span className="st-chip st-num">{clips.length} clip{clips.length === 1 ? "" : "s"}</span>}

      <div className="st-spacer" />

      <button
        className="st-btn ghost"
        onClick={toggleTheme}
        title={theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
        aria-label="Toggle theme"
      >
        {theme === "dark" ? (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="5" />
            <line x1="12" y1="1" x2="12" y2="3" />
            <line x1="12" y1="21" x2="12" y2="23" />
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
            <line x1="1" y1="12" x2="3" y2="12" />
            <line x1="21" y1="12" x2="23" y2="12" />
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
          </svg>
        ) : (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
        )}
        {theme === "dark" ? "Light" : "Dark"}
      </button>

      <button className="st-btn danger" onClick={onStartOver} title="Clear everything">Start over</button>
      <button className="st-btn primary" onClick={onExport} disabled={!cut}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M12 3v11M8 10l4 4 4-4M5 20h14"/></svg>
        Export video
      </button>

      {filterModalOpen && (
        <FilterPresetModal
          activeFilterId={cut?.globalFilterId}
          activeIntensity={cut?.globalFilterIntensity}
          onSelectFilter={(filterId, intensity) => {
            dispatch({ type: "SET_GLOBAL_FILTER", filterId, intensity });
          }}
          onClose={() => setFilterModalOpen(false)}
        />
      )}
    </header>
  );
}
