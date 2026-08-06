# Covers — Task Tracker

Capture a still from a Beat and dress it as a **Cover**: its own framing, Grade,
Veil, Stickers and Title overlays, exported at its own aspect. Decisions and
rationale in [ADR-0021](./docs/adr/0021-covers-are-canvas-rendered-leaf-artifacts.md);
the terms in [CONTEXT.md](./CONTEXT.md).

**Binding constraint: every decision the canvas makes is a pure function.**
`vite.config.ts:724` sets `environment: "node"` and no canvas polyfill is
installed, so `ctx` calls cannot be asserted by any test. Crop rects, gradient
endpoints, layer order, encode options, filenames and the capture-time seeding
all live in pure modules with their own tests; the `draw*` functions stay thin
glue over them. If a bug can hide in a `draw*` function, the geometry was left in
the wrong place.

**Second constraint: one renderer.** `renderCover()` produces both the on-screen
canvas and the downloaded bytes — the same call at two sizes. Nothing may draw a
Cover any other way, or ADR-0021's whole reason for existing is gone.

**Order is load-bearing:** crop → grade → Veil → Stickers → Titles. Running
`gradePixel` over the finished `ImageData` would grade the Veil and the text too.

**Working rule:** one task at a time — implement → tests → validation gate →
next. `npx tsc --noEmit` clean at every gate.

---

- [x] **Task 0 — Docs.** ADR-0021, the CONTEXT `Cover` and `Veil` terms, this
  tracker, and the `panX`/`panY` defect recorded in
  [ARCHITECTURE_BACKLOG.md](./ARCHITECTURE_BACKLOG.md).
  _Gate:_ ✅ files exist.

