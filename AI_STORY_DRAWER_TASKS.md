# AI Story Gen Drawer — Task Tracker

Centralizes the scattered AI flow (ClipBin analyze + floating StoryBar + Inspector refine)
into one "✨ AI Story" slide-over drawer: steering controls, clip analysis, story authoring,
and a beat thumbnail grid (poster + factual description + editable script line with AI refine).
Adds a **Script Type** genre steer (product review / vlog / explainer / dramatic news / sports)
orthogonal to **Tone**.

**Working rule:** one task at a time — implement → tests → validation → gate, then next.
`npx tsc --noEmit` clean at every gate. No commits (per session instruction).

- [x] **Task 0 — Tracked task doc.** This file. _Validation:_ lists Tasks 1–9.
- [x] **Task 1 — Script Type setting + hint** (`state/SettingsContext.tsx`). _Tests:_ `state/scriptType.test.ts` (4 pass). _Gate:_ ✅ vitest + tsc.
- [x] **Task 2 — scriptType into author prompt** (`lib/claudeClient.ts`, `features/author/author.ts`, exported `buildPrompt`). _Tests:_ `author.test.ts` (12 pass). _Gate:_ ✅ vitest + tsc.
- [x] **Task 3 — Hook wiring + `refineBeat`** (`studio/useRegenerate.ts`). _Gate:_ ✅ tsc.
- [x] **Task 4 — Drawer shell** (`studio/AiStoryDrawer.tsx`). _Gate:_ ✅ tsc.
- [x] **Task 5 — Drawer body** (`studio/AiStoryView.tsx`). _Gate:_ ✅ tsc.
- [x] **Task 6 — TopBar + StudioApp entry point; removed StoryBar** (stage AI overlay moved into the full-screen drawer). _Gate:_ ✅ tsc.
- [x] **Task 7 — Strip old UI** (ClipBin analyze removed, StoryBar.tsx deleted, `showStoryBar` removed, SettingsDrawer note). _Gate:_ ✅ tsc + `grep showStoryBar` clean.
- [x] **Task 8 — Styles** (`studio/studio.css` `.st-ai-*`). _Gate:_ ✅ compiles into build.
- [~] **Task 9 — E2E.** ✅ `vitest run` 79/79, ✅ `tsc --noEmit`, ✅ `yarn build`. ⏳ Manual flow (analyze/author/refine via dev-only `claude -p` proxy) pending a `yarn dev` pass.
