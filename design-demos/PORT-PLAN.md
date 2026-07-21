# Port Plan — Direction A (Studio) into the React app

**Status:** planning only, no code changes yet.
**Design reference:** `design-demos/A-studio-v2.html` (interactive prototype).
**Approved direction:** `design-demos/direction-approved.md`.

---

## Guiding principle: recompose the View layer, keep the engine

The current app already separates **logic + state** from **presentation**:

- **Untouched by this port** (no edits, tests stay green):
  - `src/domain/types.ts` — the model already fits the design 1:1.
  - `src/state/` — `projectReducer.ts`, `ProjectContext`, `SettingsContext`, `ExportSettingsContext`. Every action the workspace needs already exists: `ADD_CLIPS`, `SET_INCLUDED`, `SET_DIRECTION`, `SET_STORY`, `SET_CUT`, `UPDATE_BEAT`, `REORDER_BEATS`, `REMOVE_BEAT`, `ADD_BEAT`, `RESET`.
  - `src/lib/*` — ffmpeg, frameSampler, claudeClient, tts, etc.
  - All feature **logic** files + their tests: `ingest.ts`, `analyze.ts`, `author.ts`, `assemble.ts`, `refine.ts`, `export.ts`. **This is why all 30 tests stay green** — nothing they cover changes.

