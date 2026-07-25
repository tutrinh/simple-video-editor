# AI Film-Look Color Grading — Task Tracker

Match a film look from a reference image and AI-grade the cut's beats toward it.
Two-phase: Claude derives a reusable **Look** from an uploaded reference, then grades
each beat (per-beat `colorAdjustments`) toward it, applied with a one-click Undo.
First expands the color model with split-tone so cinematic looks are representable.
Design agreed via grilling.

**Decisions:** upload reference image; per-beat AI matching → `beat.colorAdjustments`;
two-phase Look profile (saveable as a preset); lives in the Color Filter modal;
apply-directly + Undo snapshot; **expand `ColorAdjustments` with `tint`, `shadowWarmth/
shadowTint`, `highlightWarmth/highlightTint`** (two-axis split-tone); 1 mid-window frame
per beat; full strength; reuse AI provider/model.

**Working rule:** one task at a time — implement → tests → validation gate → next.
`npx tsc --noEmit` clean at every gate. No commits (per session instruction).

- [x] **Task 1 — Expand color model.** Added `tint, shadowWarmth/Tint, highlightWarmth/Tint`; combined WB SVG matrix (warmth+tint, split-tone folded as preview hint) + `ffmpegColorFilters` one `colorbalance` over shadows/mids/highlights. _Tests:_ `colorFilters.test.ts` (9). _Gate:_ ✅ vitest + tsc.
- [x] **Task 2 — Color sliders UI.** Reusable `adjRow`/`splitToneRows` in Inspector (per-beat + both global groups) + the modal fine-tune array. _Gate:_ ✅ tsc + build.
- [x] **Task 3 — Film-look AI lib** (`src/lib/filmLook.ts`): `analyzeFilmLook`, `gradeBeatToLook`, `parse*` (clamp/skip-junk), `callClaudeVision`, `sampleFrameAt`. _Tests:_ `filmLook.test.ts` (6). _Gate:_ ✅ vitest + tsc.
- [x] **Task 4 — "AI Film Look" section in the Color Filter modal.** Upload reference → Analyze look → preview in sliders → save-as-preset (existing). _Gate:_ ✅ tsc + build.
- [x] **Task 5 — Apply to all beats.** Per-beat mid-frame → `gradeBeatToLook` → `UPDATE_BEAT`; progress; snapshot → "↺ Undo AI grade"; per-beat errors tolerated. _Gate:_ ✅ tsc + build.
- [~] **Task 6 — E2E.** ✅ `vitest run` 103/103, ✅ `tsc`, ✅ `yarn build`. ⏳ Manual flow (upload → derive → apply → preview → export) pending a `yarn dev` pass (needs the `claude`/vision proxy + ffmpeg).
