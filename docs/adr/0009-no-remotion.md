# Remotion is not adopted; the export speed path is WebCodecs directly

This is a React app that assembles and renders video, so a future reader will
reasonably ask why it doesn't use Remotion — the obvious React video framework.
It was evaluated in July 2026 and rejected. The speed win Remotion is wanted for
comes from WebCodecs + Mediabunny, which `HYBRID_EXPORT_PLAN.md` already targets
directly; the parity win it is wanted for does not survive contact with this
app's feature set.

## What was actually on the table

Only one Remotion variant is compatible with ADR-0002 (no backend): the
client-side renderer, `@remotion/web-renderer`'s `renderMediaOnWeb()`, which
encodes via WebCodecs + Mediabunny in the browser. Remotion's server-side and
Lambda renderers both require Node and headless Chrome, which ADR-0002
forecloses. Licensing is not a factor — Remotion is free for individuals and
organisations up to 3 employees.

Three motivations were considered: escaping `ffmpeg.wasm`, preview/export
parity, and export speed. Richer React-authored motion graphics
(`interpolate`/`spring`) — Remotion's strongest and most distinctive benefit —
was explicitly not wanted, which is what tips the balance.

## Why it was rejected

1. **`mix-blend-mode` is unsupported by the client-side renderer, and Overlays
   depend on it.** `StagePreview.tsx` and `FinalPreview.tsx` set `mixBlendMode`
   from an Overlay's blend mode; `export.ts` mirrors it with the ffmpeg `blend`
   filter. Under `renderMediaOnWeb()` every Overlay would silently composite as
   `normal`. Screen and multiply are shipped creative features, so this is a
   regression, not a rough edge.

2. **The parity argument inverts.** Remotion's `<Player>` renders real DOM;
   `renderMediaOnWeb()` *emulates* layout and styles onto a canvas and supports
   only a subset of HTML and CSS. That is the same class of preview-vs-export
   seam this app already has — but relocated into an experimental alpha
   dependency where it cannot be fixed locally. ADR-0008 bought parity *by
   construction* (one canvas renderer called by both sides). Trading that for
   parity by vendor promise is a downgrade.

3. **`ffmpeg.wasm` would not actually leave.** With no home for blend
   compositing, either Overlays lose their blend modes or an ffmpeg stage stays.
   The second option means running Remotion *and* WebCodecs *and* `ffmpeg.wasm`
   — three engines where there are currently two.

4. **The speed is available without the framework.** `renderMediaOnWeb()` is
   fast because of WebCodecs and Mediabunny. `HYBRID_EXPORT_PLAN.md` already
   specifies exactly those two libraries, feature-detected with a clean
   `ffmpeg.wasm` fallback. Remotion is a large intermediary between this app and
   a speed win it can reach on its own.

5. **Other subset gaps.** No `z-index` (element ordering only), no
   `backdrop-filter`, no 3D transforms, no `OffthreadVideo`. CSS filters — the
   whole colour-grading model behind `cssFilterFor()` — are unsupported in
   Safari/WebKit under the web renderer.

## Cost, had it been adopted

Full adoption displaces roughly 4,280 lines: all of `src/features/export/`,
`StagePreview.tsx`, and `ffmpegEngine.ts`. Beats, Captions, Titles, Overlays,
transitions, zoom, and the audio mix (Voiceover ducking, Music bed, SFX) would
all be re-expressed as Remotion compositions, on an alpha API, to reach feature
parity with a pipeline that already works. Adopting `@remotion/player` for
preview alone is cheaper but strictly worse: it adds a third rendering engine
and widens the very seam it would be adopted to close.

## What would reopen this

`renderMediaOnWeb()` gaining `mix-blend-mode` and leaving alpha, or this project
wanting React-authored motion graphics enough to pay the rewrite. The second is
the more likely trigger — that is the benefit Remotion genuinely has and this
app currently does not want.
