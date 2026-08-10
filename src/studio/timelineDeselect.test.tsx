// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ProjectProvider } from "../state/ProjectContext";
import type { Clip, Cut } from "../domain/types";
import Timeline from "./Timeline";
import { installTimelineTestEnv } from "./timelineTestSetup";

// Event-ordering behaviour, so it needs the real DOM: a chip's pointer-down must stop
// short of the canvas handler that clears the selection, or every chip would select
// itself and be deselected again on the way up.

afterEach(() => {
  cleanup();
});

beforeEach(installTimelineTestEnv);

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
};

function renderTimeline(overrides: Partial<React.ComponentProps<typeof Timeline>> = {}) {
  const handlers = {
    onSelectVo: vi.fn(),
    onSelectSfx: vi.fn(),
    onSelectUserVoice: vi.fn(),
    onSelectSticker: vi.fn(),
    onSelectOverlay: vi.fn(),
    onSelectVoMulti: vi.fn().mockReturnValue(["v1"]),
    onSelectBeat: vi.fn(),
  };

  render(
    <ProjectProvider>
      <Timeline
        cut={cut}
        clipById={new Map([[clip.id, clip]])}
        clips={[clip]}
        selectedBeatId="b1"
        selectedVoId="v1"
        selectedVoIds={["v1"]}
        onRequestDeleteSegment={vi.fn()}
        {...handlers}
        {...overrides}
      />
    </ProjectProvider>,
  );

  return handlers;
}

function voChip(text: string): HTMLElement {
  const chip = screen.getByText(text).closest(".st-vo-chip");
  if (!chip) throw new Error(`no VO chip for "${text}"`);
  return chip as HTMLElement;
}

function beatEls(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(".st-beat")];
}

describe("timeline background deselect", () => {
  it("overlays a speed curve only on ramp-enabled Beats", () => {
    renderTimeline({
      cut: {
        ...cut,
        beats: [
          { ...cut.beats[0], speedRamp: { enabled: true, startSpeed: 1, middleSpeed: 3, endSpeed: 1 } },
          cut.beats[1],
        ],
      },
    });

    expect(document.querySelectorAll(".st-beat-speed-ramp")).toHaveLength(1);
    expect(document.querySelectorAll(".st-beat-speed-ramp .st-speed-ramp-band")).toHaveLength(1);
    expect(document.querySelectorAll(".st-beat-speed-ramp .st-speed-ramp-band-handle")).toHaveLength(2);
  });

  it("clears every track selection when the canvas background is pressed", () => {
    const handlers = renderTimeline();

    const canvas = document.querySelector(".ui-timeline-canvas");
    expect(canvas).toBeTruthy();
    fireEvent.pointerDown(canvas!);

    expect(handlers.onSelectVo).toHaveBeenCalledWith(null);
    expect(handlers.onSelectSfx).toHaveBeenCalledWith(null);
    expect(handlers.onSelectUserVoice).toHaveBeenCalledWith(null);
    expect(handlers.onSelectSticker).toHaveBeenCalledWith(null);
    expect(handlers.onSelectOverlay).toHaveBeenCalledWith(null);
  });

  it("does not clear the selection when a VO chip itself is pressed", () => {
    const handlers = renderTimeline();

    fireEvent.pointerDown(voChip("first line"), { bubbles: true });

    // The chip selects through onSelectVoMulti and the background handler never runs.
    expect(handlers.onSelectVoMulti).toHaveBeenCalled();
    expect(handlers.onSelectVo).not.toHaveBeenCalledWith(null);
    expect(handlers.onSelectSfx).not.toHaveBeenCalled();
  });

  it("clears the selection when the empty part of the voiceover lane is pressed", () => {
    const handlers = renderTimeline();

    const lane = voChip("first line").parentElement;
    expect(lane?.classList.contains("st-vo-canvas")).toBe(true);
    fireEvent.pointerDown(lane!);

    expect(handlers.onSelectVo).toHaveBeenCalledWith(null);
    expect(handlers.onSelectVoMulti).not.toHaveBeenCalled();
  });

  it("marks every chip in a multi-selection as selected, and only one as primary", () => {
    renderTimeline({ selectedVoId: "v2", selectedVoIds: ["v1", "v2"] });

    const first = voChip("first line");
    const second = voChip("second line");

    expect(first.classList.contains("sel")).toBe(true);
    expect(second.classList.contains("sel")).toBe(true);
    expect(first.classList.contains("primary")).toBe(false);
    expect(second.classList.contains("primary")).toBe(true);
  });

  it("falls back to the single-select prop when no multi-selection is supplied", () => {
    renderTimeline({ selectedVoId: "v2", selectedVoIds: undefined });

    expect(voChip("second line").classList.contains("sel")).toBe(true);
    expect(voChip("first line").classList.contains("sel")).toBe(false);
  });
});

describe("only one timeline element is active at a time", () => {
  const noSegments = {
    selectedVoId: null,
    selectedVoIds: [] as string[],
    selectedSfxId: null,
    selectedUserVoiceId: null,
    selectedStickerId: null,
    selectedOverlayId: null,
  };

  it("shows the beat as active when no segment is selected", () => {
    renderTimeline(noSegments);
    expect(beatEls()[0].classList.contains("sel")).toBe(true);
    expect(beatEls()[1].classList.contains("sel")).toBe(false);
  });

  it("deactivates the beat while a voiceover segment is selected", () => {
    renderTimeline({ ...noSegments, selectedVoId: "v1", selectedVoIds: ["v1"] });

    // The beat id is still set — the preview needs it — but nothing in the timeline
    // renders active except the chip.
    expect(beatEls().some((el) => el.classList.contains("sel"))).toBe(false);
    expect(voChip("first line").classList.contains("sel")).toBe(true);
  });

  it("deactivates the beat for any other track that owns the selection", () => {
    for (const key of ["selectedSfxId", "selectedUserVoiceId", "selectedStickerId", "selectedOverlayId"] as const) {
      renderTimeline({ ...noSegments, [key]: "some-id" });
      expect(beatEls().some((el) => el.classList.contains("sel"))).toBe(false);
      cleanup();
    }
  });

  it("hands the active slot back to the beat when a beat is clicked", () => {
    const handlers = renderTimeline({ ...noSegments, selectedVoId: "v1", selectedVoIds: ["v1"] });

    fireEvent.click(beatEls()[1]);

    // StudioApp's selectBeatFromUser is what clears the segments; the timeline's job is
    // to report the click rather than to clear anything itself.
    expect(handlers.onSelectBeat).toHaveBeenCalledWith("b2");
  });

  it("ignores beat clicks during playback", () => {
    const handlers = renderTimeline({ ...noSegments, isPlaying: true });
    fireEvent.click(beatEls()[1]);
    expect(handlers.onSelectBeat).not.toHaveBeenCalled();
  });
});
