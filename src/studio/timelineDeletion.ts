// What the Delete key targets. Split out of StudioApp because the answer is not
// "the selected id" — the voiceover track multi-selects, so the key has to remove the
// whole set while a chip's own X button still removes just that chip.

export type TrackSegmentKind = "overlay" | "voiceover" | "sound effect" | "user voice" | "sticker";

export interface PendingTrackDeletion {
  kind: TrackSegmentKind;
  ids: string[];
  label: string;
}

export interface DeletionSelection {
  voIds: readonly string[];
  sfxId: string | null;
  userVoiceId: string | null;
  stickerId: string | null;
  overlayId: string | null;
}

/**
 * The deletion the current selection implies, or null when nothing is selected.
 *
 * Tracks are checked in a fixed order, which only matters as a safety net: selections
 * are mutually exclusive, so at most one branch can match in practice.
 */
export function pendingDeletionForSelection(
  selection: DeletionSelection,
  resolveLabel: (kind: TrackSegmentKind, id: string) => string,
): PendingTrackDeletion | null {
  const single = (kind: TrackSegmentKind, id: string): PendingTrackDeletion => ({
    kind,
    ids: [id],
    label: resolveLabel(kind, id),
  });

  if (selection.stickerId) return single("sticker", selection.stickerId);
  if (selection.userVoiceId) return single("user voice", selection.userVoiceId);
  if (selection.sfxId) return single("sound effect", selection.sfxId);

  if (selection.voIds.length > 0) {
    const ids = [...selection.voIds];
    return {
      kind: "voiceover",
      ids,
      label: ids.length > 1 ? `${ids.length} voiceover segments` : resolveLabel("voiceover", ids[0]),
    };
  }

  if (selection.overlayId) return single("overlay", selection.overlayId);
  return null;
}
