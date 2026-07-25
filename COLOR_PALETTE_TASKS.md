# Shared colour palette — Task Tracker

One `ColorField` component and one global palette behind every colour control.
A colour eyedropped on a Sticker tint is there for a Title layer, and in the
next project. Decisions and rationale in
[ADR-0013](./docs/adr/0013-shared-colour-palette.md).

**Binding constraint: no second palette.** `TitleTreatmentEditor`'s
`TITLE_SWATCHES` and the Sticker tint row's inline list both go away — there is
one source of colours, `colorPalette.ts`, and one component that renders it.
The storage module mirrors `stickerLibrary.ts`'s favourites idiom call for call
(same `localStorage` guard, same corrupt-storage degradation, same
"convenience, not state" write policy).

**Working rule:** one task at a time — implement → tests → validation gate →
next. `npx tsc --noEmit` clean at every gate. No commits (per session
instruction).

---

- [x] **Task 0 — Docs.** ADR-0013 and this tracker.
  _Gate:_ ✅ files exist.

- [x] **Task 1 — Palette store.** `src/lib/colorPalette.ts` mirroring
  `stickerLibrary.ts`'s favourites: `DEFAULT_PALETTE`, `loadPalette()` seeding
  from it on first read, `addPaletteColor`, `removePaletteColor`, and
  `normalizeHex` as the one place hex is canonicalised. Appends rather than
  reordering (a palette that moves under the cursor is worse than a stale one);
  rolling `MAX_PALETTE` of 20 dropping from the front. A `subscribe()` so every
  mounted picker updates when any one of them adds a colour.
  _Tests:_ `normalizeHex` — `#FFF`/`fff`/`#FFFFFF`/uppercase/whitespace all
  canonicalise, and `#ggg`, `""`, `#12345`, `rgb(0,0,0)` reject; `loadPalette`
  seeds defaults, survives corrupt/non-array/missing storage, and filters
  invalid entries; `addPaletteColor` dedupes case-insensitively, appends rather
  than prepending, is a no-op for a colour already present, rejects invalid hex,
  and drops from the front at the cap; `removePaletteColor` removes a default
  like any other and no-ops on an absent colour; `subscribe` fires on add and
  remove and unsubscribes cleanly, and one throwing subscriber does not stop
  the others.
  _Gate:_ ✅ vitest (26) + `tsc`.

- [x] **Task 2 — `ColorField` component.** `src/studio/ColorField.tsx`:
  the swatch row, the `<input type="color">`, and an `EyeDropper` button that is
  feature-detected and absent where unsupported. `value`/`onChange` only — it
  does not know what it is colouring. Anything picked through either route is
  added to the palette. Right-click a swatch to remove it, with the tooltip
  saying so. Styling is lifted verbatim from the existing rows (18×18, radius 4,
  `--accent` ring on the active swatch) so neither site changes appearance
  except for the wider row. `normalizeHex` also grew a `typeof` guard: it used
  to coerce, so a numeric `123` parsed as the shorthand `#112233` and would have
  put a colour nobody picked into the palette.
  _Gate:_ ✅ `tsc` + `yarn build`.

- [x] **Task 3 — Title layers.** `TitleTreatmentEditor` renders `ColorField`;
  `TITLE_SWATCHES` is deleted. This lands in both title surfaces at once — the
  Inspector's per-beat card and Export's cut-level editor share the component.
  _Gate:_ ✅ `tsc` + `yarn build`, and `TITLE_SWATCHES` greps clean.

- [x] **Task 4 — Sticker tint.** The Inspector's tint swatch row becomes a
  `ColorField`; the inline seven-colour list is deleted. Picking a colour still
  turns the tint on when it was off (`tintStrength || 1`), which is behaviour
  the row already had and the shared component must not swallow.
  _Gate:_ ✅ `tsc` + `yarn build`.

- [x] **Task 5 — E2E gate.** Full `vitest run`, `tsc`, `yarn build`.
  ⏳ Manual pass: eyedrop a colour off the preview while tinting a Sticker,
  confirm it appears in a Title layer's row without a reload, restart the dev
  server and confirm it survived, then right-click it away.
  _Gate:_ ✅ `vitest run` 352/352 across 30 files, ✅ `tsc`, ✅ `yarn build`.
  ⏳ Manual pass still pending — the eyedropper and the cross-row live update
  have not been exercised in a browser.
