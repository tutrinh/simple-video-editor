# Simple Video Editor — Codebase Knowledge

> Last verified: 2026-07-27 at commit `54b8054`
>
> Purpose: durable working memory for future contributors and coding agents.
> Read this first, then `CONTEXT.md`, `.agents/AGENTS.md`, and the ADR relevant to
> the feature being changed. This file describes the implementation as it exists;
> root task documents may describe historical work or future intent.

## 1. Product in one paragraph

Simple Video Editor is a local-first, browser-based nonlinear video editor for
turning uploaded clips and stills into a short, captioned Cut. The author can
arrange and trim Beats manually, or use a local Claude/Codex CLI to inspect
sampled frames and write a Story/Script. The editor supports captions,
voiceovers, music, sound effects, B-roll Overlays, Stickers, split screens,
titles, transitions, static Zoom, Ken Burns motion, rotation, and per-Beat or
global colour work. Preview is interactive HTML/canvas media; final rendering is
done entirely in the browser with self-hosted ffmpeg.wasm.

The current UI is the single dark/light “Studio” workspace, not the older
phase/tab flow described in early planning documents.

## 2. Source of truth and vocabulary

`CONTEXT.md` defines the ubiquitous language. Preserve its distinctions:

- **Project** is the whole session; **Cut** is the assembled edit.
- **Clip** is an uploaded source; a **Still** is a Clip with synthetic duration.
- **Beat** is one trimmed Clip in the Cut plus its Script/Caption fields.
- **Story** is the authored intermediate; **Script** is its written content.
- **Direction** changes what the Story says; **Tone** changes how it sounds.
- **Layer** means content composited above footage: Caption, Title overlay,
  Overlay, or Sticker. Zoom, Ken Burns, Grade, and rotation are not Layers.
- **Overlay** is timed video over the Cut. **Sticker** is a positioned image.
- **Look** is a reusable colour target. **Grade** is the adjustment on a Beat.
- **Zoom** is static framing. **Ken Burns** is moving framing. They are mutually
  exclusive modes.

Do not casually substitute “timeline,” “asset,” “filter,” “narration,” etc.
where the project language has a more precise term.

## 3. Runtime architecture

```text
main.tsx
  ThemeProvider
    SettingsProvider            AI provider/model/tone/genre; localStorage
      ProjectProvider           ProjectState reducer; Clips/Story/Cut
        ExportSettingsProvider  VO/music/caption/title settings; localStorage
          StudioApp
            TopBar / ClipBin / StagePreview / Timeline / Inspector
            AI Story drawer / Settings drawer / Export drawer
```

There is no router and no conventional application server. `StudioApp` owns
ephemeral workspace UI state such as the selected Beat/lane item and open
drawers. Durable editing state is split across the three contexts above.

`TopBar` mounts `useAutoSaveProject`, which restores the active Project from
IndexedDB and debounces saves by 1.5 seconds. Therefore project persistence is
active whenever the normal Studio UI is mounted.

### Important state boundary

- `ProjectState` (`src/state/projectReducer.ts`) holds title, Clips, Direction,
  Story, and Cut.
- `Cut` holds Beats plus independent Overlay, VO, SFX, and Sticker lanes and the
  global colour Look.
- `ExportSettings` holds output quality, caption appearance, TTS/voice settings,
  music, and the Cut-level title treatment.
- Beat-specific title layers live on `Beat.titleLayers`.
- `Settings` holds AI engine/model, Tone, and Script Type.
- Selection, drawer visibility, playback, and generated preview/export blobs are
  component-local and not persisted.

## 4. Domain model and invariants

The domain spine is `src/domain/types.ts`.

### Clip

- Owns the original browser `File`, measured dimensions/duration, optional
  normalized `Blob`, poster, AI description, inclusion flag, and tags.
- `kind === "still"` distinguishes image imports. Undefined means video for
  backward compatibility.
- Stills receive a synthetic 10-second duration.
- A duplicated Beat duplicates its Clip record and intentionally reuses the
  underlying immutable File/Blob.

