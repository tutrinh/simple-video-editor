# Architecture backlog

Surviving candidates from the architecture review of 2026-07-26, scoped by churn
over the preceding 60 commits. Candidate **A** (the segment graph seam) was taken
up and lives in [SEGMENT_GRAPH_TASKS.md](./SEGMENT_GRAPH_TASKS.md) /
[ADR-0016](./docs/adr/0016-segment-layers.md). The rest are recorded here so they
do not depend on anyone's memory.

Vocabulary is **module / interface / depth / seam / adapter / leverage /
locality** — a module is *deep* when a lot of behaviour sits behind a small
interface, and the test for whether one earns its keep is the **deletion test**:
if you deleted it, would complexity vanish (it was a pass-through) or reappear
across N callers (it was earning its keep)?

---

## Live defects — not architecture, fix regardless

Both are instances of Candidate B. Verified in source.

### 1. Ken Burns runs on a different clock in the Cut preview

| where | time base |
| --- | --- |
| `StagePreview.tsx:310` | `pos`, normalised over `outSec − inSec` |
| `export.ts:460` | `segDur`, which is `outSec − inSec` clamped |
| **`FinalPreview.tsx:483`** | **`beatElapsed / beat.durationSec`** |

The Beat view and the export agree; the Cut view does not, unless
`durationSec === outSec − inSec`. A Beat trimmed after its duration was set
plays its move at the wrong speed in the Cut preview only.

### 2. B-roll Overlays: the previews crop, the export letterboxes

`StagePreview.tsx:333` and `FinalPreview.tsx:554` both use
`objectFit: "cover"` — fill and crop. `export.ts:717` uses
`scale=…:force_original_aspect_ratio=decrease` — fit and letterbox. Any Overlay
whose aspect differs from the canvas previews as a different shot than it
exports.

---

## Candidate B — preview/export parity is convention, not construction

**Strength: strong. The most valuable remaining change.**

**Files:** `src/studio/util.ts`, `src/studio/StagePreview.tsx`,
`src/features/export/FinalPreview.tsx`, `src/features/export/export.ts`

ADR-0008, ADR-0010 and ADR-0015 each declare a "one module, two emitters" rule,
and each implements it *separately*, for its own property. No module owns "what
this Beat looks like at time t", so **16 visual properties are computed twice**
in two files by two expressions that happen to agree.

The pattern has already failed three times:

- Rotation shipped with an **inverted sign**. It is now guarded by a test, not
  by a shared function (`beatRotation.test.ts:120`).
- Ken Burns focus: `zoompan`'s `x` is the crop's *left edge*, so focus 50 at 2×
  centres on 0.75, not 1.0. Caught only by a parity test written the same day.
- The two live defects above.

Even the best seam is only *numerically* verified — `gradeCube.test.ts:121` sets
`tolerance = 2 / CURVE_SAMPLES` because the preview quantises to a 64-entry curve
and the export to a 33³ lattice.

**The sharpest example:** `kenBurnsChain` in `util.ts:229` sits under a docstring
claiming both sides "cannot disagree", and **calls neither `kenBurnsAt` nor
`kenBurnsVisibleCenter`**. It re-implements the interpolation as string
arithmetic that is merely algebraically equal. The test catches drift; the
architecture does not prevent it.

Other unguarded duplications worth knowing about:

- Three derivations of a Beat's duration (`FinalPreview.tsx:184`,
  `export.ts:353`, `Inspector.tsx:861` — the last a hand-copy of the second).
- Three expressions of the focus mapping `0.5 + v/100` (`util.ts:88`, `:247`, `:266`).
- Caption font size and margin computed in both `FinalPreview.tsx:619` and
  `export.ts:214`.
- Title intro fade written **four times** — twice in `FinalPreview`, twice in `export.ts`.
- Title vs caption **z-order is inverted** between preview and export.
- `StagePreview` never adopted ADR-0008: its caption is still a CSS `<div>`
  (`:345` + `studio.css:135`) with a hardcoded 19px, ignoring `captionScale`.
  ADR-0008 named this as required work; it landed in one of the two surfaces.
- `Inspector.tsx:957` grades the poster thumbnail with `cssFilterFor(b.colorAdjustments)`
  only, dropping the global Look that both real previews pass.

