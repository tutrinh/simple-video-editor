# Color Grade Parity — Task Tracker

Close the preview/export color seam by giving the grade **one generator** that
drives both sides, and make a **Look a target rather than an offset**. Decisions
and rejected alternatives live in [ADR-0010](./docs/adr/0010-color-grade-one-generator.md);
vocabulary (**Look**, **Grade**) in [CONTEXT.md](./CONTEXT.md). Designed via grilling.

**Decisions:** one TS module owns the grade math; preview applies it as an SVG
`feComponentTransfer` + `feColorMatrix` data-URI (no WebGL, no `<video>` → canvas
rewrite); export bakes the identical composition to a `.cube` consumed by ffmpeg
`lut3d`, replacing the `eq`/`hue`/`colorbalance` chain; applying a Look to the
Beats clears the global fine-tune and Undo restores both; composed values clamp
to ±100.

**Verified before planning:** `lut3d` and `haldclut` are compiled into
`public/ffmpeg-st/ffmpeg-core.wasm`; `curves` is not. `runIsolated` writes
`EngineInput[]` to the in-memory FS and `args` references them by name, so the
`.cube` rides in as an input with no `-i`.

**Working rule:** one task at a time — implement → tests → validation gate → next.
`npx tsc --noEmit` clean at every gate. No commits (per session instruction).

---

- [x] **Task 0 — This doc.** Task breakdown with per-task tests and gates.
  _Gate:_ ✅ doc exists and the task list is agreed.

- [x] **Task 1 — Grade math core** (`src/lib/grade.ts`). The single source of
  truth. `resolveGrade(beatAdj, globalAdj, intensity)` → summed and **clamped to
  ±100**. The transform as two composable steps: `curveStep` (exposure
  multiplicative, contrast pivoted at 0.5, split-tone weighted by tonal position)
  and `matrixStep` (saturation, hue, white balance as one 4×5 matrix).
  `gradePixel(adj, rgb)` composes them and is the reference every emitter derives
  from.
  _Tests:_ `grade.test.ts` — identity at all-zero; clamping past ±100; exposure is
  multiplicative (black stays black, unlike the old additive export); contrast
  pivots at 0.5; split-tone moves shadows more than highlights and vice versa;
  warmth pushes R up / B down.
  _Gate:_ ✅ vitest (23) + `tsc`.

- [x] **Task 2 — Preview emitter** (`gradeSvgFilter`). One data-URI SVG filter
  carrying `<feComponentTransfer>` (three `type="table"` channel curves sampled
  from `curveStep`) followed by `<feColorMatrix>` from `matrixStep`. Returns
  `"none"` for an identity grade.
  _Tests:_ identity → `"none"`; table has the expected sample count; split-tone
  produces a **non-linear** table (this is the regression the old 0.4× fold could
  not express); matrix values track saturation and hue. Also pins
  `color-interpolation-filters="sRGB"` — SVG filters default to linearRGB, which
  would diverge from the `.cube` bake.
  _Gate:_ ✅ vitest (9) + `tsc`.

- [x] **Task 3 — Export emitter + drift guard** (`gradeCube`). `.cube` text —
  `LUT_3D_SIZE n` plus n³ triples straight from `gradePixel`.
  _Tests:_ header and row count match the declared size; identity grade yields the
  identity lattice; values stay in `[0,1]`. **Parity test:** for a spread of
  sample colors, evaluating the SVG path (table lookup + matrix) agrees with
  `gradePixel` within tolerance — the guard ADR-0010's Consequences section calls
  for. Covers 7 Grades × 8 sample colours, including a teal/amber film look.
  Lattice is 33³ (`CUBE_SIZE`); tolerance is one table interpolation interval.
  _Gate:_ ✅ vitest (13) + `tsc`.

- [x] **Task 4 — Wire the preview.** `cssFilterFor` in `src/studio/util.ts`
  delegates to `resolveGrade` + `gradeSvgFilter`; signature unchanged so
  `StagePreview.tsx:246`, `FinalPreview.tsx:485` and `Inspector.tsx:737` are
  untouched. Delete `wbMatrixFilter` and the 0.4× split-tone fold.
  _Tests:_ rewrite `colorFilters.test.ts` — the "folds split-tone (directional
  hint)" case becomes an assertion that split-tone is **tone-targeted**, not
  folded into global WB. Adds `gradeFor()` as the shared resolve step.
  _Gate:_ ✅ vitest (14, shared with Task 5) + `tsc` + `yarn build`.

- [x] **Task 5 — Wire the export.** Replace `ffmpegColorFilters` with a LUT path:
  emit the `.cube` as an `EngineInput` on the segment render and put
  `lut3d=<name>` in the `-vf` chain at `export.ts:378`. Remove the
  `eq`/`hue`/`colorbalance` builder.
  _Tests:_ the filter string is `lut3d` and no longer contains `eq=`/`colorbalance=`;
  an identity grade emits no filter and no input at all. `ffmpegColorFilters` is
  replaced by `ffmpegColorLut`, which returns the `EngineInput` and the `-vf`
  entry together so they can never be added apart.
  _Gate:_ ✅ vitest (14) + `tsc` + `yarn build`.

