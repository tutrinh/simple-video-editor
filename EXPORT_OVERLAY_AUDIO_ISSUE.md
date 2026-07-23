# 🐞 Working Issue: Export Overlays & Audio (branch `exporting-with-overlays`)

**Status:** ✅ RESOLVED (Fix #20 confirmed on-device). Overlays export with correct colours.
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
| 15 | Magenta + memory | **Hypothesis:** the `gbrp` crash was OOM (combined pass = full clips + RGB frames + audio amix + re-encode), not a gbrp bug. **Fix:** split into lean passes — (1) pre-trim each overlay to its window (kills full-clip memory cost), (2) composite overlay **video** in one pass with **RGB (gbrp)** blend + `-c:a copy` base audio, (3) mix overlay **audio** in a separate pass. RGB→YUV→base fallback ladder + per-pass try/catch keeps it crash-proof. Goal: RGB blend now fits → **magenta fixed**. | `export.ts` `applyOverlaysToVideo` | ❌ `gbrp` STILL aborts even lean — OOM theory falsified (Fix #16) |
| 16 | `gbrp` build bug | Lean `gbrp` pass still aborts (`Overlay video composite failed (RGB=true)`, no error line = wasm abort), so it's a **`gbrp` bug in this wasm build**, not OOM. **Fix:** generalize the fallback to try RGB formats in order — **`rgb24` (packed) → `gbrp` → YUV** — first success wins; `rgb24` is blend-correct and lighter than planar `gbrp`. Also `runIsolated` now keeps the raw wasm exception (`Aborted`/`memory access out of bounds`) instead of masking it with the post-error stream banner, so the next failure names the real cause. | `export.ts` `applyOverlaysToVideo`, `ffmpegEngine.ts` `summarizeFfmpegError`/throw | ❌ `rgb24` blend ALSO magenta → not the format, the `blend` filter aborts in RGB (Fix #17) |
| 17 | `blend`-in-RGB aborts | Both `gbrp` AND `rgb24` blend abort → the **`blend` filter itself** can't run in RGB on this wasm build (not a format/OOM issue). **Fix:** drop `blend` for screen/multiply/overlay; compute them in RGB with **`lut2`** (table-based two-input LUT, far lighter than `blend`, sidesteps the crashing filter). Screen `x+y-x*y/255`, multiply `x*y/255`, overlay `if(lte(x,127.5),2*x*y/255,255-2*(255-x)*(255-y)/255)`, same expr on c0/c1/c2. CSS group-opacity baked in: `x*(1-op)+f*op`. `lut2` has no `enable` timeline, so the overlay is identity-padded on BOTH ends (`tpad start_duration`+`stop_duration`) so the blend is a no-op outside its window; `shortest=1` caps to base length. YUV `blend` stays as the final (magenta) fallback. | `export.ts` `applyOverlaysToVideo` | ❌ `lut2` aborts IDENTICALLY to `blend` (both RGB formats) → not the filter; hypothesis wrong (Fix #18) |
| 18 | Unconditional diagnostics | To settle memory-vs-other, made `runIsolated` `console.error` the raw exec exception + last 40 UNFILTERED log lines and always keep `exec: <rawMsg>` in the thrown message. | `ffmpegEngine.ts` `runIsolated` | ✅ NAILED IT — log showed a healthy encode (`speed=0.293x`, no error) + `exec: called FFmpeg.terminate()` → it's our **90s timeout**, not memory/filter. Every prior RGB "abort" was this timeout. |
| 19 | **Timeout — the actual root cause** | RGB composite runs ~0.3× realtime, so cuts >~26s blew the hardcoded **90s** cap in `runIsolated`; `ff.terminate()` then rejected `exec` with "called FFmpeg.terminate()" (not "timed out"), so the catch mis-reported it as a generic failure → YUV fallback → magenta. **Fix:** (a) `runIsolated` takes a `timeoutMs` param (default 90s); (b) the overlay composite passes a duration-scaled budget `max(180s, ceil(totalDurationSec)*10s)` (~10× realtime, generous vs the ~3.4× needed); (c) set a `timedOut` flag so a terminate-triggered rejection is correctly reported as a timeout. | `ffmpegEngine.ts` `runIsolated`; `export.ts` `applyOverlaysToVideo`, `exportCut` | ✅ timeout fixed; ▶️ exposed Fix #20 |
| 20 | **Full-frame magenta (rgb24 lut2 + missing yuv420p conversion)** | With the timeout fixed (#19), the `rgb24`+`lut2` path now *completes* — but the whole video is magenta. Two causes: (a) `lut2` mishandles packed `rgb24` byte-to-component mapping in this wasm build; (b) the filter graph output stayed in RGB, and the encoder's `sws_scale` picked a wrong colorspace matrix (likely bt601 vs input's bt709) for the RGB→YUV conversion → full-frame pink/magenta shift. **Fix:** (a) drop `lut2`, go back to standard `blend` filter (the "crashes" were all the 90s timeout, now resolved); (b) use `gbrp` only (planar RGB, correct channel separation); (c) add explicit `format=yuv420p` at the END of the filter chain so the colorspace round-trip uses the in-graph converter (which inherits the correct colorspace metadata from the decode) instead of the encoder's sws_scale. Fallback ladder: `gbrp` blend → YUV blend. | `export.ts` `applyOverlaysToVideo` (`buildVideoArgs`) | ✅ **CONFIRMED** — magenta gone, overlays export correctly |
| 21 | Default timeout bump | The 90s default in `runIsolated` was too tight for many export stages beyond the overlay composite (concat with xfade transitions, music mux, fades on longer videos). Bumped the default from **90s → 300s (5 min)**. The overlay composite pass still uses its own duration-scaled budget (`max(180s, dur×10s)`) on top of this. | `ffmpegEngine.ts` `runIsolated` | ✅ |

Legend: ✅ fixed · 🟡 partial/mitigated · ⚠️ suspected regression · ▶️ led to next issue

---

## 4. Current status / open question

**✅ RESOLVED.** Two root causes, both fixed:

1. **Fix #19 — 90s timeout:** `runIsolated` had a hardcoded 90s cap that killed the
   RGB composite mid-encode (~0.3× realtime). Now duration-scaled: `max(180s, dur×10s)`.
   Default bumped from 90s → 300s for all other passes (Fix #21).

2. **Fix #20 — lut2 + missing yuv420p conversion:** the `lut2` filter in packed `rgb24`
   produced garbage colours, and the filter graph output stayed in RGB — the encoder's
   `sws_scale` used a wrong colorspace matrix → full-frame magenta. Fixed by switching to
   standard `blend` in `gbrp` (planar) + explicit `format=yuv420p` at the end of the chain.

**Confirmed on-device:** overlays export with correct colours, no magenta.

### Known follow-up (not a bug)
The composite pass can take minutes on long cuts (~3.4× realtime). If that UX is too slow,
optimize LATER: a faster x264 preset for this pass, or blend only the overlay window in RGB
and copy the rest. Correctness first, speed second.

---

## 5. Do NOT re-try (already ruled out / known-bad)

- ❌ `colorkey`/`negate` to fake blend modes — wrong math, magenta/paste artifacts (Fix #1 replaced it).
- ❌ `-itsoffset` for overlay timing — stalls `blend` framesync before start (Fix #2 replaced it).
- ❌ Blending screen/multiply in **YUV** — casts frame magenta (Fix #3). Must be RGB.
- ❌ Unbounded `apad` + `-shortest` for seg audio — muxer fails to finalize (Fix #9). Use `apad,atrim=0:<dur>`.
- ❌ Music stage mapping **music-only** when no voiceover — drops beat/overlay audio (Fix #6).
- ❌ Trusting the ffmpeg "last-N-lines" banner as the error — it's the post-error stream banner (Fix #11).
- 🧠 **The RGB "crash/abort/OOM" was a MISDIAGNOSIS** — it was `runIsolated`'s 90s timeout
  killing a healthy-but-slow encode (Fix #18/#19). Do NOT chase memory/filter/format theories
  for RGB compositing again; `gbrp`/`rgb24`, `blend`/`lut2` all encode fine, just at ~0.3×
  realtime. If the RGB composite "fails," suspect the **timeout budget** first.
- ❌ Do NOT trust a swapped filter/format to reveal a failure cause, and do NOT let
  `runIsolated` mask errors: `ff.terminate()` makes `exec` reject with "called
  FFmpeg.terminate()" (NOT "timed out"), and `summarizeFfmpegError` can bury the real line
  behind the stream banner. Diagnostics are now unconditional (Fix #18) and timeouts are
  flagged explicitly (Fix #19).
- ❌ Do NOT hardcode a one-size timeout for `runIsolated` — full-timeline re-encodes (composite,
  concat) need a duration-scaled budget; only short per-op passes fit in 90s.
- ⚠️ Do NOT remove `tpad` placement for overlays: it both positions the overlay AND gives
  the overlay stream a frame from t=0. Without it, overlay/blend framesync buffers all base
  frames before `startTimeSec` → OOM (Fix #13). `setpts`-only shift is NOT a substitute.
- ❌ Do NOT use `lut2` for RGB blending in this wasm build — it mishandles packed `rgb24` and
  produced full-frame magenta (Fix #20). Use the standard `blend` filter instead.
- ❌ Do NOT leave the filter graph output in `gbrp`/`rgb24` for the encoder to convert — the
  encoder's `sws_scale` picks a wrong colorspace matrix → full-frame magenta. Always add
  explicit `format=yuv420p` at the end of the RGB blend chain (Fix #20).

---

## 6. Verification checklist (per change)

- `npx tsc --noEmit` — clean
- `npx vitest run src/features/export/export.test.ts` — 7/7 pass
- Real export smoke tests (matrix): fully silent · beat audio only · voiceover + music ·
  audible overlay + music · audio-less overlay (should degrade, not crash) · each blend mode.