**Proposal:** a **Frame** module — given a Beat, its Cut and a time, return the
complete visual description of that instant as data (effective scale, focus,
rotation, resolved Grade, caption metrics, active Layers). The CSS and ffmpeg
emitters become adapters over that one value, neither computing geometry. Two
adapters, so the seam is real rather than hypothetical.

**Depends on Candidate A.** You cannot test the export half of a Frame recipe
while the filtergraph is unobservable — which is what A fixes.

---

## Candidate C — no component test harness, so logic hides in the Inspector

**Strength: strong. Independent of A and B; do it whenever the Inspector next hurts.**

**Files:** `src/studio/Inspector.tsx` (1968 lines, the most-changed file in the
repo), `src/studio/lookNotGlobal.test.ts`, `package.json`, `vite.config.ts:538`

There are **zero `.test.tsx` files** and no jsdom or testing-library;
`vite.config.ts:538` sets `environment: "node"`. The project has already hit this
wall and routed around it — `lookNotGlobal.test.ts` reads a component as a **text
file** and asserts on its source, saying so plainly:

> `// This lives at source level because the offending calls are inside a React`
> `// component with no test harness, and the defect is the *presence* of a call.`

The consequence is a gravity well: logic that *could* be tested gets pulled out
to `util.ts`, and everything else stays stranded. Still inside `Inspector.tsx`
and unreachable by any test: `footageLenOf` / `durationFor` (the hand-copy behind
live defect #1), `setTrim` clamping, `fitVoLength`, `applyTransitionToAllBeats`,
`insertHintTag` caret maths.

The duplication it has accumulated:

- The **Global Look & Feel Filter card is written twice, verbatim** — 122 lines
  at `:700–821` and `:1618–1739`, differing by a **single** `color` property.
  `FilterPresetModal` is likewise mounted twice with identical props.
- **Four competing slider-row implementations** (`KenBurnsControls.row`,
  `adjRow`, `stickerRow`, plus 15 longhand copies), and `sliderTrackStyle` is
  triplicated across `Inspector.tsx`, `ExportView.tsx:31` and
  `TitleTreatmentEditor.tsx:17` with different gradients and heights.
- **Four cards share an identical header idiom** (title · Duplicate · Remove ·
  timing footer) — VO, SFX, Sticker, Overlay. That is four adapters; the seam is
  real, not hypothetical.
- 40 ad-hoc `dispatch` sites; `genId` re-declared inline four times.

**Proposal, in this order:** add jsdom + testing-library *first* — cheap, and it
removes the reason logic hides — then extract the entity cards and one
`SliderRow` module.

---

## Candidate D — four identical CRUD families in the Cut reducer

**Strength: worth exploring. The weakest candidate here.**

**Files:** `src/state/projectReducer.ts:93–226`

Overlay, VO segment, SFX segment and Sticker each have
`ADD / UPDATE / REMOVE / DUPLICATE`, character-for-character identical modulo the
array key and id prefix. The reducer says so itself at `:181`: *"The four Sticker
cases mirror the SFX ones above."* `genId` is copy-pasted five times in the file;
the `totalDur` reduce appears in every DUPLICATE case.

**Why it is weak:** the reducer is *already well tested* (17 tests covering every
family), the duplication is stable rather than churning, and generic reducer
factories often trade readable repetition for unreadable abstraction. Do this
only if these families keep growing.

---

## Candidate E — `util.ts` is a shared-maths drawer

**Strength: speculative. A consequence of B, not a task.**

**Files:** `src/studio/util.ts` (383 lines, six unrelated concerns, imported by
the studio, the export and the preview alike)

One file holds clock formatting, Clip filtering, Grade resolution, ffmpeg LUT
emission, Zoom geometry, rotation geometry and the whole Ken Burns contract. It
has **no test file of its own** — its functions are covered by five separately
named ones (`kenBurns`, `beatRotation`, `colorFilters`, `util.zoom`,
`stillClock`), which is the tests telling you where the module seams actually are.

**It fails the deletion test on its own** — splitting a drawer into three drawers
moves complexity rather than concentrating it. Worth doing only once a Frame
module (Candidate B) exists and the framing half has somewhere to go.
