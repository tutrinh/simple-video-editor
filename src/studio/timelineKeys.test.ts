import { describe, expect, it } from "vitest";
import { resolveTimelineKeyAction, type TimelineKeyEvent } from "./timelineKeys";

function keyEvent(overrides: Partial<TimelineKeyEvent> = {}): TimelineKeyEvent {
  return {
    key: "ArrowUp",
    repeat: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    fromFormControl: false,
    ...overrides,
  };
}

describe("resolveTimelineKeyAction", () => {
  it("maps Up/Down to resizing the selected beat", () => {
    expect(resolveTimelineKeyAction(keyEvent({ key: "ArrowUp" }))).toEqual({ kind: "resize", direction: 1 });
    expect(resolveTimelineKeyAction(keyEvent({ key: "ArrowDown" }))).toEqual({ kind: "resize", direction: -1 });
  });

  it("maps Left/Right to moving the selection", () => {
    expect(resolveTimelineKeyAction(keyEvent({ key: "ArrowRight" }))).toEqual({ kind: "select", direction: 1 });
    expect(resolveTimelineKeyAction(keyEvent({ key: "ArrowLeft" }))).toEqual({ kind: "select", direction: -1 });
  });

  it("lets a held Up/Down keep nudging, like a native number input", () => {
    expect(resolveTimelineKeyAction(keyEvent({ key: "ArrowUp", repeat: true }))).toEqual({
      kind: "resize",
      direction: 1,
    });
  });

  it("still ignores a held Left/Right so selection does not spin", () => {
    expect(resolveTimelineKeyAction(keyEvent({ key: "ArrowLeft", repeat: true }))).toBeNull();
  });

  it("maps f to fitting the selected voiceover", () => {
    expect(resolveTimelineKeyAction(keyEvent({ key: "f" }))).toEqual({ kind: "fit-vo" });
    expect(resolveTimelineKeyAction(keyEvent({ key: "F" }))).toEqual({ kind: "fit-vo" });
  });

  it("ignores a held f so a burst of synthesis requests cannot queue up", () => {
    expect(resolveTimelineKeyAction(keyEvent({ key: "f", repeat: true }))).toBeNull();
  });

  it("ignores keystrokes typed into a form control", () => {
    // Otherwise the Inspector's own duration input would step twice per press, and
    // typing an "f" into any caption field would fire a synthesis.
    expect(resolveTimelineKeyAction(keyEvent({ key: "ArrowUp", fromFormControl: true }))).toBeNull();
    expect(resolveTimelineKeyAction(keyEvent({ key: "ArrowLeft", fromFormControl: true }))).toBeNull();
    expect(resolveTimelineKeyAction(keyEvent({ key: "f", fromFormControl: true }))).toBeNull();
  });

  it("ignores modified keys, leaving them to the browser and OS", () => {
    expect(resolveTimelineKeyAction(keyEvent({ metaKey: true }))).toBeNull();
    expect(resolveTimelineKeyAction(keyEvent({ ctrlKey: true }))).toBeNull();
    expect(resolveTimelineKeyAction(keyEvent({ altKey: true }))).toBeNull();
    // Cmd-F is the browser's find, not ours.
    expect(resolveTimelineKeyAction(keyEvent({ key: "f", metaKey: true }))).toBeNull();
  });

  it("ignores every other key", () => {
    for (const key of ["a", "Enter", " ", "Tab", "Escape", "PageUp"]) {
      expect(resolveTimelineKeyAction(keyEvent({ key }))).toBeNull();
    }
  });

  it("leaves the preview's own c/b shortcuts alone", () => {
    expect(resolveTimelineKeyAction(keyEvent({ key: "c" }))).toBeNull();
    expect(resolveTimelineKeyAction(keyEvent({ key: "b" }))).toBeNull();
  });
});
