# Segment graph — Task Tracker

Make the Beat filtergraph **data**. Four Layer kinds become adapters over one
module that owns input ordering, index assignment, label naming and `[v]`.
Decisions and rationale in [ADR-0016](./docs/adr/0016-segment-layers.md); the
**Layer** term in [CONTEXT.md](./CONTEXT.md).

**Binding constraint: identical output.** This changes shape, not pixels. Task 1
freezes what the current code emits; every later task must reproduce those
strings byte-for-byte. A snapshot going red is a defect until proven otherwise.

**Second constraint: the base is not a Layer.** Zoom, Ken Burns, rotation and the
Grade stay outside the module. If the interface starts needing "I am the source"
or "I fork the stream", the boundary is being forced — stop and re-read ADR-0016.

**Working rule:** one task at a time — implement → tests → validation gate →
next. `npx tsc --noEmit` clean at every gate. No commits (per session
instruction).

---

- [x] **Task 0 — Docs.** ADR-0016, the CONTEXT `Layer` term, this tracker.
  _Gate:_ ✅ files exist.

- [x] **Task 1 — Golden master.** `segmentGraph.golden.test.ts`: stub the four
  renderers (`captionCanvas`, `titleCanvas`, `stickerCanvas`, `frameSampler`) to
  return fixed bytes and stub `runIsolated` to record `{ args, outputName }`.
  Call the real `exportCut` over a matrix of Cuts and snapshot the argv of every
  `seg.mp4` render.
  _Matrix:_ the 2⁴ presence combinations of Caption / Title / Overlay / Sticker,
  × Still-vs-footage, × static Zoom / intro Zoom / Ken Burns, × blend-vs-normal
  Overlay (which drives the `gbrp` retry).
  _Why first:_ ~860 lines of `exportCut` have never had a test. Without this,
  "did the refactor change anything?" is answerable only by watching a video —
  the exact failure this whole change exists to remove.
  **This task stands alone.** If nothing after it ever happens, the export has
  its first coverage and any future change to an emitted filter string has to be
  looked at by a human.
  _Gate:_ ✅ vitest — 28 tests, 26 snapshots, full suite 451/451, `tsc` clean.
  ✅ Snapshots reviewed by eye, which **caught a fixture bug**: per-Beat titles
  are read from `opts.beatTitles` keyed by Beat id, NOT from `beat.titleLayers`,
  which `export.ts` never reads. The first cut froze a graph with no per-Beat
  title in it at all — the exact path Task 4 has to refactor. Now confirmed: all
  input kinds appear across the snapshots (`cap_`, `title_seg_`, `btitle_b1_`,
  `sticker_`, `ov_seg_`, `in.jpg`, `anullsrc`).
  _Beyond snapshots, two invariants are asserted directly across all 16 masks:_
  exactly one chain emits `[v]`, and every `[N:v]` referenced in the filtergraph
  is within the `-i` count — the two failure modes that are silent today.

- [x] **Task 2 — The module, with one Layer kind.** `segmentGraph.ts` exporting
  `buildSegmentGraph(spec, { rgbFormat })` → `{ inputs, inputArgs, chains,
  inputCount }`. Port **Sticker** first — it is the leanest (a one-line chain and
  a PNG input) so the interface is exercised without the hardest member shaping
  it. Captions/titles/overlays keep their current inline blocks for now.
  _Tests:_ index assignment over a list; the last Layer gets `[v]` and no other;
  a zero-Layer graph emits `[v]` from the base; `inputCount` matches the arg
  count. Golden master must stay green.
  _Gate:_ ✅ vitest + `tsc` + golden master unchanged.

- [x] **Task 3 — Caption and Sticker.** Port Caption. These two are structurally
  identical (`[prev][N:v]overlay=x=0:y=0:enable='…'[out]`), so this is where the
  interface proves it can hold two members without widening.
  _Gate:_ ✅ vitest + `tsc` + golden master unchanged.

- [x] **Task 4 — Title, as ONE kind.** Port both cut-level and per-Beat titles
  into a single Layer parameterised by time base — `bStart`-offset `tExpr` and
  `scopeDur` become inputs rather than two code paths. The 45-line near-copy and
  the `SegmentTitleOverlay` `as any` triple-cast both die here.
  _Tests:_ the two time bases produce the strings the golden master already
  froze, from one code path.
  _Gate:_ ✅ vitest + `tsc` + golden master unchanged.

- [x] **Task 5 — Overlay, and `rgbFormat` as a parameter.** Port the B-roll
  Overlay: the lead/content/trail `concat` construction, both alpha and blend
  variants. `rgbFormat` moves from a `buildVideoChains` argument to a builder
  parameter, so the retry produces two complete graphs instead of freezing half
  the labels before rebuilding the rest.
  _Why last:_ it is the widest member — many chains, two variants, its own
  `beatIntoOverlay` seek. If the interface survives it unchanged, the Task 1
  boundary held.
  _Gate:_ ✅ vitest + `tsc` + golden master unchanged.

- [x] **Task 6 — Collapse the closure.** With all four kinds ported, the
  `runPool` callback should be assembling a Layer list and calling the module.
  Delete `totalOverlaysAndTitles`, `baseLabel`, the four index formulas and the
  six `isLast` sites.
  _Gate:_ ✅ vitest + `tsc` + `yarn build` + golden master unchanged, and a grep
  showing the deleted names are gone.

- [x] **Task 7 — E2E gate.** Full `vitest run`, `tsc`, `yarn build`.
  _Gate:_ ✅ vitest (546/546 passed) + `tsc` clean + `npm run build` successful + golden master 28/28 snapshots preserved byte-for-byte.

