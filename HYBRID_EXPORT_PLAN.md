# Hybrid Export Architecture: WebCodecs + ffmpeg.wasm

**Status:** 📋 PLANNING  
**Created:** 2026-07-22  
**Owner:** Tu Trinh

---

## 1. Why hybrid?

The current export pipeline runs **everything** through `@ffmpeg/ffmpeg` (WebAssembly) —
decode, filter, encode, mux. This means every pixel is processed in software on the CPU,
running at ~0.3× realtime for complex operations. The bottleneck is clear:

| Operation | Current (ffmpeg.wasm) | With WebCodecs |
|-----------|-----------------------|----------------|
| Decode H.264 | CPU (WASM) | **Hardware (GPU/media chip)** |
| Encode H.264 | CPU (WASM, libx264) | **Hardware (VideoEncoder)** |
| Color grading / drawtext / blend | CPU (WASM) — **keep** | Not available in WebCodecs |
| Mux to MP4 | CPU (WASM) | **Mediabunny** (TypeScript, very fast) |
| Concat (stream copy) | CPU (WASM) | **Mediabunny transmux** |

**Goal:** Use WebCodecs/Mediabunny for the CPU-heavy encode/decode/mux work; keep
ffmpeg.wasm only for the filter-graph passes that WebCodecs can't do.

---

## 2. Browser support (July 2026)

| Browser | WebCodecs | Notes |
|---------|-----------|-------|
| Chrome/Edge 94+ | ✅ Full | Shipping since 2021 |
| Firefox 130+ | ✅ Full | Shipped mid-2025 |
| Safari 26+ | ✅ Full (audio+video) | Safari 16.4–18.7 was video-only |

**Fallback strategy:** Feature-detect `window.VideoEncoder`. If absent, fall back to
the current ffmpeg.wasm-only pipeline (zero regression for older browsers).

---

## 3. Current export pipeline (what to migrate)

The pipeline in `export.ts` has 8 sequential stages. Each is a separate
`runIsolated()` ffmpeg call:

```
┌────────────────────────────────────────────────────────────┐
│  Stage 1: Render beat segments (parallel pool)             │
│  Per-beat: -ss/-t trim → scale → pad → color filters →    │
│  drawtext captions → tpad → encode (libx264) → seg.mp4    │
├────────────────────────────────────────────────────────────┤
│  Stage 2: Concat segments (xfade transitions or copy)      │
│  Either: xfade filter graph (re-encode) or concat demuxer  │
├────────────────────────────────────────────────────────────┤
│  Stage 3: End fade (optional)                              │
│  fade=t=out filter → re-encode                             │
├────────────────────────────────────────────────────────────┤
│  Stage 4: Title overlay (optional)                         │
│  drawtext filter → re-encode                               │
├────────────────────────────────────────────────────────────┤
│  Stage 5: Overlay compositing (optional, B-roll/blend)     │
│  blend/overlay in gbrp → format=yuv420p → re-encode        │
├────────────────────────────────────────────────────────────┤
│  Stage 6: Overlay audio mixing (optional)                  │
│  amix filter → re-encode audio, copy video                 │
├────────────────────────────────────────────────────────────┤
│  Stage 7: Music bed (optional)                             │
│  amix filter → re-encode audio, copy video                 │
├────────────────────────────────────────────────────────────┤
│  Stage 8: Final blob output                                │
└────────────────────────────────────────────────────────────┘
```

**Key insight:** Stages 1, 2, 3 are the heaviest (every frame is decoded and
re-encoded). Stages 4–7 often copy the video stream (`-c:v copy`) and only touch
audio, except when a filter is applied. The biggest speed wins come from
**hardware-accelerating the decode/encode in Stages 1–3**.

---

## 4. Proposed hybrid architecture

### Philosophy
- **WebCodecs** handles decode → encode (the pixel-heavy path)
- **ffmpeg.wasm** handles filter graphs (drawtext, blend, xfade, color grading)
- **Mediabunny** handles muxing/demuxing (MP4 container I/O)
- Feature-detect at runtime; fall back to pure ffmpeg.wasm if WebCodecs unavailable

