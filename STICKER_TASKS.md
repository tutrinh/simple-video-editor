# Stickers — Task Tracker

Images (PNG/SVG/WebP) placed over the Cut on their own lane: draggable anywhere,
scalable, rotatable, favouritable, uploaded into the project's `stickers/` folder.
Decisions and rationale in [ADR-0011](./docs/adr/0011-stickers.md); the term in
[CONTEXT.md](./CONTEXT.md).

**Binding constraint: no drift.** The library and track half copies the SFX
system line for line (`audioLibrary` → `stickerLibrary`, `sfxLibrary.ts` →
`stickerLibrary.ts`, `SfxSegment` → `Sticker`, the SFX lane → the Sticker lane,
the four SFX reducer cases → four Sticker cases). The rendering half obeys
ADR-0008: one shared canvas renderer feeds both the preview and the export, so
position/scale/rotation cannot drift between them.

**Working rule:** one task at a time — implement → tests → validation gate → next.
`npx tsc --noEmit` clean at every gate. No commits (per session instruction).

---

- [x] **Task 0 — Docs.** ADR-0011, the CONTEXT term, this tracker, and the
  `stickers/` folder with its README.
  _Gate:_ ✅ files exist.

- [x] **Task 1 — Asset library.** `stickerLibrary(dir)` plugin in `vite.config.ts`
  serving `/api/stickers` list/file/upload, mirroring `audioLibrary` including the
  `basename()` traversal guard and the extension allowlist. `STICKERS_DIR` env
  override resolved like `AUDIO_DIR`. Client `src/lib/stickerLibrary.ts` mirroring
  `sfxLibrary.ts`, plus favourites in `localStorage` mirroring `voPresets.ts`.
  _Tests:_ `stickerLibrary.test.ts` — favourites round-trip, toggle on/off, order
  puts favourites first, unknown/corrupt storage degrades to empty, content type
  by extension.
  _Gate:_ ✅ vitest (13) + `tsc`.

- [x] **Task 2 — Domain + reducer.** `Sticker` on `cut.stickers`; `ADD_STICKER`,
  `UPDATE_STICKER`, `REMOVE_STICKER`, `DUPLICATE_STICKER` mirroring the SFX cases
  including the +0.5s duplicate offset and the clamp to the Cut's length.
  _Tests:_ added to `projectReducer.test.ts` — add/update/remove/duplicate, the
  offset, the clamp, and a no-cut no-op.
  _Gate:_ ✅ vitest (13) + `tsc`.

- [x] **Task 3 — Shared renderer** (`src/features/export/stickerCanvas.ts`),
  mirroring `titleCanvas.ts`: `drawSticker(ctx, sticker, img, w, h)` composes the
  asset onto a full-frame transparent bitmap at export resolution — translate to
  the centre point, rotate, scale, draw centred — and `renderStickerToPng` wraps
  it for the export. One image cache keyed by filename, SVG rasterised at export
  resolution.
  _Tests:_ geometry is pure and unit-testable — `stickerRect()` returns the
  destination box for a placement; centred/offset/scaled/rotated cases; fractions
  hold across 16:9, 9:16 and 1:1; clamps.
  _Gate:_ ✅ vitest (19) + `tsc`.

- [x] **Task 4 — Timeline lane + picker.** Sticker lane mirroring the SFX lane
  (drag to move, right edge to trim, duplicate, remove) and a "＋ Sticker" button
  opening `StickerPicker.tsx` — a thumbnail grid mirroring `SfxPicker.tsx`, with
  ★ favourite toggles and Upload. Favourites sort first.
  _Gate:_ `tsc` + `yarn build`.

- [x] **Task 5 — Inspector controls.** Selected-Sticker panel: X/Y position,
  Scale, Rotation (±180), Opacity, timing readout — built from the same
  `adjRow`-style slider rows the colour panel uses.
  _Gate:_ ✅ `tsc` + `yarn build`.

- [x] **Task 6 — Preview.** `FinalPreview` composites each active Sticker as the
  shared renderer's full-frame bitmap, CSS-scaled to the preview box (ADR-0008),
  gated on the Sticker's window in cut time.
  _Gate:_ ✅ `tsc` + `yarn build`.

