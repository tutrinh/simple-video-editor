# Still images as Clips — Task Tracker

Import JPG/PNG/WebP alongside video. A **Still** becomes an ordinary Clip with a
synthetic 10-second duration, so adding one to a Beat gives a 10s Beat.
Decisions and rationale in [ADR-0012](./docs/adr/0012-still-images-as-clips.md);
the term in [CONTEXT.md](./CONTEXT.md).

**Binding constraint: no still-specific arithmetic.** A Still carries a real
`durationSec` (10), so `computeWindow`, `preBeats`, the trimmer and the timeline
keep the maths they already have. Five places branch on `Clip.kind`: ingest, the
beat window, the three preview surfaces, the export input stage, and the two
vision paths that sample frames through a `<video>`. `kind` is optional —
`undefined` means video — so saved projects load unchanged.

**Working rule:** one task at a time — implement → tests → validation gate →
next. `npx tsc --noEmit` clean at every gate. No commits (per session
instruction).

---

- [x] **Task 0 — Docs.** ADR-0012, the CONTEXT `Still` term (and the widened
  `Clip` term), and this tracker.
  _Gate:_ ✅ files exist.

- [x] **Task 1 — Domain + ingest.** `Clip.kind?: "video" | "still"`;
  `STILL_CLIP_DURATION_SEC: 10` in `editorDefaults.ts`. `isStillFile(file)` and
  `probeStill()` (via `<img>`, mirroring `probeVideo`'s `<video>`) in
  `frameSampler.ts`; `stillFrame()` returning one `SampledFrame` so posters and
  the Claude description work from the image itself. `createClip` branches on
  `isStillFile`; `needsNormalize` returns false for a Still (`normalizeTo1080p`
  runs libx264 and would make a one-frame video out of a photo).
  _Tests:_ `isStillFile` across extension and MIME — jpg/jpeg/png/webp/gif/avif
  on both, mp4/mov/webm rejected, `video/webm` not confused with `.webp`,
  uppercase and query-ish names, a bare name with no extension;
  `needsNormalize` false for an oversized Still and still true for oversized
  footage.
  _Gate:_ ✅ vitest (11) + `tsc`.

- [x] **Task 2 — Beat duration is 10s.** `computeWindow` takes the Clip's kind
  and gives a Still the whole source window `[0, 10]` instead of a
  script-derived centred slice. `makeBeat` passes it through, and `assembleCut`
  inherits it — `makeBeat` is `computeWindow`'s only caller.
  _Tests:_ a Still Beat is 10s with an empty script, with a short script, and
  with a script long enough that a video Beat would exceed it; `inSec` is 0;
  video behaviour is byte-identical to before (centred window, script pacing,
  the `Math.min` clamp); a mixed Story assembles both kinds side by side.
  _Gate:_ ✅ vitest (10) + `tsc`.

- [x] **Task 3 — Clip Bin import.** `accept` widens to images, `handleFiles`
  admits them by MIME or extension, the poster comes from `stillFrame` rather
  than `sampleFrames`, and the normalize pass is skipped. Drop-zone copy says
  what is accepted, and `CLIP_FILE_ACCEPT` lives beside `STILL_EXT_RE` so the
  two cannot drift. A Still row reads its 10s and carries a "still" marker.
  "+ Overlay" is hidden on a Still — B-roll is pre-trimmed with `-ss/-t`
  against a video source, and over-the-Cut images are the Sticker track's job.
  _Gate:_ ✅ `tsc` + `yarn build`.

- [x] **Task 4 — Beat preview.** `StagePreview`'s beat view renders an `<img>`
  for a Still inside the existing zoom/rotation wrappers, carrying the same
  `cssFilterFor` grade so preview and export stay in step. A Still cannot drive
  `ontimeupdate`, so playback and the scrubber run off a rAF clock over the
  Beat's window; play/pause, frame-step and scrub keep their current behaviour.
  _Tests:_ `advanceStillPos` is pure — proportional advance, ending exactly at
  the out-point and never wrapping, not ending one frame early, clamping below
  zero, a degenerate window staying finite, a zero dt being a no-op, and 300
  frames of 1/30s landing on the out-point without float drift pushing it late.
  _Gate:_ ✅ vitest (7) + `tsc` + `yarn build`.

- [x] **Task 5 — Cut preview.** `FinalPreview` swaps the `<video>` for an
  `<img>` on a Still Beat. Its beat clock already advances on rAF from
  `b.durationSec` independently of the video element, so the transport, the
  transition animations, Stickers, Title overlays and Captions need no change —
  only the "freeze the last frame once footage is spent" pause is skipped
  (`videoRef.current` is null for a Still and every use was already guarded).
  _Gate:_ ✅ `tsc` + `yarn build`.

- [x] **Task 6 — Trimmer.** `BeatTrimmer` shows the image instead of the scrub
  video for a Still. Handles, the selected region and the `x.x – y.y s of 10.0s`
  readout work unchanged because `dur` is a real number; "Play range" runs off
  the same rAF clock as Task 4 rather than `video.play()`, which releases the
  button at the out-point the way `onTimeUpdate` does for footage.
  _Gate:_ ✅ `tsc` + `yarn build`.

- [x] **Task 7 — Export.** A Still Beat's input becomes
  `-loop 1 -t {footageLen} -r 30 -i in.{ext}` in place of
  `-ss {inSec} -t {footageLen} -i in.mp4` — the same treatment captions, Title
  overlays and Stickers already get — and its audio always comes from
  `anullsrc` (`strategy: "silent"`), never `[0:a]`. `sourceName()` consults
  `kind` before `normalized`. `projectPackager` leaves a Still's `normalized`
  unset on import so the rehydrated clip is not handed to ffmpeg as `in.mp4`.
  _Tests:_ the input-args builder — a Still emits `-loop 1` and no `-ss`, a
  video emits `-ss` and no `-loop`, `footageLen` lands in `-t` either way,
  `sourceName` returns the real extension for a Still even when `normalized` is
  set, and the audio strategy is forced silent for a Still with `volume > 0`.
  Input ORDER is unchanged, so the caption/title/overlay/sticker index
  arithmetic is untouched — assert the index base a Still segment computes
  equals the video one.
  _Gate:_ ✅ vitest (17) + `tsc` + `yarn build`.

- [x] **Task 8 — Vision paths.** Both places that reach for frames through a
  `<video>` take the Still's own frame instead: `analyzeClip` (the Claude
  description, ADR-0001) and `FilterPresetModal`'s per-beat AI grade. The grade
  loop swallows its per-beat errors, so without this a Still would have been
  silently skipped rather than visibly broken — worth fixing for that reason.
  _Tests:_ none meaningful — both are `<img>`/`<canvas>` IO with no pure part
  left to isolate once `stillFrame` (Task 1) owns the decoding.
  _Gate:_ ✅ `tsc` + `yarn build`.

- [x] **Task 9 — E2E gate.** Full `vitest run`, `tsc`, `yarn build`, plus a
  round-trip check that `kind` survives `.vidstr` export → import.
  ⏳ Manual pass: import a JPG and an MP4, add both as Beats, confirm the Still
  is 10s, trim it, grade it, put a Sticker over it, and export.
  _Tests:_ `projectPackager.test.ts` — `kind` and the synthetic duration survive
  import; a Still's `normalized` stays unset while footage still gets one; the
  file comes back under its own name and MIME; a project saved before `kind`
  existed loads as footage.
  _Gate:_ ✅ `vitest run` 326/326 across 29 files, ✅ `tsc`, ✅ `yarn build`.
  ⏳ Manual pass still pending — nothing here has been run against a real
  browser or a real ffmpeg export.