### Stage-by-stage migration plan

#### Stage 1: Beat segment rendering — HYBRID
The heaviest stage. Currently does trim + scale + color filters + captions + encode
all in one ffmpeg pass.

**Split into:**
1. **Mediabunny demux** → extract raw H.264 NAL units for the trim window
2. **WebCodecs `VideoDecoder`** → decode to `VideoFrame` objects
3. **Canvas/OffscreenCanvas** → apply scale, pad, color grading, and caption overlay
   using 2D canvas operations (CSS filters for color, `drawText()` for captions)
4. **WebCodecs `VideoEncoder`** → re-encode frames to H.264
5. **Mediabunny mux** → write to MP4 segment

> [!IMPORTANT]
> The canvas approach for captions/color gives us browser-native text rendering
> (proper font shaping, kerning, letter-spacing — fixing the `tracking` issue)
> and CSS filter support (matching the preview exactly). This is actually **better**
> than ffmpeg's drawtext.

**When to fall back to ffmpeg.wasm for Stage 1:**
- If the beat has complex filters that canvas can't reproduce
- If WebCodecs is not available

#### Stage 2: Concat — HYBRID
- **Without transitions:** Mediabunny transmux (stream copy, no re-encode) — very fast
- **With xfade transitions:** Keep ffmpeg.wasm (xfade is a complex filter graph).
  Alternatively, use WebGPU/canvas for crossfade rendering frame-by-frame, but
  that's a larger effort for Phase 2.

#### Stage 3: End fade — CANVAS + WEBCODECS
- Decode last N frames via WebCodecs
- Apply fade-to-black via canvas alpha overlay
- Re-encode via WebCodecs
- Transmux with Mediabunny

#### Stage 4: Title overlay — CANVAS + WEBCODECS
- Decode the relevant frames via WebCodecs
- Render title text on canvas (OffscreenCanvas) — supports all fonts, animations,
  curved text, letter-spacing natively
- Composite over video frame
- Re-encode via WebCodecs

> [!TIP]
> This eliminates ALL drawtext issues (tracking, quoting, font loading). The browser's
> own text engine handles everything the preview already shows.

#### Stage 5: Overlay compositing (blend modes) — KEEP FFMPEG.WASM
- Screen/multiply/overlay blend modes need per-pixel math on RGB components
- Could be done in WebGPU shader (Phase 2), but ffmpeg.wasm works now
- **No change in Phase 1**

#### Stage 6–7: Audio mixing/music — KEEP FFMPEG.WASM
- Audio filter graphs (amix, volume, adelay) are lightweight and fast
- WebCodecs `AudioEncoder` exists but doesn't provide filter graphs
- **No change** — these stages already copy the video stream

---

## 5. Migration phases

### Phase 1: Foundation + Biggest Wins (Recommended first)

| Task | Impact | Effort |
|------|--------|--------|
| Install `mediabunny` | — | Small |
| Create `webcodecs-engine.ts` abstraction | Foundation | Medium |
| Feature detection + fallback routing | Safety net | Small |
| **Stage 2 (concat without transitions):** Mediabunny transmux | 🟢 Fast concat | Small |
| **Stage 4 (title overlay):** Canvas + WebCodecs | 🟢 Fixes drawtext bugs | Medium |
| **Stage 3 (end fade):** Canvas + WebCodecs | 🟢 Fast fade | Small |

**Expected result:** Title rendering is browser-native (all fonts/animations work
perfectly), concat without transitions is instant, end fade is hardware-accelerated.
Stages 1, 5, 6, 7 unchanged.

### Phase 2: Full hardware-accelerated segment rendering

| Task | Impact | Effort |
|------|--------|--------|
| **Stage 1 (beat segments):** Mediabunny demux → WebCodecs decode → Canvas filters → WebCodecs encode → Mediabunny mux | 🔴 **Biggest speed win** | Large |
| Canvas-based color grading (brightness, contrast, saturation, hue, warmth) | Part of Stage 1 | Medium |
| Canvas-based caption rendering | Part of Stage 1 | Medium |
| WebCodecs audio decode + encode for segment audio | Part of Stage 1 | Medium |

