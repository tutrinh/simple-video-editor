import { describe, expect, it } from "vitest";
import {
  intentFromModifiers,
  nextSelection,
  primarySelectedId,
  pruneSelection,
  type SelectionState,
} from "./timelineSelection";

const ORDER = ["a", "b", "c", "d", "e"];
const empty: SelectionState = { ids: [], anchorId: null };

describe("intentFromModifiers", () => {
  it("reads shift as range and cmd/ctrl as toggle", () => {
    expect(intentFromModifiers({ shiftKey: true, metaKey: false, ctrlKey: false })).toBe("range");
    expect(intentFromModifiers({ shiftKey: false, metaKey: true, ctrlKey: false })).toBe("toggle");
    expect(intentFromModifiers({ shiftKey: false, metaKey: false, ctrlKey: true })).toBe("toggle");
    expect(intentFromModifiers({ shiftKey: false, metaKey: false, ctrlKey: false })).toBe("replace");
  });

  it("lets shift win when both modifiers are held", () => {
    expect(intentFromModifiers({ shiftKey: true, metaKey: true, ctrlKey: false })).toBe("range");
  });
});

describe("nextSelection — replace", () => {
  it("selects a single chip from nothing", () => {
    expect(nextSelection(empty, "c", "replace", ORDER)).toEqual({ ids: ["c"], anchorId: "c" });
  });

  it("replaces an existing single selection", () => {
    const state = { ids: ["a"], anchorId: "a" };
    expect(nextSelection(state, "d", "replace", ORDER)).toEqual({ ids: ["d"], anchorId: "d" });
  });

  it("keeps a multi-selection when clicking a chip already inside it, so a group drag can start", () => {
    const state = { ids: ["b", "c", "d"], anchorId: "b" };
    expect(nextSelection(state, "c", "replace", ORDER)).toEqual({ ids: ["b", "c", "d"], anchorId: "c" });
  });

  it("collapses to one when clicking outside a multi-selection", () => {
    const state = { ids: ["b", "c", "d"], anchorId: "b" };
    expect(nextSelection(state, "a", "replace", ORDER)).toEqual({ ids: ["a"], anchorId: "a" });
  });
});

describe("nextSelection — toggle", () => {
  it("adds a chip to the selection", () => {
    const state = { ids: ["a"], anchorId: "a" };
    expect(nextSelection(state, "d", "toggle", ORDER)).toEqual({ ids: ["a", "d"], anchorId: "d" });
  });

  it("removes an already-selected chip", () => {
    const state = { ids: ["a", "d"], anchorId: "d" };
    expect(nextSelection(state, "a", "toggle", ORDER)).toEqual({ ids: ["d"], anchorId: "d" });
  });

  it("hands the anchor on when the anchor itself is deselected", () => {
    const state = { ids: ["a", "b", "c"], anchorId: "c" };
    expect(nextSelection(state, "c", "toggle", ORDER)).toEqual({ ids: ["a", "b"], anchorId: "b" });
  });

  it("can empty the selection entirely", () => {
    const state = { ids: ["a"], anchorId: "a" };
    expect(nextSelection(state, "a", "toggle", ORDER)).toEqual({ ids: [], anchorId: null });
  });
});

describe("nextSelection — range", () => {
  it("spans forward from the anchor in timeline order", () => {
    const state = { ids: ["b"], anchorId: "b" };
    expect(nextSelection(state, "d", "range", ORDER)).toEqual({ ids: ["b", "c", "d"], anchorId: "b" });
  });

  it("spans backward from the anchor", () => {
    const state = { ids: ["d"], anchorId: "d" };
    expect(nextSelection(state, "b", "range", ORDER)).toEqual({ ids: ["b", "c", "d"], anchorId: "d" });
  });

  it("keeps the anchor so repeated shift-clicks re-span rather than accumulate", () => {
    const first = nextSelection({ ids: ["b"], anchorId: "b" }, "e", "range", ORDER);
    expect(first.ids).toEqual(["b", "c", "d", "e"]);
    const second = nextSelection(first, "c", "range", ORDER);
    expect(second.ids).toEqual(["b", "c"]);
  });

  it("falls back to a single selection with no anchor", () => {
    expect(nextSelection(empty, "c", "range", ORDER)).toEqual({ ids: ["c"], anchorId: "c" });
  });

  it("recovers when the anchor no longer exists on the track", () => {
    const state = { ids: [], anchorId: "gone" };
    expect(nextSelection(state, "c", "range", ORDER)).toEqual({ ids: ["c"], anchorId: "c" });
  });

  it("returns the clicked chip alone when it is not on the track", () => {
    const state = { ids: ["a"], anchorId: "a" };
    expect(nextSelection(state, "ghost", "range", ORDER)).toEqual({ ids: ["ghost"], anchorId: "ghost" });
  });
});

describe("pruneSelection", () => {
  it("drops ids whose segments are gone", () => {
    const state = { ids: ["a", "b", "c"], anchorId: "b" };
    expect(pruneSelection(state, ["a", "c"])).toEqual({ ids: ["a", "c"], anchorId: "c" });
  });

  it("keeps the anchor when it survives", () => {
    const state = { ids: ["a", "b", "c"], anchorId: "a" };
    expect(pruneSelection(state, ["a", "b"])).toEqual({ ids: ["a", "b"], anchorId: "a" });
  });

  it("returns the same object when nothing changed, so effects do not loop", () => {
    const state = { ids: ["a", "b"], anchorId: "a" };
    expect(pruneSelection(state, ["a", "b", "c"])).toBe(state);
  });

  it("empties cleanly", () => {
    expect(pruneSelection({ ids: ["a"], anchorId: "a" }, [])).toEqual({ ids: [], anchorId: null });
  });
});

describe("primarySelectedId", () => {
  it("is the anchor while it is still selected", () => {
    expect(primarySelectedId({ ids: ["a", "b", "c"], anchorId: "b" })).toBe("b");
  });

  it("falls back to the last selected chip", () => {
    expect(primarySelectedId({ ids: ["a", "b"], anchorId: "gone" })).toBe("b");
  });

  it("is null when nothing is selected", () => {
    expect(primarySelectedId(empty)).toBeNull();
  });
});
