# Beat Rotation — Task Tracker

Per-Beat fine rotation, modelled on the existing punch-in zoom. Preview and
export must agree by construction, the same rule ADR-0008 set for text and
ADR-0010 for colour.

**Decisions:** ±15° at 0.1° steps — straightening and subtle canted angles, not
orientation fixes. **Auto-cover**: a rotated frame exposes triangular corners, so
the effective scale is `max(zoom, coverScale(θ))` and rotation punches in
slightly on its own (3.1% at 1°, 15.1% at 5°, 42.6% at 15° on 16:9 — the height constraint
dominates a wide frame, so the cost is ~2x a naive estimate; a square frame is
cheaper, 22.5% at 15°). Rotation is
static — no scope/animation, unlike zoom's "intro" mode.

**Verified before planning:** the `rotate` filter is compiled into
`public/ffmpeg-st/ffmpeg-core.wasm` (probed by description string, with
scale/crop/transpose as controls — an `^rotate$` string probe is unreliable
here, `^scale$` fails it too). Uniform scale commutes with rotation, so
`scale → rotate → crop` on the export matches CSS `scale(S) rotate(θ)`.

**Working rule:** one task at a time — implement → tests → validation gate → next.
`npx tsc --noEmit` clean at every gate. No commits (per session instruction).

---

- [x] **Task 0 — This doc.**
  _Gate:_ ✅ doc exists and the task list is agreed.

- [x] **Task 1 — Geometry core** (`src/studio/util.ts`). `rotationCoverScale(w,h,deg)`
  returns the minimum uniform scale that keeps a rotated w×h frame covering the
  w×h window. `beatFrameFilters(w,h,beat)` returns the export chain, splitting
  base from the intro-zoom branch so **rotation survives an expired intro zoom** —
  it goes in the base chain before `split=2`, and the branch carries only the
  zoom *relative* to the base so the composed magnification still lands on
  `max(zoom, cover)`.
  _Tests:_ cover is 1 at 0°, 16/9 at 90° on 16:9, symmetric in ±θ, monotonic
  0→45°; combined chain is scale→rotate→crop; intro split composes to the same
  total scale as the entire-scope chain; identity beat emits nothing; the angle is
  negated for ffmpeg, which rotates counter-clockwise where CSS goes clockwise.
  _Gate:_ ✅ vitest (25) + `tsc`.

- [x] **Task 2 — Preview transform.** `beatTransformStyle` replaces
  `beatZoomStyle`, taking frame dims and rotation and emitting
  `scale(S) rotate(θdeg)` with the existing zoom focus as `transformOrigin`.
  Applied at `StagePreview.tsx:246` and `FinalPreview.tsx:473`; rotation applies
  whether or not the zoom is currently active.
  _Tests:_ rotation-only beat still emits a transform; zoom-inactive beat keeps
  its rotation; identity returns `{}`; scale never drops below cover. Dead
  `beatZoomStyle` removed; `util.zoom.test.ts` migrated to the new API.
  _Gate:_ ✅ vitest + `tsc` + `yarn build`.

- [x] **Task 3 — Export wiring.** `export.ts` consumes `beatFrameFilters` for
  both the entire-scope chain and the intro split.
  _Tests:_ emitted chain contains `rotate=` for a rotated beat and omits it at 0°.
  _Gate:_ ✅ vitest + `tsc` + `yarn build`.

- [x] **Task 4 — Inspector slider.** ±15° / 0.1° row in the existing zoom
  collapsible, double-click to reset, with the live punch-in cost shown so the
  crop is not a surprise. Section renamed "Framing — Zoom & Rotation"; the badge
  and reset button now react to rotation as well as zoom.
  _Gate:_ ✅ `tsc` + `yarn build`.

- [x] **Task 5 — E2E gate.** Full `vitest run`, `tsc`, `yarn build`; manual pass
  noted as pending a `yarn dev` run.
  _Gate:_ ✅ `vitest run` 222/222 across 25 files, ✅ `tsc`, ✅ `yarn build`.
  ✅ Manual pass done — see the sign-bug entry below.

---

## Follow-up — separate zoom and rotation (2026-07-25)

Rotation was folded into the zoom's single `scale → rotate → crop`, sharing one
scale (`max(zoom, cover)`) and one pivot (the zoom focus). That coupling carried
a real defect: CSS rotates about `transform-origin`, which was set to the zoom
focus, while ffmpeg's `rotate` always rotates about the frame centre — so with an
off-centre focus the two disagreed on the pivot. Separating them fixes that and
makes each adjustment independently reasonable.

- [x] **Task 6 — Two independent stages.** Rotation gets its own
  `scale(cover) → rotate → crop` about the **centre**; zoom keeps its own
  `scale(zoom) → crop` about the **focus**. Applied rotation-first on both sides.
  Drops `beatFrameScale` and the `introScale / cover` relative-scale arithmetic —
  with rotation cropping back to w×h on its own, the intro branch is just the
  plain zoom chain.
  _Preview:_ two nested layers, rotation inner (applied first) and zoom outer.
  `beatTransformStyle` splits into `beatRotationStyle` + `beatZoomStyle`.
  _Tests:_ each chain independent and self-contained; rotation crop is centred
  regardless of zoom focus; zoom crop still tracks focus; intro branch carries
  zoom only; rotation-only and zoom-only beats each emit one chain.
  _UI:_ rotation moved out of the zoom collapsible into its own section with its
  own reset; the zoom header and reset no longer mention it.
  _Gate:_ ✅ vitest (226) + `tsc` + `yarn build`.

---

## Follow-up — the export tilted the wrong way (2026-07-25)

Reported as "no rotation in the export". It was rotating all along, **opposite to
the preview**, which on soft already-tilted footage reads as nothing happening
rather than as an inversion.

- [x] **Task 7 — Do not negate the angle.** `rotationChain` negated the angle for
  ffmpeg on the assumption that its `rotate` filter turns counter-clockwise for a
  positive value. It does not: both ffmpeg's `rotate` and CSS `rotate()` turn
  **clockwise**. The negation was the inversion.
  _Tests:_ the emitted radians match the slider unnegated, and a sign-parity case
  walks ±3° and ±12° asserting the ffmpeg radians and the CSS degrees agree in
  sign as well as magnitude — the assertion whose absence let this through.
  _Gate:_ ✅ vitest (227) + `tsc` + `yarn build`.

### How it was found, and what cost time

Frames were extracted from the exported `.mp4` with AVFoundation (no ffmpeg
available locally) and the tilt measured from an edge-orientation histogram.
Preview measured **+13.25°**, export **−15.50°** — opposite signs.

Three of my own mistakes stretched this out:

1. **`console.debug` for the first diagnostic.** Chrome hides it unless Verbose
   logging is on, so the line may never have been seen.
2. **Frame sampling every 2 s against a ~1.5 s beat.** It landed on t=17.0 and
   t=19.0 and stepped over the changed window at 17.5–18.5, reporting
   "pixel-identical" — nearly presented as evidence. Re-sampling at 0.5 s found
   it at once.
3. **Treating "the frames changed" as proof the feature worked.** A differential
   comparison against an older export showed ~13° of applied rotation and was
   read as confirmation. It proved motion, not correctness — the rotation was
   in the wrong direction.

The `rotate` filter was never at fault, and neither was the build: the core is
configured without `--disable-everything`, so every FFmpeg 5.1.4 filter is
present. Probing the wasm for filter names by string is unreliable — `^scale$`
finds nothing in a build that demonstrably scales.