**Expected result:** Beat segment rendering at ~5-10× realtime (vs current ~0.3×).
Export of a 60s video drops from ~3 minutes to ~10-15 seconds.

### Phase 3: Advanced optimizations (future)

| Task | Impact | Effort |
|------|--------|--------|
| **Stage 2 (xfade transitions):** Canvas/WebGPU crossfade | Eliminates last ffmpeg re-encode | Large |
| **Stage 5 (blend modes):** WebGPU shaders for screen/multiply/overlay | Hardware blend | Large |
| **Stage 6–7 (audio):** Web Audio API for mixing | Eliminates ffmpeg for audio | Medium |
| Remove ffmpeg.wasm dependency entirely | Smaller bundle, offline-first | — |

---

## 6. New dependencies

```bash
npm install mediabunny
```

Optional (if AAC encoding is needed outside ffmpeg):
```bash
npm install @mediabunny/aac-encoder
```

---

## 7. File structure

```
src/lib/
  ffmpegEngine.ts          # Existing — kept for filter-graph passes
  webcodecs-engine.ts      # NEW — WebCodecs decode/encode abstraction
  mediabunny-engine.ts     # NEW — Mediabunny mux/demux/transmux abstraction
  hybrid-router.ts         # NEW — Feature detection + routing (WebCodecs vs ffmpeg)

src/features/export/
  export.ts                # Existing — refactored to call hybrid router
  stages/
    segment-render.ts      # NEW — Stage 1 (WebCodecs path)
    concat.ts              # NEW — Stage 2 (Mediabunny transmux / ffmpeg xfade)
    title-overlay.ts       # NEW — Stage 4 (Canvas + WebCodecs path)
    canvas-filters.ts      # NEW — Color grading + caption rendering on canvas
```

---

## 8. Risks and mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| WebCodecs codec not available on device | Export fails | `isConfigSupported()` check → fallback to ffmpeg.wasm |
| Canvas rendering differs from ffmpeg drawtext | Visual mismatch | Canvas matches CSS preview better than ffmpeg did |
| Mediabunny container bugs | Corrupt output | Validate output with ffprobe; keep ffmpeg concat fallback |
| Memory pressure (VideoFrame GPU objects) | OOM/crash | `.close()` every VideoFrame immediately after use |
| Safari 26 WebCodecs edge cases | Export fails on Safari | Feature-detect per codec; test on Safari 26 |

---

## 9. Performance expectations

| Metric | Current (ffmpeg.wasm only) | After Phase 1 | After Phase 2 |
|--------|---------------------------|---------------|---------------|
| 30s video, no overlays | ~100s | ~80s | **~5-10s** |
| 30s video, title + music | ~120s | ~90s | **~15-20s** |
| 60s video, overlays + VO | ~5 min | ~4 min | **~30-45s** |
| Title rendering accuracy | ffmpeg drawtext (limited) | **Browser-native** | Browser-native |
| Bundle size | ~31 MB (ffmpeg.wasm) | ~31 MB + ~200 KB (mediabunny) | Same |

> [!NOTE]
> Phase 2 is where the dramatic speed improvement happens — hardware-accelerated
> encode/decode for every frame. Phase 1 is about foundation + quick wins + better
> title rendering.

---

## 10. Decision log

| Decision | Rationale |
|----------|-----------|
| Keep ffmpeg.wasm for blend modes | WebGPU shaders are complex; ffmpeg blend works correctly now |
| Keep ffmpeg.wasm for audio mixing | amix/adelay/volume are lightweight; no WebCodecs equivalent |
| Use Canvas (not WebGPU) for color grading | Canvas 2D is simpler, well-supported, and CSS filters match the preview |
| Mediabunny over raw mp4-muxer | Mediabunny is the maintained successor; handles both mux and demux |
| Feature-detect, don't hard-require | Zero regression for older browsers; progressive enhancement |
