# 🐞 Working Issue: Export Overlays & Audio (branch `exporting-with-overlays`)

**Status:** 🟡 TESTING — Fix #15: overlay compositing split into lean passes (pre-trim → RGB video composite → separate audio mix) so the `gbrp` RGB blend fits in memory. Goal: fix the screen/multiply magenta WITHOUT the OOM crash. Awaiting on-device retest.
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
| 13 | `overlaid.mp4` crash | Hypothesised tpad OOM → replaced with PTS-shift `setpts=…+<st>/TB`. **DID NOT FIX** (still crashed) — and worse: without tpad the overlay/blend framesync buffers all base frames before `st` (OOM for late overlays). Reverted by Fix #14. | `export.ts` | ❌ wrong diagnosis, reverted |
| 14 | `overlaid.mp4` crash | **Real root cause:** the `gbrp` RGB blend from Fix #3 crashes this ffmpeg.wasm build at runtime (no error line = abort). The pink frame proved YUV blend + tpad worked; `gbrp` was the delta. **Fix:** revert blend to **YUV** (drop gbrp) + **restore tpad** placement (needed so framesync doesn't buffer). Overlays render again; screen/multiply get the **magenta tint back** (open cosmetic issue). | `export.ts` `applyOverlaysToVideo` | ✅ confirmed: YUV overlays render, magenta present |
| 15 | Magenta + memory | **Hypothesis:** the `gbrp` crash was OOM (combined pass = full clips + RGB frames + audio amix + re-encode), not a gbrp bug. **Fix:** split into lean passes — (1) pre-trim each overlay to its window (kills full-clip memory cost), (2) composite overlay **video** in one pass with **RGB (gbrp)** blend + `-c:a copy` base audio, (3) mix overlay **audio** in a separate pass. RGB→YUV→base fallback ladder + per-pass try/catch keeps it crash-proof. Goal: RGB blend now fits → **magenta fixed**. | `export.ts` `applyOverlaysToVideo` | 🟡 TESTING |

Legend: ✅ fixed · 🟡 partial/mitigated · ⚠️ suspected regression · ▶️ led to next issue

---

## 4. Current status / open question

**Magenta on screen/multiply overlays — attempting to fix via memory isolation (Fix #15).**

Confirmed so far:
- YUV blend renders overlays fine but tints screen/multiply magenta (Fix #14).
- RGB (`gbrp`) blend fixes the color but crashed — **no ffmpeg error line = wasm abort**,
  strongly implying **OOM**, not a `gbrp` filter bug.

Fix #15 bets the crash was OOM from doing everything in one pass, and splits it:
1. **pre-trim** each overlay → small windowed file (removes full-clip memory cost),
2. **video composite** pass: base + small overlays, `gbrp` RGB blend, base audio copied,
3. **audio mix** pass: `amix` overlay audio onto the composited video.

Each pass is far leaner, so RGB blend should now fit. RGB→YUV→base fallback keeps it safe.

### What to collect on next retest
1. Do **screen/multiply** overlays now show **correct colour** (no magenta)?
2. Console: any `Overlay video composite failed (RGB=true)` warning? If present, RGB still
   fails even lean → likely a real `gbrp` build bug (not just OOM); next step is `rgb24`/`rgba`.
3. Does overlay **audio** come through, and is the base (beat/voiceover) audio intact?

---

## 5. Do NOT re-try (already ruled out / known-bad)

- ❌ `colorkey`/`negate` to fake blend modes — wrong math, magenta/paste artifacts (Fix #1 replaced it).
- ❌ `-itsoffset` for overlay timing — stalls `blend` framesync before start (Fix #2 replaced it).
- ❌ Blending screen/multiply in **YUV** — casts frame magenta (Fix #3). Must be RGB.
- ❌ Unbounded `apad` + `-shortest` for seg audio — muxer fails to finalize (Fix #9). Use `apad,atrim=0:<dur>`.
- ❌ Music stage mapping **music-only** when no voiceover — drops beat/overlay audio (Fix #6).
- ❌ Trusting the ffmpeg "last-N-lines" banner as the error — it's the post-error stream banner (Fix #11).
- ❌ RGB blend via `format=gbrp` (Fix #3) — crashes this ffmpeg.wasm build at runtime
  (silent abort). Blend runs in YUV. **Open:** find a non-crashing RGB blend to kill the
  screen/multiply magenta tint (try `rgb24`/`rgba` cautiously; may also crash — keep the
  safety net + retest each). Do NOT reintroduce gbrp without confirming on-device.
- ⚠️ Do NOT remove `tpad` placement for overlays: it both positions the overlay AND gives
  the overlay stream a frame from t=0. Without it, overlay/blend framesync buffers all base
  frames before `startTimeSec` → OOM (Fix #13). `setpts`-only shift is NOT a substitute.

---

## 6. Verification checklist (per change)

- `npx tsc --noEmit` — clean
- `npx vitest run src/features/export/export.test.ts` — 7/7 pass
- Real export smoke tests (matrix): fully silent · beat audio only · voiceover + music ·
  audible overlay + music · audio-less overlay (should degrade, not crash) · each blend mode.
