import { useState } from "react";
import { useProject } from "../state/ProjectContext";
import { useTheme } from "../state/ThemeContext";
import type { Aspect } from "../domain/types";
import { cutDuration } from "../features/assemble/assemble";
import { fmtClock, getFilterPreset } from "./util";
import FilterPresetModal from "./FilterPresetModal";
import ProjectManagerModal from "./ProjectManagerModal";
import { useAutoSaveProject } from "../hooks/useAutoSaveProject";
import Toolbar from "../design-system/Toolbar";
import Button from "../design-system/Button";
import IconButton from "../design-system/IconButton";
import InlineTextField from "../design-system/InlineTextField";
import Badge from "../design-system/Badge";
import SegmentedControl from "../design-system/SegmentedControl";
import MenuIcon from "../design-system/icons/MenuIcon";
import SaveIcon from "../design-system/icons/SaveIcon";
import DownloadIcon from "../design-system/icons/DownloadIcon";
import SunIcon from "../design-system/icons/SunIcon";
import MoonIcon from "../design-system/icons/MoonIcon";

const ASPECTS: Aspect[] = ["16:9", "9:16", "1:1"];

interface Props {
  onExport: () => void;
  onStartOver: () => void;
  onOpenSettings: () => void;
  onOpenAiStory: () => void;
}

export default function TopBar({
  onExport,
  onStartOver: _onStartOver,
  onOpenSettings,
  onOpenAiStory,
}: Props) {
  const { state, dispatch } = useProject();
  const { theme, toggleTheme } = useTheme();
  const { clips, cut, title } = state;
  const titleSize = Math.min(
    40,
    Math.max(15, (title.length || "Untitled project".length) + 1),
  );
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [projectsModalOpen, setProjectsModalOpen] = useState(false);
  const { saveStatus } = useAutoSaveProject();
  const activeGlobalFilter = getFilterPreset(cut?.globalFilterId);

  // Aspect is a Cut property that doesn't affect beat trims — switch it without
  // rebuilding, preserving manual edits (export letterboxes/pads to the choice).
  function setAspect(a: Aspect) {
    if (cut && cut.aspect !== a)
      dispatch({ type: "SET_CUT", cut: { ...cut, aspect: a } });
  }

  return (
    <Toolbar className="st-topbar">
      <IconButton
        label="Open settings"
        icon={<MenuIcon size={18} />}
        onClick={onOpenSettings}
        title="Settings"
      />
      <div className="st-brand">
        <span className="dot" />
        VIDSTR
      </div>
      <div className="st-proj">
        <span aria-hidden="true">/</span>
        <InlineTextField
          className="st-title"
          value={title}
          placeholder="Untitled project"
          size={titleSize}
          onChange={(e) =>
            dispatch({ type: "SET_TITLE", title: e.target.value })
          }
          aria-label="Project title"
          title="Click to rename this project"
        />

        {/* Auto-Save Status Badge */}
        {clips.length > 0 && (
          <Badge tone={saveStatus === "saving" ? "signal" : "positive"}>
            {saveStatus === "saving"
              ? "Saving..."
              : saveStatus === "saved"
                ? "✓ Saved"
                : ""}
          </Badge>
        )}
      </div>

      <Button
        variant="secondary"
        size="small"
        icon={<SaveIcon size={14} />}
        onClick={() => setProjectsModalOpen(true)}
        title="View saved project drafts or export/import project files"
      >
        Projects
      </Button>
      {cut && (
        <SegmentedControl
          ariaLabel="Aspect ratio"
          value={cut.aspect}
          onChange={setAspect}
          options={ASPECTS.map((aspect) => ({ value: aspect, label: aspect }))}
        />
      )}
      {cut && (
        <Button
          variant={activeGlobalFilter ? "primary" : "secondary"}
          size="small"
          onClick={() => setFilterModalOpen(true)}
          title="Choose a global color grading filter preset for the cut"
        >
          {activeGlobalFilter ? activeGlobalFilter.name : "Color filter"}
        </Button>
      )}
      {cut && <Badge>1080p</Badge>}
      {cut && (
        <Badge>
          {fmtClock(cutDuration(cut))} / {cut.beats.length} beats
        </Badge>
      )}
      {clips.length > 0 && (
        <Badge>
          {clips.length} clip{clips.length === 1 ? "" : "s"}
        </Badge>
      )}

      <div className="st-spacer" />

      <Button
        variant="quiet"
        size="small"
        onClick={toggleTheme}
        title={
          theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"
        }
        aria-label="Toggle theme"
      >
        {theme === "dark" ? <SunIcon size={15} /> : <MoonIcon size={15} />}
        {theme === "dark" ? "Light" : "Dark"}
      </Button>

      {clips.length > 0 && (
        <Button
          variant="quiet"
          size="small"
          onClick={onOpenAiStory}
          title="Open the AI Story generator — analyze clips, author the story & script, refine each beat"
        >
          AI Story
        </Button>
      )}
      {/* <Button variant="danger" size="small" onClick={onStartOver} title="Clear everything">Start over</Button> */}
      <Button
        variant="primary"
        size="small"
        icon={<DownloadIcon size={14} />}
        onClick={onExport}
        disabled={!cut}
      >
        Export video
      </Button>

      {filterModalOpen && (
        <FilterPresetModal
          activeFilterId={cut?.globalFilterId}
          activeIntensity={cut?.globalFilterIntensity}
          activeAdjustments={cut?.globalFilterAdjustments}
          onSelectFilter={(filterId, intensity, adjustments) => {
            dispatch({
              type: "SET_GLOBAL_FILTER",
              filterId,
              intensity,
              adjustments,
            });
          }}
          onClose={() => setFilterModalOpen(false)}
        />
      )}

      <ProjectManagerModal
        isOpen={projectsModalOpen}
        onClose={() => setProjectsModalOpen(false)}
      />
    </Toolbar>
  );
}
