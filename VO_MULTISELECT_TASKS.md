# Timeline — Multi-select & Group Drag for Voiceover Segments — Task Tracker

Today the timeline selects exactly one segment across all tracks: `selectedVoId` is a
`string | null`, `startVoDrag` replaces the selection on pointer-down, and `voDragStartRef`
holds one segment's origin. This adds shift/⌘-click multi-selection on the **Voiceover track**
and drags the whole set together, preserving relative spacing.

Scope is the VO track (what was asked about), but the selection and group-drag helpers are
written against generic ids/spans so SFX, user voice, stickers and overlays can adopt them
without a rewrite.

**Key behaviours**
- ⌘/Ctrl-click toggles one chip in or out of the selection.
- Shift-click selects the range between the anchor and the clicked chip, in timeline order.
- Plain click on an *already multi-selected* chip keeps the group, so the drag can start.
- A group move clamps against the **group's** bounds — the earliest chip can't cross 0 and the
  latest can't pass the end — so spacing between chips never collapses.
- Resize stays single-segment; only "move" is a group operation.

**Working rule:** one task at a time — implement → tests → validation → gate, then next.
`npx tsc --noEmit` clean at every gate. No commits (per session instruction).

- [x] **Task 0 — Tracked task doc.** This file. _Validation:_ lists Tasks 1–6.
- [x] **Task 1 — Bulk reducer action** (`state/projectReducer.ts`): `UPDATE_VOS` so a group move
      is one dispatch and one history step. _Tests:_ reducer spec. _Gate:_ vitest + tsc.
- [x] **Task 2 — Selection model** (`studio/timelineSelection.ts`): `intentFromModifiers`,
      `nextSelection` (replace / toggle / range + anchor). _Tests:_ full matrix. _Gate:_ vitest + tsc.
- [x] **Task 3 — Group drag math** (`domain/voGroupDrag.ts`): clamp one delta against group bounds,
      preserve spacing, return only changed segments. _Tests:_ clamps + spacing. _Gate:_ vitest + tsc.
- [x] **Task 4 — StudioApp state**: `selectedVoIds: string[]` threaded to Timeline/Inspector, with a
      primary id derived for the existing Inspector card. _Gate:_ tsc.
- [x] **Task 5 — Timeline wiring**: modifier-aware pointer-down, multi-chip selected styling,
      group move through the new helpers. _Gate:_ vitest + tsc.
- [x] **Task 6 — E2E gate:** ✅ `vitest run` 869/869 across 93 files, ✅ `npx tsc --noEmit`,
      ✅ `yarn build`. ⏳ Manual drag pass in the browser still pending.

## Design note — why the selection callback returns its result

`startVoDrag` both selects and starts the drag from one pointer-down. Reading the selection
back after calling the handler would give the *pre-click* set, so a drag begun right after a
⌘- or ⇧-click would have moved only the clicked chip. `onSelectVoMulti` therefore returns the
resulting ids and the origin snapshot is taken from those.

## Follow-up — background press deselects (done)

`TimelineCanvas` now takes an `onPointerDown` that clears the track selection, so pressing
anywhere on the timeline that isn't a segment deactivates the active chip. Every drag-start
(`startVoDrag`, `startSfxDrag`, `startOverlayDrag`, `startUserVoiceDrag`, `startStickerDrag`)
already called `stopPropagation`, which is what makes this safe: the handler bubbles *after*
the chip's, so without that a chip would select itself and be deselected on the way up.

Applied to all five segment tracks rather than VO alone — they already behave as one mutually
exclusive selection, so clearing only VO would leave an odd track lit. Beat selection is
untouched (the preview always needs a current beat). Clicks outside the timeline — the
Inspector especially — do not deselect, or editing the selected segment would be impossible.

Covered by `studio/timelineDeselect.test.tsx`, the first render test for `Timeline`; it needs
jsdom stubs for `ResizeObserver`, pointer capture, and `localStorage`.

## Deliberately not included

- Marquee / rubber-band selection.
- Multi-select on the SFX, user-voice, sticker and overlay tracks (helpers are ready for it).
- Collapsing a multi-selection to one chip on click-without-drag.
- Group resize, and multi-segment editing in the Inspector (it still edits the primary chip).
- ~~Delete removes only the primary chip~~ — **done.** `REMOVE_VOS` deletes the set in one
  dispatch, the confirm modal counts ("Delete 3 timeline segments?"), and the targeting moved
  into `studio/timelineDeletion.ts` so it is testable. A chip's own X button still removes only
  that chip: pointing at one chip's X is an unambiguous single-target gesture.