- [x] **Task 6 — Look as target.** In `FilterPresetModal.tsx`: `applyLookToBeats`
  clears the global fine-tune before writing per-Beat Grades (killing the
  double-apply), and `undoGrade` restores both the per-Beat Grades and the global
  it cleared.
  _Tests:_ extract the snapshot/restore into a pure helper and cover it — apply
  clears the global; undo restores per-Beat values *and* the global; a Beat whose
  grade failed is left untouched. Helper extracted to `src/lib/lookApply.ts`
  (`captureGradeSnapshot`, `clearedGlobal`, `restoredGlobal`, `wasSnapshotted`),
  so the snapshot now carries the global override, not just the Beat Grades.
  _Gate:_ ✅ vitest (15) + `tsc` + `yarn build`.

- [~] **Task 7 — E2E gate.** Full `vitest run`, `npx tsc --noEmit`, `yarn build`.
  Manual flow (upload reference → derive Look → apply to Beats → check split-tone
  is visible in preview → export → compare) noted as pending a `yarn dev` pass,
  since it needs the Claude vision proxy and ffmpeg.
  _Gate:_ ✅ `vitest run` 168/168 across 23 files, ✅ `npx tsc --noEmit`,
  ✅ `yarn build`. No references to `ffmpegColorFilters` or `wbMatrixFilter`
  remain. ⏳ Manual flow pending a `yarn dev` pass.

---

## Follow-up — diagnosed from a real grade (2026-07-25)

A Look derived from a warm indoor reference, applied to a vivid outdoor mural,
came out neon and flat-topped. Two causes, both reproduced numerically before
fixing: the derived Look was being written to the **global override** and applied
flat to non-neutral footage, and the grade **hard-clipped**, slamming channels to
0/255. The tell was the sidewalk: concrete is neutral, and saturation provably
cannot colourise a neutral (`saturation:+60` leaves `150,150,150` unchanged), so
the yellow-green cast had to come from the additive axes — white balance and
split-tone.

- [x] **Task 8 — Deriving a Look stops writing to the global override.**
  `analyzeLook` and `loadSavedReference` set the Look only; neither calls
  `onSelectFilter` nor `setFineTuneAdj`. `analyzeFilmLook` asks Claude for values
  that push *neutral* footage toward the look, so applying them flat to footage
  that is nowhere near neutral overshoots — `gradeBeatToLook` is the function that
  accounts for where a shot already sits, and it only runs on apply. Completes
  ADR-0010's "a Look is a target, not an offset", which Task 6 applied to the
  apply path but not the derive path.
  _Tests:_ source-level regression guard — neither function may write the global.
  _Gate:_ ✅ vitest (8) + `tsc` + `yarn build`.

- [x] **Task 9 — Soft shoulder instead of a hard clip.**
  `curveStep` rolls highlights off with a tanh shoulder above a knee rather than
  truncating at 1.0, so overshooting values stay *separated* instead of all
  becoming 255. Shadows keep a hard floor at 0: black must stay black, which is
  the property that distinguishes this from the old additive `eq=brightness`.
  The shoulder engages only when the curve axes (exposure, contrast, split-tone)
  are active, so a saturation-only Grade does not dull whites.
  _Known limit:_ the shoulder cannot extend past the matrix step. SVG clamps
  between filter primitives, so carrying headroom through `feColorMatrix` would
  make the preview and the LUT disagree — and parity is the point (ADR-0010).
  Extreme saturation can therefore still clip at the matrix stage.
  _Tests:_ monotonic; never exceeds 1; black stays black; two overshooting inputs
  stay distinct; inert for a saturation-only Grade; drift guard still passes.
  _Gate:_ ✅ vitest (184 total) + `tsc` + `yarn build`.
  _Measured after:_ the curve stage no longer pins — cyan wall's blue rolls to
  0.969 instead of 1.0. But the matrix stage then drives it to 1.030 and the
  hard clamp takes it to 255, so **the reported screenshot is not fixed by this
  task alone**. Matrix-stage signal range for that Grade is -0.179 .. 1.244,
  i.e. ~1 bit of headroom would be needed to carry it through a third SVG
  primitive. Pending a decision — see below.

- [x] **Task 10 — Shadows and Highlights axes.** Two luminance axes on
  `ColorAdjustments`, distinct from the split-tone pairs which colour the same
  regions. They live in `curveStep`, so the `feComponentTransfer` table and the
  baked LUT carry them with no architecture change and parity holds by
  construction. Weights are `x(1-x)³` and `(1-x)x³`, normalised to peak at 1 at
  x=0.25 and x=0.75 and **zero at both ends** — Shadows recovers the dark region
  without fogging true black, matching what Lightroom means by the word and
  therefore what Claude assumes when it emits a value. Wired through
  `types.ts`, `AXES`, `filmLook.ts` (keys, prompt doc, both JSON templates),
  `Inspector.tsx` under a new "Tone" heading, and the modal's fine-tune array.
  _Fixed en route:_ the Task 9 shoulder ran whenever any curve axis was active,
  so it compressed pure white to 0.940 even for a Grade that never overshoots.
  It is now gated on `curveOvershoots()` — sampled per Grade and channel, cached
  — so Shadows/Highlights hold both ends exactly and only genuinely overshooting
  Grades pay the rolloff.
  _Tests:_ black and white held exactly; each axis moves its own region and
  leaves the far end within half an 8-bit step; the two weights are mirrors and
  never exceed their peak; shoulder stays off for non-overshooting Grades; drift
  guard extended to 11 Grades including shadows/highlights and a full-panel case.
  _Gate:_ ✅ vitest 197/197 + `tsc` + `yarn build`.
