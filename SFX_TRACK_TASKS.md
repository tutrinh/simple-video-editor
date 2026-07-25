# SFX (Sound-Effects) Track — Task Tracker

An audio sound-effects track modeled on the VO track. Sounds live in an `audio/`
directory; segments reference sounds by filename, place on a timeline lane, mix into
the live Cut preview (FinalPreview) and the export. Design contract agreed via grilling.

**Decisions:** filename reference + upload copies into `audio/`; trim-tail only (≤ source length);
volume-only per segment; overlapping SFX allowed; live synced playback in the existing
continuous Cut player (FinalPreview) + export `amix`.

**Working rule:** one task at a time — implement → tests → validation gate → next.
`npx tsc --noEmit` clean at every gate. No commits (per session instruction).

- [x] **Task 1 — Domain + reducer.** `SfxSegment` type, `Cut.sfxSegments`, `ADD/UPDATE/REMOVE/DUPLICATE_SFX`. _Tests:_ reducer spec (10 pass). _Gate:_ ✅ vitest + tsc.
- [x] **Task 2 — `/api/audio` dev proxy + `audio/` dir.** list / file / upload; `AUDIO_DIR` env (default `./audio`). _Gate:_ ✅ tsc + build + curl smoke (upload→list→file verified).
- [x] **Task 3 — SFX client lib** (`src/lib/sfxLibrary.ts`): list, file bytes, upload, shared AudioContext + buffer cache, duration. _Gate:_ ✅ tsc.
- [x] **Task 4 — Timeline SFX lane + picker** (`SfxPicker.tsx`, violet lane below VO; place at selected beat start; drag/trim-tail; overlap allowed; StudioApp selection wiring). _Gate:_ ✅ tsc + build.
- [x] **Task 5 — Inspector "SFX Segment" card.** filename, volume, start/length, remove/duplicate. _Gate:_ ✅ tsc.
- [x] **Task 6 — Live preview in FinalPreview.** multi-voice HTMLAudio scheduler synced to `elapsed`; start/stop on window/play/pause. _Gate:_ ✅ tsc + build.
- [x] **Task 7 — Export mixing.** each SFX → `atrim`+`volume`+`adelay` folded into the final `amix`. _Gate:_ ✅ tsc + build.
- [~] **Task 8 — E2E.** ✅ `vitest run` 88/88, ✅ `tsc`, ✅ `yarn build`. ⏳ Manual flow (upload → place → preview → export) pending a `yarn dev` pass (needs the dev proxy + ffmpeg).