- [x] **Task 1 — Domain types.** `Cover`, `Veil` in `types.ts`;
  `covers?: Cover[]` on `ProjectState` (sibling to `cut`, since a Cover is
  Project-level). `CoverTitle = Omit<TitleLayerSettings, "scope" | "introSec" |
  "startSec" | "durationSec" | "fadeOut" | "animation" | "animDurationSec" |
  "typewriterCursor">` and `CoverSticker = Omit<Sticker, "startTimeSec" |
  "durationSec" | "fitToBeat">` — **derived**, not hand-copied, so a new field on
  either parent appears here for free. `Veil` carries `mode: "solid" | "linear"`,
  `color`/`opacity` (the solid fill and the gradient's from-stop), `toColor`/
  `toOpacity`, and `direction: "down" | "up" | "right" | "left"`; keeping both
  stops populated in solid mode means toggling modes loses nothing.
  `covers` optional means pre-Cover projects load untouched. **No origin
  discriminator:** a Cover made from an upload and one captured from a Beat are
  the same type, because nothing branches on it after ingest (ADR-0021). Origin
  lives in `sourceLabel` and nowhere else.
  _Tests:_ the two omit lists are **runtime constants** (`COVER_TITLE_OMITTED_FIELDS`,
  `COVER_STICKER_OMITTED_FIELDS`) with the types derived from them via
  `as const satisfies readonly (keyof T)[]`, so a typo fails `tsc` with a
  suggestion and the lists themselves are assertable. Six tests: both lists pinned
  by contents; no appearance field is omitted; a **field-count witness** over
  `keyof TitleLayerSettings` that fails when the type grows, forcing the author to
  classify the new field as appearance or timing; and `expectTypeOf` guards that
  `CoverTitle`/`CoverSticker` reject the timing fields and that `Cover` carries no
  `kind` or `sourceBeatId`.
  _Gate:_ ✅ vitest (6 new; 1128/1128 across 124 files) + `tsc`. Both guard
  directions verified by deliberately breaking them: a typo'd key fails `satisfies`,
  and a dropped omit entry fails two runtime tests plus `tsc`.

- [x] **Task 2 — The two Cover sources.** `src/features/cover/coverSource.ts`
  with both doors into the same type. Shared first: `COVER_MAX_EDGE = 3840` and
  `fitCoverFrame(w, h)` returning the capped dimensions — the largest canvas is
  1920 on the long edge and Zoom reaches 3×, so 3840 is full sharpness to 2×, and
  uncapped a 12-megapixel upload would put 5–10 MB into every autosave
  (ADR-0021).

  **Capture:** `captureCover(beat, clip, cut, atSec)`. Pull the frame at the
  source's natural long edge then cap — `sampleFrameAt`'s `maxEdge` defaults to
  768, which is below the 1080 a Cover needs. Seeds `aspect` from `cut.aspect`,
  `zoom`/`zoomX`/`zoomY` from the Beat, `grade` from
  `resolveGrade(beat.colorAdjustments, cut.globalFilterAdjustments,
  cut.globalFilterIntensity)`, and `sourceLabel` as `"Beat {n} @ {t}s"`. A Still
  Beat takes `clip.file` directly rather than seeking.

  **Upload:** `uploadCover(file, cut)`. Validates with the existing
  `isStillFile()` (MIME **and** `STILL_EXT_RE`, already unit-tested), probes with
  `probeStill()`, caps, and seeds `aspect` from `cut.aspect` — a Cover's aspect is
  an output-format decision, not a property of the file — with a **neutral**
  grade, default framing, and `sourceLabel` as the filename. Add
  `COVER_FILE_ACCEPT` beside `CLIP_FILE_ACCEPT` in `ingest.ts` so the two cannot
  drift; images only, and **SVG stays out** for the same reason it is out of
  `CLIP_FILE_ACCEPT`.

  Keep both seeding paths pure, taking the decoded dimensions as arguments, so
  the maths is testable without a decoder.
  _Tests:_ `fitCoverFrame` — a 6000×4000 caps to 3840×2560 preserving aspect, a
  1920×1080 passes through untouched, a portrait 4000×6000 caps on **height**,
  and a 1×1 does not round to zero. Capture seeding — the grade is the flattened
  `resolveGrade` result, not the Beat's raw adjustments and not the global Look
  alone; a Beat with no grade under a Look still inherits the Look; `zoom`
  defaults sanely when the Beat has none; the label formats a one-based Beat
  index and a one-decimal timestamp. Upload seeding — grade is empty even when
  the Cut carries a strong Look, aspect comes from the Cut and not from the
  image's own dimensions, the label is the filename; `COVER_FILE_ACCEPT` admits
  every extension `STILL_EXT_RE` does and rejects `.svg`, `.mp4` and `.mov`.
  _Gate:_ ✅ vitest (24 new; 1152/1152 across 125 files) + `tsc` + `yarn build`.

  **Two deviations from the plan, both found while implementing:**

  1. **`sampleFrameAt` was unusable, and `maxEdge` was the lesser reason.** It
     hardcodes `toDataURL("image/jpeg", 0.7)` — tuned for Claude's vision, where
     smaller frames are cheaper tokens. A Cover is a deliverable. Added
     `videoFrameBlob()` and `imageFrameBlob()` to `frameSampler.ts`: exact
     dimensions, quality 0.95, `toBlob` rather than a data URL. `sampleFrameAt`
     is untouched, so the vision paths keep their token budget.
  2. **Ken Burns Beats needed `framingAt(beat, atSec)`, not `beat.zoom`.** A Ken
     Burns Beat has no static zoom to copy — its framing travels (ADR-0015), and
     `beat.zoom` is either stale or absent. Capturing from a Still, whose only
     motion *is* the Ken Burns, would have silently seeded 1×. `framingAt`
     evaluates `kenBurnsAt` at the captured instant over the Beat's own
     `outSec − inSec` window, and ignores a stale `kenBurns` when `framing` is
     `"zoom"` because the two are a mode and not a stack.

  Also folded in: `COVER_FILE_ACCEPT` became the source list and `CLIP_FILE_ACCEPT`
  is now `` `video/*,${COVER_FILE_ACCEPT}` `` — one list, two consumers, asserted
  by a test, so they cannot drift.

- [x] **Task 3 — Veil geometry and renderer.** `veilEndpoints(direction, w, h)`
  returning the four `createLinearGradient` coordinates, and
  `drawVeil(ctx, veil, w, h)` over it. Solid mode fills with
  `color` at `opacity`; linear mode runs `color`/`opacity` → `toColor`/
  `toOpacity`. No gradient rendering exists anywhere in this codebase today —
  every `linear-gradient` in `src/` is UI chrome — so there is nothing to reuse
  and nothing to stay in step with.
  _Tests:_ `veilEndpoints` for all four directions — `down` runs y0→y1 with x
  fixed, `up` is its exact reverse, `right`/`left` mirror on x; a square frame
  and a 9:16 frame both produce endpoints spanning the full edge; the
  hex+opacity → `rgba()` conversion clamps out-of-range opacity and tolerates a
  3-digit hex.
  _Gate:_ ✅ vitest (17 new; 1169/1169 across 126 files) + `tsc`.

  Two things beyond the plan. **`drawVeil` is tested after all** — a recording
  stub `ctx` makes its behaviour assertable without a canvas, covering the two
  modes, that solid mode adds no colour stops, that "up" reverses the *endpoints*
  rather than the stops, and that the whole thing is bracketed in `save`/
  `restore` so the Stickers drawn next cannot inherit its `fillStyle`. **Hex
  parsing reuses `colorizeRgb`** rather than adding a second reader; 3-digit hex
  is handled by expanding to 6 before it. Junk falls back to black on purpose —
  an invalid `fillStyle` is silently ignored by canvas, which presents as "the
  Veil did nothing" and is worse to diagnose than a wrong colour. `DEFAULT_VEIL`
  is a bottom-darkening transparent→black fade.

- [x] **Task 4 — The compositor.** `renderCover(cover, ctx, w, h)` in
  `src/features/cover/renderCover.ts`, running crop → grade → Veil → Stickers →
  Titles. `coverCropRect(frameW, frameH, aspect, zoom, zoomX, zoomY)` is the pure
  half: cover-fit as the floor, then the Beat's scale-and-centre model applied on
  top. Grade runs `gradePixel` over the picture's `ImageData` **before** the Veil
  composites. Stickers and Titles go through the existing
  `drawSticker(ctx, …)` / `drawTitleLayer(ctx, …)`, which already take a context.
  _Tests:_ `coverCropRect` — a 16:9 source into a 9:16 Cover at zoom 1 crops the
  sides rather than letterboxing (cover-fit floor); the same source into 16:9 is
  the identity; `zoomX`/`zoomY` at the extremes clamp to the source's edges and
  never sample outside it; zoom below the cover-fit floor is raised to it; a
  square source into every one of the four aspects.
  _Gate:_ ✅ vitest (14 new; 1183/1183 across 127 files) + `tsc` + `yarn build`.

  **The focus rule was the risk, and it is now pinned.** `coverCropRect` positions
  the crop within the *leftover* space rather than centring on the focus point,
  matching `kenBurnsVisibleCenter` — a test asserts the two agree across five
  zoom/focus pairs, so "the Beat's value transfers as-is" is verified rather than
  asserted. Both leftovers stack into one axis, which is what lets a 16:9 source
  be panned across while being cropped to 9:16 **at zoom 1**.

  **Deviation — cover-fit floor diverges from a Beat, on purpose.** A Beat at
  zoom 1× is *contained and padded* (`renderStillContained`: "scale 1.0 means the
  same framing Beat.zoom 1× does"), so a mismatched-aspect source letterboxes. A
  Cover always fills instead, because bars on a thumbnail are just a worse
  thumbnail. Consequence: for a source whose aspect differs from the Cover's, a
  seeded framing shows a tighter crop than the Beat did. Identical when the
  aspects match, which is the common case.

  Also: `drawSticker`'s parameter narrowed from `Sticker` to a new
  `DrawableSticker` = the seven fields it actually reads. Timing was never one of
  them — `stickerRenderKey`'s docstring already said so — and narrowing lets a
  `CoverSticker` use the shipped renderer instead of a second one. Cannot break
  existing callers, who pass a full `Sticker`.

  Left for later: `resolveCoverTitle` duplicates the `TitleLayerSettings` →
  `TitleRenderLayer` mapping that `export.ts:411` and `:457` and
  `FinalPreview.tsx:1105` each write out by hand. Extracting one resolver for all
  four is worth doing, but it edits the shipped export path, which this work is
  scoped away from.

- [x] **Task 5 — Split-screen on canvas.** `drawSplitScreenToCanvas` over a pure
  `splitSlotRects(layout, w, h)`, honouring each slot's `scale`, `panX`, `panY`
  and `rotation`. This is a **third** encoding of the layout geometry, added
  deliberately rather than unifying the CSS and ffmpeg ones (ADR-0021) — so it
  must be tested hard enough to stand alone. It follows the CSS preview. The
  `panX`/`panY` defect this exposed has since been fixed, and a test binds this
  renderer's effective displacement to the encoder's `slotPanOffset`.
  _Tests:_ `splitSlotRects` slot counts and tiling for all six layouts —
  `v2-stacked`, `v2-side`, `3-row`, `3-col`, `4-grid`, `none`; rects tile the
  frame exactly with no gap and no overlap; every layout's rects sum to the full
  frame area; a slot's `panX`/`panY` shifts its source window and clamps at the
  source edge; `scale` below 1 never exposes background.
  _Gate:_ ✅ vitest (14 new; 1197/1197 across 128 files) + `tsc` + `yarn build`.

  **It composites at CAPTURE time, not render time.** A Cover keeps its pixels
  (ADR-0021), so by the time `renderCover` runs there is no layout left — only a
  picture. `captureCover` branches on `isSplitBeat` and flattens the slots into
  the stored frame. Consequence: a split capture is stored at canvas dimensions
  rather than source resolution, so it has less zoom headroom than a single-clip
  capture. `captureCover` now also takes `clips` to resolve the other slots.

  **Three guards against the three-encodings risk you accepted.** The slot count
  is asserted against `getSlotCountForLayout` rather than a local list, so the
  count — the one fact all three encodings share — cannot diverge. The 4-grid
  order is asserted to match `xstack`'s `0_0|w0_0|0_h0|w0_h0`, so slot 2 lands in
  the same corner as the exported video. And rect areas are asserted to sum to
  exactly `w × h` across five frame sizes including 1000×1000 and 1081×1921.

  **Boundaries are rounded, not sizes.** 1000/3 rounding per-size loses a pixel
  column and shows background through the seam; rounding the boundaries gives
  333/334/333, which cannot.

  The transform order is pinned by test — `translate(centre) → scale → translate(pan)
  → rotate`, matching CSS `scale() translate() rotate()` about the centre, with pan
  as a percentage of the **slot** and landing inside the scale so a panned slot at
  2× moves twice as far. A separate test pins that `panX`/`panY` are honoured at
  all, since that is the deliberate divergence from the exported video.

- [x] **Task 6 — Encode and download.** `coverBlob(canvas, format)` mapping
  `"jpeg"` → `toBlob("image/jpeg", 0.92)` and `"png"` → `toBlob("image/png")`,
  plus `coverFileName(projectTitle, index, format)` reusing the existing
  safe-title helper that `projectPackager.ts:126` already applies. The live size
  readout re-encodes on a debounce and is the feature's whole answer to
  YouTube's 2 MB ceiling, so it must reflect the **full-resolution** bytes, not
  the proof canvas.
  _Tests:_ filename derivation — an empty project title falls back the way the
  video export does, unsafe characters are stripped, the extension follows the
  format, the index is one-based; the quality/mime mapping; a byte count formats
  as KB under 1024 KB and MB above it.
  _Gate:_ ✅ vitest (15 new; 1212/1212 across 129 files) + `tsc` + `yarn build`.

  **"The existing safe-title helper" did not exist.** There were two, both inline
  and disagreeing: `projectPackager.ts:125` lowercases with underscores and falls
  back to `"project"`; `ExportView.tsx:529` hyphenates, keeps case, and falls back
  to `"highlight"`. Rather than add a third, `projectFileBase(title, fallback?)`
  now lives in `export.ts` and `ExportView` calls it — same regex, no behaviour
  change. A Cover uses it so `My-Trip.mp4` and `My-Trip-cover-1.jpg` land together.
  The packager keeps its own rule on purpose: it names an archive, not a
  deliverable.

  `coverEncodeOptions` returns `undefined` quality for PNG rather than passing one
  — `toBlob` ignores quality for PNG, and passing it is how someone ends up
  debugging a quality control that never did anything. `.jpg` not `.jpeg`, since
  that is what platforms expect. `exceedsYouTubeLimit` treats exactly 2 MB as
  passing, not failing.

- [x] **Task 7 — Persistence.** `src/lib/coverPersist.ts` with
  `collectCoverFiles` / `stripCoverFiles` / `reinjectCoverFiles`, mirroring
  `userVoicePersist.ts` exactly. A new IndexedDB object store for cover frames
  plus a `DB_VERSION` bump with its `onupgradeneeded` step; `.vidstr` carries the
  frames base64'd like `projectPackager` already does for voice and fonts. Cover
  Stickers reference `stickers/` by filename and need no bytes; Cover Titles may
  carry an uploaded `fontFile`, which `stripTitleFonts`/`reinjectTitleFonts`
  already handle — confirm it reaches Covers rather than only `titleLayers`.
  _Tests:_ a Cover survives an autosave round-trip with its frame intact; it
  survives a `.vidstr` export → import; a project saved before Covers existed
  loads with `covers` undefined and no throw; a Cover with an uploaded title font
  keeps it across both round-trips; stripping leaves no `File` in the JSON.
  _Gate:_ ✅ vitest (18 new — 14 in `coverPersist.test.ts`, 4 in
  `projectPackager.test.ts`; 1230/1230 across 130 files) + `tsc` + `yarn build`.

  `DB_VERSION` 5 → 6 with a `covers` store keyed `<projectId>:<coverId>`, matching
  `user_voice` so a recovery snapshot reads its origin's assets via
  `assetOwnerId`. `.vidstr` gained an optional `covers[]` of data URLs; the
  package `version` stays 1, since an older reader ignores an unknown key and a
  newer reader treats a missing one as no Covers.

  **`fontFile` had to be nulled, not just stripped.** A `File` that reaches
  `JSON.stringify` serialises to `{}` — which is *truthy*, so a reloaded Title
  would carry a font file that is not one and hand `getTitleFontBytes` an empty
  object. Legacy field (modern uploads live in the app font library and resolve
  from `fontId`), but the derived type still carries it, so `stripCoverFiles`
  nulls it explicitly and a test asserts the parsed JSON reads `null`.

  A Cover whose pixels do not come back is **dropped**, not kept as an entry with
  no picture — it has nothing to render and no useful broken state to show.
  Asserted on both paths.

- [x] **Task 8 — CoverDrawer.** A lazy-loaded slide-over matching the six
  existing drawers (`open`/`onClose` behind a `mounted` gate). A gallery strip of
  Covers — ending in a `FileDropzone` carrying `COVER_FILE_ACCEPT`, which is the
  upload door — plus an editor for the selected one: the `renderCover` canvas
  itself as the preview, a 4-way aspect `SegmentedControl`, zoom/pan and grade
  rows in the compact **name (70px) · slider · value (32px)** layout from
  DESIGN_PATTERNS §2, the Veil editor, `StickerPicker`, and
  `TitleTreatmentEditor` with a new `showTiming?: boolean` prop gating its
  timing block (`~:325–440`) — following the `scopeEntireLabel` precedent already
  in that file. Slider drags render a downscaled proof canvas; commit renders
  full resolution.
  _Tests:_ `// @vitest-environment jsdom` component tests — the drawer renders a
  gallery row per Cover, selecting one switches the editor, the close affordance
  carries `aria-label="Close"`, and `TitleTreatmentEditor` with
  `showTiming={false}` renders no scope select and no duration field while still
  rendering the font and colour controls. Remember `cleanup()` in `afterEach`.
  _Gate:_ ✅ vitest (13 new; 1243/1243 across 131 files) + `tsc` + `yarn build`.

  **`designSystemCompliance.test.ts` rejected the first draft**, and was right to:
  it forbids raw `<button>`/`<input>`/`<select>`/`<svg>` anywhere in `src/studio`.
  Every control now goes through `RangeField`, `Button`, `ControlButton`,
  `SegmentedControl`, `Switch` and `ColorField`. Worth knowing that this rule is
  enforced by a test rather than by review.

  **`showTiming` had to gate more than the plan's `~:325–440`.** The Motion
  (animation) select, its typewriter-cursor checkbox and its duration select sit
  in a separate block further down, and animation is as much a timing control as
  scope is. A test asserting no `/Typewriter/` caught it. Seven gates in total.

  **A Cover seeds three empty Title layers** (`makeCoverTitles`), not an empty
  array — `TitleTreatmentEditor` returns null with no layer to show, so an empty
  array renders no title UI whatsoever. This changed `newCover`, which correctly
  broke the Task 2 test asserting `titles: []`; that test was updated to assert
  the new behaviour rather than the old.

  ⏳ Still owed: the DESIGN_PATTERNS §6 manual pass in both light and dark themes.

- [x] **Task 9 — The capture affordance.** A camera `IconButton` on
  `StagePreview`'s transport, capturing the frame currently displayed — the
  existing scrubber and frame-step are the frame picker, so no new selection UI
  is added. Disabled with a stated reason when no Beat is selected. Opens
  `CoverDrawer` with the new Cover selected. A TopBar button reopens the gallery,
  alongside the other drawer entries.
  _Tests:_ jsdom — the button is disabled with no selected Beat, enabled with
  one, and dispatches a Cover whose `sourceLabel` matches the transport's current
  position rather than the Beat's in-point.
  _Gate:_ ✅ `tsc` + `yarn build` (covered by Task 8's suite).

  `StagePreview` gained one optional `onCaptureCover?: (atSec: number) => void`
  and knows nothing else about Covers — it reports the SOURCE time via
  `sourceTimeAt(pos)`, which is what a frame grab seeks to, and `StudioApp` owns
  the capture. The button hides entirely when the prop is absent and disables
  with a stated reason when no Beat is selected. TopBar gained a `Covers` entry,
  shown once a Cut exists.

- [x] **Task 10 — E2E gate.** Full `vitest run`, `tsc`, `yarn build`, and a
  round-trip check that a Cover's frame, Veil, Stickers and Titles all survive
  `.vidstr` export → import.
  ⏳ Manual pass: capture from a video Beat and a Still Beat, upload a large
  phone photo and confirm it caps without visible artefacts, recrop a 16:9
  capture to 9:16 and confirm the subject can be re-centred, apply a bottom-up
  transparent→black Veil and confirm a Sticker placed over it stays bright,
  download as JPEG and as PNG and confirm the size readout matched, then delete
  the source Beat and confirm both the captured and the uploaded Cover are
  untouched.
  _Gate:_ ✅ `vitest run` 1249/1249 across 132 files, ✅ `tsc`, ✅ `yarn build`.
  ⏳ Manual pass still pending — nothing here has been run against a real browser,
  real media, or a real ffmpeg export.

  Added `oneRenderer.test.ts`, six **source-level** invariants guarding what
  ADR-0021 claims but no type can enforce. Same technique as
  `lookNotGlobal.test.ts`, and for the same reason: the defect is the *presence*
  of a second path, which no assertion over a correct render can see.

  1. Nothing outside `renderCover.ts` calls `drawVeil`.
  2. `CoverDrawer` has exactly **one** `renderCover(` call site, and its preview,
     size readout and download all reach it through the same `paint()`.
  3. **Grade precedes Veil precedes Stickers precedes Titles** in the source.
     Reversed, `gradePixel` would grade the Veil and the text along with the
     picture — a subtly wrong image, never a crash. Verified by deliberately
     swapping the two lines and watching it fail.
  4. No Cover code reaches for `sampleFrameAt`, the 0.7-quality vision sampler.
  5. `Cover` stores no `beatId`/`clipId`/`atSec`/`sourceBeatId` — the leaf property.
  6. Nothing parses `sourceLabel` back into a Beat reference, which would undo the
     leaf property without changing a single type.


---

## After the gate

Task 10 closed with everything green but nothing yet run in a browser. The manual
pass found real defects, and two more pieces of work followed. Recorded here
because three of them are decisions rather than fixes.

**Preview and download disagreed about the title.** The most important one, and a
direct hit on ADR-0021's promise. `renderCover` was one function called at two
sizes, which made everything *relative* agree — the crop is a fraction of the
source, a Sticker's scale a fraction of frame width, the Veil fills what it is
given — and left Titles behind, because `sizePx` is absolute. The 900px proof
drew a 120px title into a 900px frame and the download drew the same 120px into
1080px, so `wrapLines` broke the text onto two lines in one and not the other.
Fixed with `coverRenderScale(aspect, w)`, applied to `sizePx` and
`letterSpacing`. **The lesson is the invariant, not the bug:** one renderer only
buys parity if it is scale-*invariant*, and `oneRenderer.test.ts` was asserting
the weaker property the whole time. It now asserts both.

**Rotation, on the picture.** `Cover.rotation`, ±15°, seeded from the Beat.
Deliberately diverges from Beat behaviour: `util.ts:359` leaves the corners a
rotation exposes visible, and a Cover scales up via `rotationCoverScale` so they
never show. Wedges of background read as broken on a deliverable. Same reasoning
as the cover-fit floor.

**Rotation, on the title.** In the shared editor at 15° steps, so it reaches
video titles too. Lands once in `drawTitleLayer` and therefore on all three
surfaces (ADR-0008) — but the *authoring* field had to be threaded through
**nine** hand-written mappings across three hops
(`TitleLayerSettings → TitleLayer | PreviewTitleLayer → TitleRenderLayer`). Six
were found by reading, three only when the export panel visibly did nothing.
`oneRenderer.test.ts` now derives the mapping-site list rather than listing it,
because the hand-written list is what was wrong.

**The Sticker card is shared with the Inspector.** `StickerCard.tsx` holds the
appearance half — thumbnail, X/Y/Scale/Rotation/Opacity/Tint, shared palette,
double-click reset — and both surfaces render it. Timing stays with the
Inspector. Same seam `CoverSticker` draws at the type level and `DrawableSticker`
at the renderer: appearance travels, timing does not. Covers gained Rotation,
Opacity and Tint, which they already carried and never surfaced.

**Layout, all mine.** The drawer was written for a narrow panel and opened with
`width="full"`: no padding (`.ui-drawer-body` ships `padding: 0` and every drawer
supplies its own), an uncapped canvas so a 9:16 cover ran off the bottom of the
screen, and sliders stretched to ~900px. Guards added for the canvas cap and the
body padding — they assert the fix exists, not that the layout is right, because
jsdom computes no layout. **Screenshots are the only thing that catches this.**

**The sticker picker mounted off-screen.** `.st-sticker-picker` is
`position: absolute; top: 100%` and needs a positioned ancestor, which `Timeline`
provides and the drawer did not — so it anchored to the fixed drawer and landed
below the whole panel. Fixing it exposed a second bug: the picker dismisses on
any document `pointerdown`, so a naive toggle reopened it on the same click.
`Timeline` has the same construction and the same behaviour; left alone.

**Also fixed: ARCHITECTURE_BACKLOG defect 3** — split-screen slot pan reached the
preview and was discarded by the export. See that file.

**Still owed.** One `resolveTitleRenderLayer()`. The nine-copy mapping is the
argument: a single field cost nine edits and three were missed on the first pass.