- [x] **Task 7 — Export.** Per Beat segment, each overlapping Sticker is rendered
  to a PNG `EngineInput` and composited with `overlay=...:enable='between(t,a,b)'`
  in segment-local time, mirroring how B-roll Overlays are handled.
  _Tests:_ the segment-local window maths — a Sticker fully inside, straddling the
  start, straddling the end, spanning the whole segment, and outside it entirely.
  Sticker `-i` inputs sit LAST among the video inputs so the existing
  caption/title/overlay index arithmetic is untouched; audio's index moves past
  them. The "who emits `[v]`" rule was checked exhaustively across 162
  caption/title/overlay/sticker/rgb combinations — exactly one stage emits it in
  every case.
  _Gate:_ ✅ vitest + `tsc` + `yarn build`.

- [x] **Task 8 — E2E gate.** Full `vitest run`, `tsc`, `yarn build`; manual pass
  noted as pending a `yarn dev` run.
  _Gate:_ ✅ `vitest run` 262/262 across 27 files, ✅ `tsc`, ✅ `yarn build`.
  ⏳ Manual pass pending — drop a PNG and an SVG into `stickers/`, place both,
  scale/rotate/favourite them, and check the export matches the preview.

---

## Follow-up — Inspector card missing, and blend mode (2026-07-25)

- [x] **Task 9 — Fix the Inspector card's render site.** `{stickerCard}` was
  inserted twice into the *empty-state* branch and never into the main Beat
  inspector, so it never appeared while a Beat was selected — which is always.
  Cause: the 8-space-indented `{sfxCard}` match used to place it is a substring
  of the 10-space one, so both replacements hit the same line.
  _Gate:_ ✅ `tsc` + `yarn build`.

- [x] **Task 10 — Blend mode.** `Sticker.blendMode` reuses `OverlayBlendMode`
  rather than a parallel set; the Inspector select mirrors the B-roll Overlay's,
  same four options and wording.
  _Preview:_ one bitmap PER STICKER with its own CSS `mix-blend-mode` — a merged
  layer could only carry one mode. Matches the export, which already emits one
  PNG per Sticker.
  _Export:_ "normal" alpha-composites via `overlay` as before; the blend modes go
  through `blend` under the same gbrp pass a blended Overlay gets. `blend` has no
  alpha awareness, so a non-normal Sticker's bitmap is filled with that mode's
  neutral colour — black for screen, white for multiply, mid-grey for overlay —
  so the area outside the sticker leaves the frame unchanged. Without an RGB pass
  it falls back to alpha compositing rather than emitting a blend that would come
  out wrong in yuv.
  _Verification:_ the "who emits `[v]`" rule re-checked exhaustively across 153
  caption/title/overlay/sticker/rgb combinations — exactly one stage emits it.
  ⏳ The non-normal export path is new filtergraph work and is NOT yet confirmed
  against a real export.
  _Gate:_ ✅ vitest 262/262 + `tsc` + `yarn build`.

- [x] **Task 11 — Fit to beat.** A `fitToBeat` toggle (the shared `Switch`) makes
  a Sticker span the whole Beat it starts in. **Derived at read time**, never
  written back: `beatSpans()` walks the Beats in cut time and `resolveSticker()`
  swaps in that Beat's window, so retrimming the Beat can never leave a stale
  duration behind. It returns a `Sticker`, not a separate window type, so every
  downstream reader — preview, export, timeline chip — needed no change.
  Its own `startTimeSec` still decides which Beat it belongs to.
  _UI:_ a pinned chip is dashed, not draggable and has no trim handle; the
  Inspector readout shows the effective window and says where it came from.
  _Tests:_ `beatSpans` cumulative walk and degenerate cases; resolve for free vs
  fitted; anchoring by start time; first/last-beat fallbacks; no mutation; and
  the one that matters — the same Sticker resolves to a new length after its Beat
  is retrimmed.
  _Gate:_ ✅ vitest 274/274 + `tsc` + `yarn build`.

- [x] **Task 12 — Tint.** A **Tint** strength slider (0–100%) plus the same swatch
  row + `<input type="color">` the Title treatment uses, so the colour idiom
  matches. Picking a swatch turns the tint on if it was off.
  _Why not a hue slider:_ most sticker assets are monochrome icons — the bundled
  `camera.svg` is `#0D0D0D` — and rotating the hue of near-black does nothing.
  The tint lays a colour over the asset clipped to its own alpha via
  `source-atop`, so partial strength keeps some original colour and the alpha
  channel survives.
  _Sharpness:_ the tint rasterises at the DESTINATION size, not the asset's. A
  24×24 SVG tinted before scaling would bake in that resolution.
  _Parity:_ it lives in `drawSticker`, inside the shared renderer, so preview and
  export get it from the same code.
  _Tests:_ off by default; colour and strength pass through; strength clamps to
  0..1; empty or missing colour falls back to white.
  _Gate:_ ✅ vitest 278/278 + `tsc` + `yarn build`.

