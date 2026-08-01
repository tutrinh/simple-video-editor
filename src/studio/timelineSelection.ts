// Multi-selection for timeline segments. Written against plain ids and a timeline
// ordering so any track (VO today; SFX, stickers, overlays later) can use it.

export type SelectionIntent = "replace" | "toggle" | "range";

export interface SelectionModifiers {
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
}

export interface SelectionState {
  ids: string[];
  /** The chip a subsequent shift-click measures its range from. */
  anchorId: string | null;
}

export function intentFromModifiers(modifiers: SelectionModifiers): SelectionIntent {
  if (modifiers.shiftKey) return "range";
  if (modifiers.metaKey || modifiers.ctrlKey) return "toggle";
  return "replace";
}

/**
 * The selection after clicking `clickedId`.
 *
 * `orderedIds` must be in timeline order — that is what a shift-click range spans, so
 * it is the drawn order rather than the array order of the segments.
 *
 * A plain click on a chip that is already part of a multi-selection keeps the whole
 * selection: pointer-down starts a drag, and collapsing to one chip there would make
 * dragging a group impossible.
 */
export function nextSelection(
  current: SelectionState,
  clickedId: string,
  intent: SelectionIntent,
  orderedIds: readonly string[],
): SelectionState {
  const currentIds = current.ids.filter((id) => orderedIds.includes(id));

  if (intent === "toggle") {
    const without = currentIds.filter((id) => id !== clickedId);
    if (without.length !== currentIds.length) {
      // Deselecting the anchor hands the anchor to whatever is still selected.
      return { ids: without, anchorId: current.anchorId === clickedId ? without[without.length - 1] ?? null : current.anchorId };
    }
    return { ids: [...currentIds, clickedId], anchorId: clickedId };
  }

  if (intent === "range") {
    const anchor = current.anchorId && orderedIds.includes(current.anchorId) ? current.anchorId : clickedId;
    const from = orderedIds.indexOf(anchor);
    const to = orderedIds.indexOf(clickedId);
    if (from < 0 || to < 0) return { ids: [clickedId], anchorId: clickedId };
    const [lo, hi] = from <= to ? [from, to] : [to, from];
    // The anchor is deliberately preserved, so repeated shift-clicks re-span from it.
    return { ids: orderedIds.slice(lo, hi + 1), anchorId: anchor };
  }

  if (currentIds.length > 1 && currentIds.includes(clickedId)) {
    return { ids: currentIds, anchorId: clickedId };
  }
  return { ids: [clickedId], anchorId: clickedId };
}

/** Drop ids that no longer exist (segment deleted, cut regenerated). */
export function pruneSelection(current: SelectionState, existingIds: readonly string[]): SelectionState {
  const ids = current.ids.filter((id) => existingIds.includes(id));
  if (ids.length === current.ids.length) return current;
  return {
    ids,
    anchorId: current.anchorId && ids.includes(current.anchorId) ? current.anchorId : ids[ids.length - 1] ?? null,
  };
}

/**
 * The single segment the Inspector edits. The last clicked chip when it is still
 * selected, otherwise the final one — never null while anything is selected.
 */
export function primarySelectedId(current: SelectionState): string | null {
  if (current.anchorId && current.ids.includes(current.anchorId)) return current.anchorId;
  return current.ids[current.ids.length - 1] ?? null;
}