### Beat

- References one Clip by `clipId`.
- `inSec`, `outSec`, and `durationSec` are intended to agree; trim paths update
  them together, but the invariant is not structurally enforced.
- `scriptText` is authored prose. `captionText` is a separate override/display
  field and is often empty.
- Framing is either ordinary Zoom (default when `framing` is absent) or Ken
  Burns. Ken Burns is currently for Stills.
- A Beat may also own Grade, rotation, volume, transition, split-screen
  configuration, and title layers.

### Cut lanes

- Beats advance the master Cut clock.
- Overlays, VO segments, SFX segments, and Stickers have independent
  `startTimeSec`/duration windows and do not advance it.
- “Fit to Beat” windows are resolved at read/render time so re-trimming does not
  leave stale written durations.
- Layer arrays are optional for backward-compatible saved Projects.

### Reducer behavior

`projectReducer` is intentionally explicit. CRUD families exist for Beats,
Overlays, VO, SFX, and Stickers. Notable behavior:

- Removing a Clip does not automatically clean every reference to it.
- Reordering accepts an ID order and silently omits Beats not present in it.
- Duplicating timed lane items nudges the copy by 0.5 seconds; fit-to-Beat
  Stickers prefer the next Beat.
- `RESET` clears in-memory Project state only. The UI also resets settings, but
  persisted saved Projects remain available unless explicitly deleted.

## 5. Main user flows

### Ingest

`src/features/ingest/ingest.ts` and `src/lib/frameSampler.ts`:

1. ClipBin accepts videos and supported raster still formats.
2. `createClip` probes dimensions and duration using browser media/canvas APIs.
3. A poster is generated separately by the UI flow.
4. Although ADR-0002 and comments discuss 1080p normalization,
   `needsNormalize()` currently always returns `false`; originals retain their
   full resolution. `normalizeTo1080p()` still exists but normal ingest does not
   select it.
5. Blob URLs must come from `getClipBlobUrl()` in `src/lib/blobUrlCache.ts`.

### Manual editing

- With Clips but no Cut, `StudioApp.startManualCut` creates one Beat per Clip in
  upload order, defaulting to 16:9.
- `makeBeat` in `features/assemble/assemble.ts` computes a centered trim window.
- Empty-script video Beats use the configured default duration. Stills consume
  their full synthetic duration.
- ClipBin, Timeline, and Inspector provide the editing surface.

### AI-assisted Script

`src/studio/useRegenerate.ts` is the live orchestration path:

1. Only Clips already used by the Cut are analyzed.
2. Videos are sampled to about eight JPEG frames; Stills send one frame.
3. The chosen local AI provider produces a neutral `ClipDescription`.
4. Script authoring preserves the editor’s exact Beat membership and order and
   asks for exactly one line per Beat.
5. It updates Beat `scriptText`, then mirrors the result into `state.story`.
6. Per-Beat refine rewrites only that Beat’s Script line.

`authorStory()` still contains the older AI-led drop/reorder flow, but the
Studio’s current `authorScript()` path deliberately does not use it.

### Preview

- `StagePreview.tsx` is the primary editing preview for the selected Beat and Cut.
- `FinalPreview.tsx` is the fuller export-oriented preview.
- Shared math/rendering helpers live in `studio/util.ts`, the canvas renderers,
  Grade modules, and Sticker/title/caption modules.
- Preview/export parity is a critical invariant but is not fully guaranteed by
  one shared Frame representation. See “Known architectural risks.”

### Export

`src/features/export/export.ts` is the top-level browser renderer:

1. Resolve output dimensions/quality and fonts.
2. Pre-render captions, titles, and Stickers to transparent PNGs.
3. Pre-trim B-roll Overlays and pre-scale Ken Burns Stills where useful.
4. Render Beat segments in a bounded pool using isolated ffmpeg instances.
5. `segmentGraph.ts` builds typed layer/filtergraph chains in deterministic
   z-order and validates labels/inputs.
