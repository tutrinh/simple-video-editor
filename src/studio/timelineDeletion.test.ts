import { describe, expect, it, vi } from "vitest";
import {
  pendingDeletionForSelection,
  type DeletionSelection,
  type TrackSegmentKind,
} from "./timelineDeletion";

const none: DeletionSelection = {
  voIds: [],
  sfxId: null,
  userVoiceId: null,
  stickerId: null,
  overlayId: null,
};

const label = (kind: TrackSegmentKind, id: string) => `${kind}:${id}`;

describe("pendingDeletionForSelection", () => {
  it("returns null when nothing is selected", () => {
    expect(pendingDeletionForSelection(none, label)).toBeNull();
  });

  it("targets every chip of a voiceover multi-selection, not just the primary", () => {
    const pending = pendingDeletionForSelection({ ...none, voIds: ["v1", "v2", "v3"] }, label);
    expect(pending).toEqual({
      kind: "voiceover",
      ids: ["v1", "v2", "v3"],
      label: "3 voiceover segments",
    });
  });

  it("uses the segment's own label for a single voiceover", () => {
    const pending = pendingDeletionForSelection({ ...none, voIds: ["v1"] }, label);
    expect(pending).toEqual({ kind: "voiceover", ids: ["v1"], label: "voiceover:v1" });
  });

  it("copies the id list so later selection changes cannot mutate a pending deletion", () => {
    const voIds = ["v1", "v2"];
    const pending = pendingDeletionForSelection({ ...none, voIds }, label);
    voIds.push("v3");
    expect(pending?.ids).toEqual(["v1", "v2"]);
  });

  it("handles each single-select track", () => {
    expect(pendingDeletionForSelection({ ...none, stickerId: "k1" }, label))
      .toEqual({ kind: "sticker", ids: ["k1"], label: "sticker:k1" });
    expect(pendingDeletionForSelection({ ...none, userVoiceId: "u1" }, label))
      .toEqual({ kind: "user voice", ids: ["u1"], label: "user voice:u1" });
    expect(pendingDeletionForSelection({ ...none, sfxId: "s1" }, label))
      .toEqual({ kind: "sound effect", ids: ["s1"], label: "sound effect:s1" });
    expect(pendingDeletionForSelection({ ...none, overlayId: "o1" }, label))
      .toEqual({ kind: "overlay", ids: ["o1"], label: "overlay:o1" });
  });

  it("resolves the label only for the track it targets", () => {
    const resolve = vi.fn(label);
    pendingDeletionForSelection({ ...none, sfxId: "s1" }, resolve);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith("sound effect", "s1");
  });

  it("does not call the label resolver for a multi-selection", () => {
    const resolve = vi.fn(label);
    pendingDeletionForSelection({ ...none, voIds: ["v1", "v2"] }, resolve);
    expect(resolve).not.toHaveBeenCalled();
  });
});
