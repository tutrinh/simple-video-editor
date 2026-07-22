# 🐞 Working Issue: Export Overlays & Audio (branch `exporting-with-overlays`)

**Status:** 🟡 OPEN — segment audio fixed; overlay compositing stage (`overlaid.mp4`) still failing on some configs.
**Last updated:** 2026-07-22
**Owner:** Tu Trinh

This is a **living document**. Log every hypothesis, fix, and outcome here so we
don't re-try approaches that already failed. Update the status table as we go.

---

## 1. Summary

Exported video does not match the in-app **preview** for overlays and audio.
The preview composites overlays with the browser's CSS engine; the export must
reproduce that with ffmpeg.wasm (`runIsolated`), which is where the divergence and
failures live.

Core files:
- `src/features/export/export.ts` — `exportCut()`, `applyOverlaysToVideo()`, per-beat segment render.
- `src/lib/ffmpegEngine.ts` — `runIsolated()` (one isolated engine per ffmpeg command).
- `src/studio/StagePreview.tsx` — the preview (source of truth for intended look).

### Export pipeline stages (each = one `runIsolated` call → named output)
1. **`seg.mp4`** — per beat: trim → scale/letterbox → burn captions → audio.
2. **`video.mp4`** — concat segments (or xfade transitions).
3. **`start_faded`/`end_faded`** — intro/outro fades.
4. **`titled.mp4`** — burn title overlay.
5. **`overlaid.mp4`** — composite B-roll/blend overlays + mix overlay audio. ← **currently failing**
6. **`final.mp4`** — mux music bed.

---

## 2. Root-cause themes

- **Preview ≠ export engine.** Preview = CSS `mix-blend-mode` + `opacity`, exact
  React mount/unmount timing. Export = ffmpeg filtergraph. Any blend/timing/color
  must be re-derived, and ffmpeg.wasm rejects some filters/options silently.
- **Audio has many combinations** (beat audio, voiceover, overlay audio, music,
  or none). Every stage must handle all combos without crashing.
- **ffmpeg error reporting is misleading.** ffmpeg prints its stream banner
  *after* a filtergraph error, so the naive "last N log lines" hides the real
  cause. (Addressed — see Fix #11.)

---

## 3. Fixes tried (chronological)

| # | Area | Change | File | Outcome |
|---|------|--------|------|---------|
| 1 | Overlay blend | Replaced `colorkey`/`negate` blend approximations with real `blend=all_mode={screen,multiply,overlay}` + restored `enable=` time-gating | `export.ts` `applyOverlaysToVideo` | ✅ blend math correct; ▶️ exposed pink cast (Fix #3) |
| 2 | Overlay timing | Placement via `tpad=start_duration` (+ `setpts`) instead of `-itsoffset` (which stalled `blend` framesync before start) | `export.ts` | ✅ overlay plays from its first frame in window |
| 3 | Pink/magenta cast | Force RGB blend: `format=gbrp` on base **and** overlay before `blend` (YUV blend hit chroma planes → magenta) | `export.ts` | ✅ pink fixed by reasoning; ⚠️ **suspected cause of Fix #10 `overlaid.mp4` failure** |
| 4 | Dead code | Removed orphaned `audioFilter` var; folded voiceover lead-in `adelay` into `voiceLeadMs`/filter_complex | `export.ts` `exportCut` | ✅ TS build error gone; lead-in preserved |
| 5 | Overlay audio | `amix` each audible overlay's audio (volume + `adelay` to start) over base | `export.ts` `applyOverlaysToVideo` | ✅ added |
| 6 | Music stage | Always `amix` base audio under music (was mapping music-only when no VO → dropped overlay/beat audio) | `export.ts` `exportCut` | ✅ fixed |
| 7 | Crash-safety (audio) | Skip mix when no audible overlays; overlay-audio mix falls back to base-audio-only if a clip has no audio stream; music falls back to music-only if base has no audio | `export.ts` | ✅ added |
| 8 | Beat audio | Export the beat's **own footage audio** (`[0:a]`) at `beat.volume` for non-VO beats (`source`/`silent`/`vo` strategies), matching preview `v.volume=beat.volume` | `export.ts` seg render | ✅ added; ▶️ caused Fix #9 `seg.mp4` failure |
| 9 | `seg.mp4` failure | Bound all seg audio to `segDur` via `apad,atrim=0:<segDur>` instead of unbounded `apad` + `-shortest` (which made the muxer fail to finalize) | `export.ts` seg render | ✅ **FIXED** — export now passes segment stage (confirmed) |
| 10 | `overlaid.mp4` failure | (see Current Status) safety net: overlay stage never throws — falls back to un-overlaid base video; export always completes | `export.ts` `applyOverlaysToVideo` | 🟡 crash prevented; **overlays may be skipped** — root cause unconfirmed |
| 11 | Diagnostics | `runIsolated` now surfaces real ffmpeg error lines (prefers lines matching `error/invalid/matches no/option … not/…`) instead of trailing stream banner | `ffmpegEngine.ts` `summarizeFfmpegError` | ✅ next failure will name the offending filter |
| 12 | Portability | Transparent letterbox color `0x00000000` → `black@0.0` in normal-overlay path | `export.ts` | 🟡 best-guess hardening, unverified |

Legend: ✅ fixed · 🟡 partial/mitigated · ⚠️ suspected regression · ▶️ led to next issue

---

## 4. Current status / open question

**`overlaid.mp4` (stage 5) fails on the voiceover + music + overlay export.**

Key finding: the surfaced error is from the attempt whose `filter_complex` contains
**only the video overlay chains** (the base-audio-only fallback). So the failure is
the **video overlay filtergraph**, NOT the audio — the banner only *looked* audio-
related because ffmpeg failed during filtergraph setup right after listing an input
audio stream.

Prime suspects (need real error log to confirm):
- **Blend path:** `format=gbrp` + `blend=all_mode=…` (Fix #3) — this build may not
  accept `gbrp` for `blend`. Note the pre-`gbrp` version *did* render (the pink frame).
- **Normal path:** transparent `pad`/`tpad` color (Fix #12 may address).

### What to collect on next retest
1. Does the export **complete**? (Safety net means it should — possibly without overlays.)
2. Browser DevTools console: look for `Overlay composite attempt … failed` — it now
   prints the **real ffmpeg error line**. Paste that line here.
3. What **blend mode** is the overlay (normal / screen / multiply / overlay)? Tells us
   which filter path (`overlay` filter vs `blend`/`gbrp`) is breaking.

---

## 5. Do NOT re-try (already ruled out / known-bad)

- ❌ `colorkey`/`negate` to fake blend modes — wrong math, magenta/paste artifacts (Fix #1 replaced it).
- ❌ `-itsoffset` for overlay timing — stalls `blend` framesync before start (Fix #2 replaced it).
- ❌ Blending screen/multiply in **YUV** — casts frame magenta (Fix #3). Must be RGB.
- ❌ Unbounded `apad` + `-shortest` for seg audio — muxer fails to finalize (Fix #9). Use `apad,atrim=0:<dur>`.
- ❌ Music stage mapping **music-only** when no voiceover — drops beat/overlay audio (Fix #6).
- ❌ Trusting the ffmpeg "last-N-lines" banner as the error — it's the post-error stream banner (Fix #11).

---

## 6. Verification checklist (per change)

- `npx tsc --noEmit` — clean
- `npx vitest run src/features/export/export.test.ts` — 7/7 pass
- Real export smoke tests (matrix): fully silent · beat audio only · voiceover + music ·
  audible overlay + music · audio-less overlay (should degrade, not crash) · each blend mode.