6. Concatenate segment video.
7. Build and mix source audio, Overlay audio, independent VO, SFX, and music.
8. Return a final MP4 plus Beat timing information. Text and SRT exports are
   generated by `buildScriptText` and `buildSrt`.

`ffmpegEngine.runIsolated()` creates a fresh FFmpeg instance for each operation
and terminates it afterward to cap WASM heap growth. The single-threaded core in
`public/ffmpeg-st` is the proven path. Multithreading is behind
`MT_ENABLED = false` because the real filtergraph crashed or hung during prior
testing. Do not flip it without real-clip validation.

## 6. Local “backend” and deployment boundary

`vite.config.ts` installs development-server middleware for:

- `POST /api/claude` — runs local `claude -p`; vision frames are temporary files.
- `POST /api/codex` — runs the locally authenticated `codex exec` CLI.
- `/api/tts` — proxies ElevenLabs and keeps its key server-side.
- `/api/default-music` and `/api/music` — local music directory.
- `/api/overlays` — list/read/upload local Overlay files.
- `/api/audio` — list/read/upload local SFX files.
- `/api/stickers` — list/read/upload local Sticker files.

Environment variables:

- `ELEVENLABS_API_KEY`
- `DEFAULT_MUSIC`
- `MUSIC_DIR`
- `OVERLAYS_DIR`
- `AUDIO_DIR`
- `STICKERS_DIR`

Relative media paths resolve from the repository root. Defaults are the project’s
`music/`, `overlays/`, `audio/`, and `stickers/` directories.

These endpoints are Vite `configureServer` middleware: they do **not** exist in a
plain static deployment of `dist/`. The production bundle builds, and
client-only manual editing/export can work when its assets are available, but
AI, ElevenLabs, and directory-backed media libraries require an equivalent
runtime server. “Build succeeds” must not be interpreted as “all features work
from static hosting.”

The dev and preview servers set COOP/COEP headers for `SharedArrayBuffer`, though
the multithreaded ffmpeg core is currently disabled.

## 7. Persistence and portability

### IndexedDB

Database: `vidstr_projects_db`, version 3.

- `projects`: JSON Project records and metadata.
- `media_blobs`: original/normalized Clip media and posters keyed by Clip ID.
- `title_fonts`: uploaded per-Beat title font blobs, namespaced by Project ID.
- `templates`: reusable JSON Project templates.

The active Project ID is stored in localStorage under
`simple_editor_active_project_id`. By default, a new Project’s ID is its first
Clip ID.

### localStorage

- `vidstr_settings`: AI provider/model/Tone/Script Type.
- `simple_editor_export_settings`: serializable export options.
- `vidstr_timeline_zoom`: Timeline magnification multiplier (`1` = Fit,
  up to `8` = 800%); the rendered time canvas expands while every lane remains
  percentage-aligned to it.
- Export music and uploaded title font `File` objects are excluded from this
  localStorage record.
- Additional feature-specific libraries/presets use their own keys; inspect the
  owning module before changing formats.

### Project packages

`src/lib/projectPackager.ts` provides explicit project export/import portability,
separate from IndexedDB autosave. Persistence changes should be tested against
both paths and against older optional fields.

## 8. Key module map