- [x] **Task 13 — Fix the stale preview memo key.** Picking a tint colour did
  nothing: `StickerOverlay` memoised its bitmap on a hand-listed set of fields in
  `FinalPreview`, and tint was added without updating that list, so the effect
  never re-fired and the untinted bitmap stayed on screen.
  _Fix:_ `stickerRenderKey()` now lives next to `drawSticker` and lists exactly
  what the renderer reads; the preview derives its key from it. A visual property
  added in future cannot leave the cache stale, because the key is in the same
  file as the code that consumes the property.
  _Tests:_ every renderer-read field changes the key (fileName, x, y, scale,
  rotation, opacity, tintColor, tintStrength); timing, blendMode and fitToBeat do
  not, since they do not change the bitmap; two stickers of the same asset differ.
  _Gate:_ ✅ vitest 282/282 + `tsc` + `yarn build`.

- [x] **Task 14 — Remove blend mode.** Task 10's blend mode is gone: the domain
  field, the Inspector selector, the preview's per-layer `mix-blend-mode`, the
  `blend` export path, `blendNeutralFill`, and the `hasRgbBlend` extension.
  Stickers composite through alpha with `overlay`, full stop. This also deletes
  the one piece of this feature that was never verified against a real export.
  _Recheck:_ the "who emits `[v]`" rule holds across all 135 remaining
  caption/title/overlay/sticker/rgb combinations.
  _Gate:_ ✅ vitest 282/282 + `tsc` + `yarn build`.

  _Note:_ removing the Inspector selector took two attempts. The first used index
  slicing whose `end` matched an earlier occurrence than `start`, which
  duplicated an 11 KB block instead of deleting one. Caught by `tsc`, repaired by
  verifying the region was periodic and dropping one copy. Exact-string
  replacement with a `count == 1` assertion after that.

- [x] **Task 15 — A pinned Sticker can be dragged between Beats.** Task 11 made a
  `fitToBeat` chip undraggable, which over-constrained it: once pinned there was
  no way to move it to another Beat, and a duplicate inherits `fitToBeat` so it
  landed stuck in the same Beat it was copied from.
  _Fix:_ pinned chips drag again and re-anchor to whichever Beat they land in —
  `startTimeSec` still decides the Beat, `resolveSticker` snaps the window. Only
  the trim handle stays hidden, since the length genuinely comes from the Beat.
  The drag bound moved into `maxStickerStart()`: a free Sticker is bounded by its
  own length, a pinned one only by the end of the Cut. Bounding a pinned Sticker
  by its stored duration was what pinned it inside its current Beat.
  _Tests:_ free vs pinned bounds; a pinned Sticker can reach a Beat past its
  stored length and resolves to that Beat's window; no negative bound on a
  degenerate cut.
  _Gate:_ ✅ vitest 286/286 + `tsc` + `yarn build`.

- [x] **Task 16 — Duplicating a beat-pinned Sticker.** Reported repro: fit a
  Sticker to its Beat, duplicate it, and the copy cannot be dragged to another
  Beat. Task 15 restored draggability but two faults remained.
  1. **The drag origin did not match what is drawn.** A pinned chip renders at
     its Beat's start while its stored `startTimeSec` sits somewhere inside that
     Beat, so the pixels dragged did not correspond to the distance needed to
     cross a boundary — a short drag could jump a Beat, a long one do nothing.
     `startStickerDrag` now takes its origin from the RESOLVED position.
  2. **A pinned duplicate landed in the same Beat.** The +0.5s offset rarely
     crosses a boundary, so the copy resolved to the same Beat and rendered
     exactly on top of the original — identical position and width. It looked
     like the duplicate had not appeared and that the chip would not move.
     `DUPLICATE_STICKER` now places a pinned copy at the start of the NEXT Beat,
     falling back to a nudge when there is no next Beat. A free Sticker keeps the
     +0.5s behaviour it shares with SFX.
  _Tests:_ pinned duplicate lands on the next Beat's start and stays pinned;
  stays inside the Cut when there is no next Beat; free duplicates still offset
  by 0.5s.
  _Gate:_ ✅ vitest 289/289 + `tsc` + `yarn build`.
