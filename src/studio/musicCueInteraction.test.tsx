// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useEffect } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ProjectProvider, useProject } from "../state/ProjectContext";
import type { Clip, Cut, MusicTrack } from "../domain/types";
import { installTimelineTestEnv } from "./timelineTestSetup";
import Timeline from "./Timeline";
import { ControlButton } from "../design-system/ControlPrimitives";

const clip: Clip = {
  id: "c1", file: new File([], "clip.mp4"), name: "clip.mp4",
  durationSec: 10, width: 1920, height: 1080,
};
const cut: Cut = {
  aspect: "16:9",
  beats: [{ id: "b1", clipId: "c1", inSec: 0, outSec: 4, durationSec: 4, scriptText: "", captionText: "" }],
};
const musicTrack: MusicTrack = {
  id: "music-1",
  name: "song.wav",
  file: new File([], "song.wav", { type: "audio/wav" }),
  durationSec: 8,
  waveform: [0.2, 0.8, 0.3],
  cueMarkers: [{ timeSec: 2, strength: 1 }],
  volume: 0.5,
  sourceKind: "audio",
};

function Harness() {
  const { state, dispatch } = useProject();
  useEffect(() => {
    dispatch({ type: "ADD_CLIPS", clips: [clip] });
    dispatch({ type: "SET_CUT", cut });
    dispatch({ type: "SET_MUSIC_TRACK", track: musicTrack });
  }, [dispatch]);
  if (!state.cut) return null;
  return (
    <>
      <output aria-label="cut duration">{state.cut.beats.reduce((sum, beat) => sum + beat.durationSec, 0)}</output>
      <ControlButton type="button" onClick={() => dispatch({ type: "SET_MUSIC_TRACK", track: musicTrack })}>Re-add music</ControlButton>
      <Timeline
        cut={state.cut}
        clips={state.clips}
        clipById={new Map(state.clips.map((item) => [item.id, item]))}
        selectedBeatId="b1"
        onSelectBeat={() => {}}
        onRequestDeleteSegment={() => {}}
      />
    </>
  );
}

beforeEach(installTimelineTestEnv);
afterEach(cleanup);

describe("music cue interaction", () => {
  it("selecting a cue stays non-destructive across remove and re-add", async () => {
    const { container } = render(<ProjectProvider><Harness /></ProjectProvider>);
    await waitFor(() => expect(container.querySelector(".st-waveform-cue")).not.toBeNull());
    const cue = container.querySelector(".st-waveform-cue") as HTMLButtonElement;
    expect(screen.getByLabelText("cut duration").textContent).toBe("4");

    fireEvent.click(cue);

    expect(screen.getByLabelText("cut duration").textContent).toBe("4");
    expect(screen.getByRole("button", { name: /Set Beat end/ })).toBeTruthy();

    fireEvent.click(screen.getByTitle("Remove music track"));
    expect(screen.getByLabelText("cut duration").textContent).toBe("4");

    fireEvent.click(screen.getByRole("button", { name: "Re-add music" }));
    await waitFor(() => expect(container.querySelector(".st-waveform-cue")).not.toBeNull());
    expect(screen.queryByRole("button", { name: /Set Beat end/ })).toBeNull();

    fireEvent.pointerDown(container.querySelector(".st-waveform-cue") as HTMLButtonElement);
    fireEvent.click(container.querySelector(".st-waveform-cue") as HTMLButtonElement);
    expect(screen.getByLabelText("cut duration").textContent).toBe("4");

    fireEvent.click(screen.getByRole("button", { name: /Set Beat end/ }));

    expect(screen.getByLabelText("cut duration").textContent).toBe("2");
  });
});