| Area | Primary files |
| --- | --- |
| Entrypoint/providers | `src/main.tsx`, `src/App.tsx` |
| Domain/state | `src/domain/types.ts`, `src/state/projectReducer.ts` |
| Studio shell | `src/studio/StudioApp.tsx`, `TopBar.tsx` |
| Media and Cut UI | `ClipBin.tsx`, `StagePreview.tsx`, `Timeline.tsx` |
| Editing controls | `Inspector.tsx`, `BeatTrimmer.tsx` |
| AI UI/orchestration | `AiStoryDrawer.tsx`, `AiStoryView.tsx`, `useRegenerate.ts` |
| AI calls | `lib/claudeClient.ts`, `features/analyze`, `features/author`, `features/refine` |
| Ingest/probing | `features/ingest/ingest.ts`, `lib/frameSampler.ts` |
| Export UI | `studio/ExportDrawer.tsx`, `features/export/ExportView.tsx` |
| Export renderer | `features/export/export.ts`, `segmentGraph.ts`, `lib/ffmpegEngine.ts` |
| Visual renderers | `captionCanvas.ts`, `titleCanvas.ts`, `stickerCanvas.ts`, `splitScreenCanvas.ts` |
| Colour | `lib/grade.ts`, `gradeSvg.ts`, `filmLook.ts`, `lookApply.ts` |
| Persistence | `lib/projectStorage.ts`, `hooks/useAutoSaveProject.ts`, `lib/projectPackager.ts` |
| TTS | `lib/tts.ts`, `elevenLabs.ts`, `kokoroTts.ts`, `voPresets.ts` |
| Design rules | `.agents/AGENTS.md`, `DESIGN_PATTERNS.md`, `studio/studio.css` |

## 9. Conventions that prevent regressions

1. Obey `.agents/AGENTS.md` for all UI work.
2. Use design tokens from `DESIGN_PATTERNS.md`; verify dark and light themes.
3. Range sliders use the prescribed accent and track token pattern.
4. Buttons inside draggable items must stop `pointerdown` propagation.
5. Never create/revoke active media object URLs ad hoc. Use
   `getClipBlobUrl()`. Read `PREVIEW_BLACK_SCREEN_PREVENTION.md` first.
6. For visual features, update preview and export together and add parity tests.
7. Text layers are rendered through canvas PNGs for predictable ffmpeg output;
   do not introduce platform-dependent `drawtext` behavior casually.
8. Preserve optional fields and undefined-as-legacy defaults in persisted types.
9. Keep ffmpeg operations isolated unless memory behavior has been measured.
10. Do not retry old Overlay/audio filtergraph approaches listed in
    `EXPORT_OVERLAY_AUDIO_ISSUE.md`.

## 10. Test and build status

Verified on 2026-07-27:

```text
npm test
45 test files passed
591 tests passed

npm run build
TypeScript check passed
Vite production build passed
```

Standard commands:

```bash
npm run dev
npm test
npm run test:watch
npm run build
npm run preview
```

Vitest runs in `node`, not jsdom. There are currently no `.test.tsx` component
tests. Coverage is strong for reducers, pure functions, Grade math, framing,
segment graphs, renderers, persistence helpers, and export arguments. Interactive
React behavior is mostly protected indirectly.

The production build warns about large chunks. At verification time the main
JavaScript was about 522 kB minified and the Kokoro chunk about 2.19 MB, plus an
ONNX WASM asset around 21.6 MB. TTS is a major payload/performance boundary.

## 11. Known architectural risks

### Preview/export parity

This is the highest-value architecture problem. There is no single module that
answers “what does this Beat look like at time t?” Geometry, caption metrics,
title animation, Grade, and z-order are still partly recomputed by preview and
export adapters. Past defects include rotation sign, Ken Burns focus, Overlay
fit, and black-screen Blob URL lifecycle.

`ARCHITECTURE_BACKLOG.md` proposes a shared Frame recipe/module. The typed
`segmentGraph` has already improved the export half, but it does not solve the
entire parity problem.

Known current discrepancies recorded in the backlog should be rechecked before
assuming they remain current, especially:

- StagePreview caption styling versus canvas/export settings.
- Title-versus-caption z-order.
- Inspector thumbnail Grade versus global Look.

### Large UI modules

At verification time:

- `Inspector.tsx`: ~2,614 lines.
- `FinalPreview.tsx`: ~1,096 lines.
- `export.ts`: ~1,068 lines.
- `ExportView.tsx`: ~1,055 lines.
- `Timeline.tsx`: ~1,005 lines.

Inspector is the main gravity well: many dispatch sites, repeated entity cards
and slider patterns, and test-inaccessible component logic. Add a component test
harness before a broad UI decomposition so behavior is pinned first.

### Duration has multiple representations

