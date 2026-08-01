// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { installTimelineTestEnv } from "./timelineTestSetup";
import { ProjectProvider } from "../state/ProjectContext";
import type { Clip, Cut } from "../domain/types";
import Timeline from "./Timeline";
import {
  intentFromModifiers,
  nextSelection,
  primarySelectedId,
  type SelectionState,
} from "./timelineSelection";

/**
 * Selection wiring, exercised through the *real* handler shapes StudioApp passes down
 * rather than through mocks.
 *
 * This is the level the previous tests missed: each of Timeline's drag-starters used to
 * select its own chip and then null the other four, which was harmless while the host
 * handlers only set their own state. Once the host began every selection by clearing all
 * five tracks, those trailing nulls wiped the selection that had just been made — in the
 * same batch, so nothing on any track could be selected at all. Mocked handlers cannot
 * see that; only the composition can.
 */

const clip: Clip = {
  id: "c1",
  file: new File([], "a.mp4"),
  name: "a.mp4",
  durationSec: 10,
  width: 1920,
  height: 1080,
};

const cut: Cut = {
  aspect: "9:16",
  beats: [
    { id: "b1", clipId: "c1", inSec: 0, outSec: 4, durationSec: 4, scriptText: "", captionText: "one" },
    { id: "b2", clipId: "c1", inSec: 0, outSec: 4, durationSec: 4, scriptText: "", captionText: "two" },
  ],
  voSegments: [
    { id: "v1", text: "first line", startTimeSec: 0, durationSec: 2, captionVisible: true },
    { id: "v2", text: "second line", startTimeSec: 4, durationSec: 2, captionVisible: true },
  ],
  sfxSegments: [
    { id: "s1", fileName: "whoosh.mp3", startTimeSec: 1, durationSec: 1, sourceDurationSec: 1, volume: 1 },
  ],
};

/** Mirrors StudioApp's selection state and handler shapes exactly. */
function Harness() {
  const [voSelection, setVoSelection] = useState<SelectionState>({ ids: [], anchorId: null });
  const [selectedSfxId, setSelectedSfxId] = useState<string | null>(null);
  const [selectedUserVoiceId, setSelectedUserVoiceId] = useState<string | null>(null);
  const [selectedStickerId, setSelectedStickerId] = useState<string | null>(null);
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  const [selectedBeatId, setSelectedBeatId] = useState<string | null>("b1");

  function clearSegmentSelections() {
    setVoSelection({ ids: [], anchorId: null });
    setSelectedSfxId(null);
    setSelectedUserVoiceId(null);
    setSelectedStickerId(null);
    setSelectedOverlayId(null);
  }

  const selectedVoId = primarySelectedId(voSelection);

  return (
    <>
      <output aria-label="selection">
        {`vo=${voSelection.ids.join(",") || "-"}|sfx=${selectedSfxId ?? "-"}|beat=${selectedBeatId ?? "-"}`}
      </output>
      <Timeline
        cut={cut}
        clipById={new Map([[clip.id, clip]])}
        clips={[clip]}
        selectedBeatId={selectedBeatId}
        onSelectBeat={(id) => { setSelectedBeatId(id); clearSegmentSelections(); }}
        selectedVoId={selectedVoId}
        selectedVoIds={voSelection.ids}
        onSelectVo={(id) => { clearSegmentSelections(); setVoSelection(id ? { ids: [id], anchorId: id } : { ids: [], anchorId: null }); }}
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
        selectedOverlayId={selectedOverlayId}
        onSelectOverlay={(id) => { clearSegmentSelections(); setSelectedOverlayId(id); }}
        onRequestDeleteSegment={() => {}}
      />
    </>
  );
}

function selection(): string {
  return screen.getByLabelText("selection").textContent ?? "";
}

function chip(text: string, className = ".st-vo-chip"): HTMLElement {
  const found = screen.getByText(text).closest(className);
  if (!found) throw new Error(`no chip for "${text}"`);
  return found as HTMLElement;
}

beforeEach(installTimelineTestEnv);

afterEach(() => {
  cleanup();
});

describe("segments stay selected through the real host handlers", () => {
  it("selects a voiceover chip on pointer down", () => {
    render(<ProjectProvider><Harness /></ProjectProvider>);
    expect(selection()).toBe("vo=-|sfx=-|beat=b1");

    fireEvent.pointerDown(chip("first line"));

    expect(selection()).toBe("vo=v1|sfx=-|beat=b1");
  });

  it("selects a sound effect chip on pointer down", () => {
    render(<ProjectProvider><Harness /></ProjectProvider>);

    fireEvent.pointerDown(chip("whoosh.mp3", ".st-sfx-chip"));

    expect(selection()).toBe("vo=-|sfx=s1|beat=b1");
  });

  it("moves the selection from one track to another without leaving both lit", () => {
    render(<ProjectProvider><Harness /></ProjectProvider>);

    fireEvent.pointerDown(chip("first line"));
    expect(selection()).toBe("vo=v1|sfx=-|beat=b1");

    fireEvent.pointerDown(chip("whoosh.mp3", ".st-sfx-chip"));
    expect(selection()).toBe("vo=-|sfx=s1|beat=b1");

    fireEvent.pointerDown(chip("second line"));
    expect(selection()).toBe("vo=v2|sfx=-|beat=b1");
  });

  it("keeps ⌘-click accumulating a voiceover multi-selection", () => {
    render(<ProjectProvider><Harness /></ProjectProvider>);

    fireEvent.pointerDown(chip("first line"));
    fireEvent.pointerDown(chip("second line"), { metaKey: true });

    expect(selection()).toBe("vo=v1,v2|sfx=-|beat=b1");
  });

  it("hands the active slot to a beat and clears the segment", () => {
    render(<ProjectProvider><Harness /></ProjectProvider>);

    fireEvent.pointerDown(chip("first line"));
    fireEvent.click(document.querySelectorAll(".st-beat")[1]);

    expect(selection()).toBe("vo=-|sfx=-|beat=b2");
  });

  it("clears every track when the timeline background is pressed", () => {
    render(<ProjectProvider><Harness /></ProjectProvider>);

    fireEvent.pointerDown(chip("first line"));
    fireEvent.pointerDown(document.querySelector(".ui-timeline-canvas")!);

    expect(selection()).toBe("vo=-|sfx=-|beat=b1");
  });
});
