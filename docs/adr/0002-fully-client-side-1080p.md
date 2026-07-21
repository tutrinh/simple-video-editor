# Fully client-side; Claude key in the browser; export capped at 1080p

This is a personal, local tool. All three heavy jobs run in the browser:
frame extraction and final render via `ffmpeg.wasm`, and the Claude API called
directly from the client. There is no backend.

Two consequences a future reader will question, recorded here as deliberate:

1. **The Claude API key lives in the browser.** Acceptable because this runs on
   the user's own machine. A public deploy would require a proxy (or a backend)
   to hide the key — revisit this ADR before shipping to strangers.

2. **Export is capped at 1080p; 4K source clips are normalized to 1080p on
   ingest.** `ffmpeg.wasm` runs in one tab under a ~2 GB WASM ceiling; a
   multi-clip 4K trim-and-concat with burned-in captions would OOM or crawl.
   Normalizing to 1080p on import keeps the whole pipeline in one memory-friendly
   space. True 4K output would mean a server-side render — the "no backend"
   decision here is what forecloses it. 1080p→4K upscaling is explicitly not
   offered (cost with no real detail gained).

Chosen over a thin serverless proxy (option C) and a full render backend
(option B) because keeping video local and running zero infra is worth more,
for this tool, than hiding the key or unlocking 4K.

**v1 envelope:** ~10–15 clips, a few minutes of total footage, 1080p out. The
app warns rather than silently failing past that.

## Validation (spike, throwaway)

`spikes/ffmpeg-export/` tested the render pipeline in a real browser.

- **Shared ffmpeg engine → crashes.** ffmpeg.wasm reuses one WASM heap across
  `exec()` calls and doesn't reclaim it; memory climbs per clip until it aborts
  (crashed on 11 clips).
- **Isolated engine per clip → survives.** Encoding each clip in a fresh FFmpeg
  instance that is `terminate()`d before the next (segment bytes held in JS
  memory between clips, final concat in its own engine) caps peak WASM memory at
  a single clip. 11 clips × 8s completed; peak JS heap 512 MB → 100 MB.

**Required build rule:** the exporter processes clips in **isolated engine
instances**, never one shared engine.

**Throughput (not viability):** ~19s per 8s clip on the single-threaded core
(~3.5 min for 11 clips). The multithreaded core is the first optimization
(~2–4× faster) but memory viability does not depend on it.
