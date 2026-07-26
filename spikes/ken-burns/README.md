# Ken Burns spike — is `zoompan` fast enough in wasm?

Throwaway measurement for [ADR-0015](../../docs/adr/0015-ken-burns.md). Runs a
10s Still Beat segment (300 frames @ 30fps, 1920×1080 out) four ways through the
app's **own** `runIsolated` and self-hosted cores, so the numbers are the real
pipeline rather than a synthetic one.

Served by the main dev server — `yarn dev`, then open
<http://localhost:5174/spikes/ken-burns/index.html>.

## What it found

| case | seconds | × realtime | vs baseline |
| --- | --- | --- | --- |
| baseline (no move) | 31.4 | 3.14× | — |
| in-graph pre-scale 1.5× (2880w) | 48.2 | 4.82× | +53% |
| in-graph pre-scale 2× (3840w) | 56.9 | 5.69× | +81% |
| no pre-scale, raw 6000w | 51.8 | 5.18× | +65% |

**The 2× pre-scale — the version ADR-0015 originally specified — was the slowest
of the four, worse than no pre-scale at all.** `-loop 1` pushes 300 frames
through the graph and `scale` has no idea they are the same picture, so it
re-scaled one static image three hundred times. A cost that should be paid once
was being paid per frame.

The ADR was corrected: the pre-scale is now a single canvas `drawImage` before
the bytes reach ffmpeg (`renderStillContained`), and the emitted chain contains
no `scale` at all.

Also measured: a moving Beat is ~14× the bytes of a static one (1.1 → 15.1 MB),
independent of pre-scale. And the 31.4s baseline is 0.32× realtime, matching the
"~0.3× realtime" figure in `HYBRID_EXPORT_PLAN.md`.

## Still outstanding

**The corrected approach is projected at ~40s (+27%), not measured.** The four
cases above all pre-scale in-graph or not at all; none of them measures the
one-time-pre-scale path that actually shipped. Re-run this against the real
implementation before trusting that number.

Single-threaded throughout — `MT_ENABLED` is off by kill-switch in
`ffmpegEngine.ts`, so this is what users get.