- **Rewritten / recomposed:** only the six `*View.tsx` files and `App.tsx`. Their *content* mostly moves into new studio components; a few sub-components are reused almost verbatim (`FinalPreview`, `BeatTrimmer`'s trim UI, the `ExportView` body).

The 6 tabs stop being **places you navigate** and become **state of one workspace** + **actions you trigger**.

---

## Old tab → new home (feature-by-feature)

| Old tab / file | New home in Studio | Logic reused (unchanged) | Dispatches |
|---|---|---|---|
| **Ingest** (`IngestView` 140L) | `ClipBin` (left rail) — drop zone + clip list | `createClip`, `needsNormalize`, `normalizeTo1080p` | `ADD_CLIPS`, `SET_NORMALIZED`, `SET_POSTER`, `REMOVE_CLIP` |
| **Analyze** (`AnalyzeView` 119L) | ① a step inside **Regenerate**; ② read-only display in **Inspector** ("Clip Description · Claude") | `analyzeClip`, `hintFromName` | `SET_DESCRIPTION` |
| **Author** (`AuthorView` 118L) | `StoryBar` (logline + Direction editor) + a step inside **Regenerate** | `authorStory`, `parseStory`, `isAuthorable` | `SET_DIRECTION`, `SET_STORY` |
| **Assemble** (`AssembleView` 88L, `CutPreview` 110L) | `Timeline` (filmstrip of Beats + playhead) + `Preview` (reuses sequential playback) | `assembleCut`, `makeBeat`, `computeWindow`, `cutDuration` | `SET_CUT` |
| **Refine** (`RefineView` 154L, `BeatTrimmer` 157L) | `Inspector` (caption edit, trim, AI nudges) + `Timeline` (reorder/drag) | `rewriteCaption` | `UPDATE_BEAT`, `REORDER_BEATS`, `REMOVE_BEAT`, `ADD_BEAT` |
| **Export** (`ExportView` 329L, `FinalPreview` 212L) | `ExportPanel` (modal/drawer from TopBar); `FinalPreview` reused in the Stage `Preview` | `exportCut`, `buildScriptText`, `buildSrt`, `canvasDims`, `wrapCaption` | (none) |

---

## New component structure

```
src/App.tsx                 → StudioLayout: topbar + 3-pane grid (replaces tab router)
src/studio/
  TopBar.tsx                → project name, aspect/duration chips, Regenerate, Export, Start-over menu
  ClipBin.tsx               → left: drop/upload + clip rows (poster, duration, usability, unused)
  Stage.tsx                 → center wrapper: Preview + StoryBar + Timeline
    Preview.tsx             → 16:9/9:16/1:1 preview + transport (reuses FinalPreview playback)
    StoryBar.tsx            → serif logline + editable Direction chip
    Timeline.tsx            → filmstrip of Beats, playhead, drag-reorder
  Inspector.tsx             → right: caption edit, trim window, AI nudges, Clip Description
  ExportPanel.tsx           → drawer wrapping the existing ExportView body
  useRegenerate.ts          → orchestrates analyze → author → assemble with progress
  useSelection.tsx          → ephemeral UI state: selectedBeatId / selectedClipId (NOT in ProjectContext)
```

`main.tsx` provider tree is unchanged (same ProjectProvider / SettingsProvider / ExportSettingsProvider).

---

## The "Regenerate cut" pipeline (the flow rethink)

Today the user manually walks Analyze → Author → Assemble. In Studio this is **one action** with progress:

```
Regenerate cut:
  1. for each clip missing a description → analyzeClip → SET_DESCRIPTION   (skip already-described)
  2. authorStory(includedClips, direction) → SET_STORY
  3. assembleCut(clips, story, aspect)     → SET_CUT
```

- Runs from the TopBar; shows per-step progress (per-clip analyze %, author spinner).
- Idempotent-ish: re-running rebuilds the Cut from current clips + Direction (matches today's "clean rebuild, warned" refine behavior).
- Optional nicety: auto-run step 1 (analyze) in the background as clips finish ingesting, so Regenerate usually only does author+assemble.

---

## Decisions to make before/during the build

1. **Preview behavior** — two options:
   - **(a, recommended)** Stage preview plays the **whole Cut** sequentially (reuse `CutPreview`/`FinalPreview` playback); the timeline playhead syncs; clicking a Beat seeks to it. Inspector always reflects the selected Beat.
   - (b) Preview shows only the **selected Beat** (simpler; loses "watch the cut" which is a current feature).
2. **`ClipDescription` fields** — the real type is `{ vlogMove, energy, usability }`, **not** subject/setting. The Inspector's "Clip Description" section must use the real fields (the mockup's "Subject/action · Setting/mood" copy is a placeholder to correct).
3. **Selection model** — add ephemeral `selectedBeatId` (default: first Beat). Lives in `useSelection`, not the reducer.
4. **Empty / first-run states** — bin empty → large drop zone; no Cut yet → Stage shows "Add clips, then Regenerate"; Inspector shows a hint.
5. **Layout** — moves from a 960px centered column to a full-viewport 3-pane grid. Need a sensible `min-width` and small-screen fallback (e.g. stack or hide inspector under ~1100px).
6. **Aspect (9:16 / 1:1)** — preview + timeline thumbs should reflect the chosen aspect (export already handles it).
7. **Start over (`RESET`)** — moves into a TopBar overflow menu.

---

## Migration order (app stays runnable at every step)

0. **Scaffold behind a flag.** Add `src/studio/` and mount `StudioLayout` when `?studio=1` (or a localStorage toggle), leaving the current tabbed `App` as default. Nothing breaks; both run side by side.
1. **Shell** — StudioLayout + TopBar + three empty panes reading real `useProject()` state.
2. **ClipBin** — port Ingest upload + list; drop clips, see posters + usability.
3. **Timeline + Preview** — port Assemble/CutPreview; watch the Cut, playhead + selection.
4. **StoryBar + Regenerate** — port Author Direction; wire the analyze→author→assemble pipeline.
5. **Inspector** — port BeatTrimmer trim + caption edit + `rewriteCaption` nudges + Clip Description.
6. **ExportPanel** — wrap the existing `ExportView` body in a drawer off the TopBar.
7. **Flip + clean up** — make Studio the default, delete the six `*View.tsx` + tab router, remove the flag.

Add light component tests for the new wiring (`useSelection`, `useRegenerate`) as we go; the existing logic tests keep passing untouched.

---

## Effort & risk

- **Low risk / mostly reuse:** ExportPanel, ClipBin, Inspector trim (BeatTrimmer already does it).
- **Medium:** Timeline (drag-reorder + playhead), StoryBar.
- **Highest:** `useRegenerate` orchestration and Preview↔Timeline playback sync (decision #1).
- **No risk to:** state, domain, lib, and every existing test.

Rough size: ~7 incremental PRs/steps; the engine work is already done, so this is UI assembly against a stable core.