`Beat.durationSec` and `outSec - inSec` normally agree through editing paths, but
multiple modules derive duration independently. Prefer a shared resolver and
test legacy/malformed state when changing timing.

### Static deployment is incomplete

The Vite middleware is a local application server disguised as dev tooling.
Productionizing the full app requires moving or recreating those endpoints,
defining authentication and write policy, and preserving the headers/assets
needed by ffmpeg/ONNX.

### High-resolution ingest versus ADR wording

ADR-0002 describes normalizing 4K media to 1080p, but the current
`needsNormalize()` intentionally returns false. Export therefore bears the cost
of original-resolution sources. Treat this as a conscious implementation
divergence to resolve with product/performance evidence, not as a cleanup typo.

### Local filesystem writes

The dev upload endpoints write SFX, Stickers, and Overlays into configured local
directories. Filename handling is mostly constrained with `basename`, but the
Overlay category path deserves care because it is user-supplied and is used to
construct a directory path. Reassess traversal/write policy before exposing
these endpoints beyond trusted local use.

## 12. Documentation map

- `CONTEXT.md` — canonical language and resolved issue pointers.
- `docs/adr/0001`–`0016` — architectural decisions in chronological order.
- `docs/ROADMAP.md` — original phased product plan; useful history, not always
  current implementation.
- `ARCHITECTURE_BACKLOG.md` — current high-level design debt and prior analysis.
- `DESIGN_PATTERNS.md` — mandatory UI design system.
- `PREVIEW_BLACK_SCREEN_PREVENTION.md` — mandatory media URL/seek safety.
- `EXPORT_OVERLAY_AUDIO_ISSUE.md` — resolved filtergraph failures and dead ends.
- Root `*_TASKS.md` and plans — feature-specific implementation history and
  remaining checklists; verify status against code/tests before acting.
- `graphify-out/GRAPH_REPORT.md` — generated dependency/community overview. Its
  recorded commit predates this knowledge file; refresh before relying on exact
  graph facts.

## 13. Safe change playbooks

### Adding a Beat property

1. Add the optional/backward-compatible domain field.
2. Define the default and old-project interpretation.
3. Add reducer/editing behavior.
4. Apply it in StagePreview and FinalPreview.
5. Apply it in export/segment graph.
6. Confirm persistence/package serialization.
7. Add pure behavior and preview/export parity tests.

### Adding a new Layer type

1. Define its domain timing and ownership.
2. Add reducer CRUD and duplicate semantics.
3. Add Timeline lane, selection, and Inspector controls.
4. Add live preview behavior.
5. Extend the typed segment graph and deterministic z-order.
6. Add golden graph tests, canvas/render tests, and audio rules if applicable.
7. Verify overlap across Beat boundaries.

### Changing AI behavior

1. Decide whether the change affects Description, Story structure, Script voice,
   or per-Beat refine; keep those concepts separate.
2. Update prompt builders and parser tests.
3. Preserve the current arranged-Beat contract unless product intent explicitly
   restores AI-led reordering.
4. Test malformed/fenced JSON and mismatched response counts.
5. Never expose secrets to browser code.

### Changing export

1. Read ADR-0008/0009/0010/0011/0015/0016 plus both export issue documents.
2. Make filtergraph construction observable/testable.
3. Test Layer order and label uniqueness.
4. Compare both previews against a real exported file.
5. Validate silent Clips, Stills, Overlay audio, VO, SFX, music, transitions, and
   aspect mismatch.
6. Watch WASM memory and timeouts; do not replace isolated instances casually.

## 14. Immediate orientation checklist

Before making changes:

1. Run `git status --short` and preserve unrelated work.
2. Read `.agents/AGENTS.md`.
3. Read `CONTEXT.md` and the relevant ADR/task/issue document.
4. Trace the property through domain → reducer/context → UI → preview → export →
   persistence.
5. Run the focused tests, then `npm test` and `npm run build`.
6. If visual output changed, validate dark/light UI and preview/export parity
   with representative real media.
