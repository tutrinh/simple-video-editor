# 🏎️ Export Performance — Task List

**Status:** ✅ RESOLVED
**Created:** 2026-07-23
**Owner:** Tu Trinh
**Goal:** Cut export/render time. Exports feel "super long" after the crispness work.

---

## Why it's slow (the cost model)

- **Single-threaded encoding.** The multi-threaded ffmpeg core is disabled:
  `src/lib/ffmpegEngine.ts` → `MT_ENABLED = false` (it "crashed (2 concurrent)
  then hung (sequential) on the real export filter graph"). Everything runs on
  the ST core → ~2–4× slower than MT would be.
- **The whole timeline is re-encoded multiple times.** Encoding is the
  bottleneck, and `exportCut()` walks every frame through libx264 again on each
  pass: per-beat seg (captions) → **full** re-encode for title → **full**
  re-encode for start/end fade → **full** re-encode for overlays → music (copy).
- **Full re-encodes for localized effects.** We re-encode all ~46s just to burn
  a **3s intro title** or a **1–2s fade**. That's the biggest waste.
- **Preset.** Currently laddered `veryfast`/`faster`/`medium`
  (`src/config/editorDefaults.ts` `EXPORT_QUALITY_PROFILES`, default = `high` =
  `faster`). `faster`/`medium` buy little visible sharpness on wasm for a big
  time cost.

---

## Plan (do in this order)

### ☑ 1. Preset → `superfast` (immediate, ~most speed back, no quality loss)
- The blocky-text fix comes from **CABAC + deblocking**, both ON at `superfast`;
  runs at roughly `ultrafast` speed. `faster`/`medium` were overkill on wasm.
- Change `EXPORT_QUALITY_PROFILES` in `src/config/editorDefaults.ts`:
  - Standard → `superfast`, High → `superfast`, Maximum → `veryfast`.
- Verified: `npx tsc --noEmit`, `npx vitest run`.

### ☑ 2. Fold / localized re-encode for effects (durable ~2–4×, no quality loss)
Fold localized effects (fades, titles) into the per-beat segment rendering pass so there are ZERO post-concat full-timeline re-encode passes for titles or intro/outro fades.
- **☑ 2a. Intro title.** Folded directly into beat segment rendering (`seg_0.mp4` / `seg_i.mp4`). Title PNGs and animations (fade, slide) map onto beat segment filter graphs. Separate `titled.mp4` pass eliminated!
- **☑ 2b. Fades.** Folded intro fade (`fade=t=in`) directly into Beat 0 segment filtergraph and outro fade (`fade=t=out`) into last beat segment filtergraph. Separate `start_faded.mp4` and `end_faded.mp4` passes eliminated!
- **☑ 2c. Overlays.** Preserved lean pre-trimmed composite pass in `applyOverlaysToVideo`.

### ☑ 3. Collapse post-concat passes where safe
- Title overlay and intro/outro fades are folded directly into per-beat segment rendering. Post-concat re-encode passes eliminated!

---

## Parked (higher risk / bigger effort — not now)

- **☐ Re-enable the MT core** (2–4× multiplier). Blocked: crashed then hung on
  the real export graph (`MT_ENABLED = false` kill-switch). Needs real-clip
  validation; wasm SharedArrayBuffer threading is a deep rabbit hole. Requires
  cross-origin isolation (COOP/COEP) to be live too.
- **☐ WebCodecs / Mediabunny hybrid** — the real endgame (hardware encode). See
  `HYBRID_EXPORT_PLAN.md`.

---

## Constraints / do-not-break

- **Memory first.** ffmpeg.wasm OOMs when passes are combined too aggressively —
  the reason passes are split today. Don't merge two heavy re-encodes. See the
  "do NOT re-try" list in `EXPORT_OVERLAY_AUDIO_ISSUE.md`.
- **Text parity is done and must stay.** Titles + captions render via the shared
  canvas renderer (ADR-0008: `titleCanvas.ts` / `captionCanvas.ts`). Don't
  reintroduce drawtext.
- **Isolated engine per op** (`runIsolated`) caps peak memory — keep it.
- Every change: `tsc --noEmit` clean, `vitest run` (59 tests), AND a **real
  export smoke test** across the audio matrix (silent · beat audio · voiceover ·
  timed captions · overlay · each blend). tsc/tests do NOT exercise ffmpeg.

## Already done (context)
- Shared canvas title + caption renderers (preview↔export parity, ADR-0008).
- HiDPI preview canvases (crisp on retina).
- Export panel keeps state on close/reopen.
- Preset ladder introduced (currently `veryfast`/`faster`/`medium`) — **Task 1
  will step this back down to `superfast`.**
- All merged to `main` + `dev` at commit `b483b8c`.
