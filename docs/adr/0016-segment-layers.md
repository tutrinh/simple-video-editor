# A Layer is composited onto a Segment; the picture itself is not a Layer

Four things are composited onto a Beat's exported Segment — a Caption, a Title
overlay, a B-roll Overlay and a Sticker. They become **Layers**: adapters over
one interface, assembled by a module that owns input ordering, index assignment,
label naming, and which stage emits `[v]`.

Zoom, Ken Burns, rotation and the Grade are **not** Layers.

## Why the boundary sits there

The tempting version is "everything is a Layer" — one thing assembles a Segment,
no special cases. It was rejected because the base and the composites are not
the same kind of thing:

- Ken Burns **replaces** `scale`+`pad` (ADR-0015). It is not laid over the
  picture; it *is* how the picture is produced.
- The intro Zoom **forks** the stream — `split=2`, zoom one branch, overlay it
  back with an `enable` window.
- The Grade is a `lut3d` applied inside the base chain, reading a sidecar file
  that consumes no input index at all.

To hold those, the interface would need to express "I am the source" and "I fork
the stream" — concepts no other member uses, added so one member fits.

**This codebase already shows what that pressure does.** `SegmentTitleOverlay`
is declared `{ pngName: string; filter: string }`, and `filter` is then stuffed
with an *object* through `as any` at both push sites and read back with a third
`as any`. The declared type is a lie in three places because the shape did not
fit and was forced rather than widened honestly. A Layer interface stretched to
cover the base would be the same failure one level up.

Keeping the base out costs little: it emits into `baseLabel`, and the module owns
every index and every label after it. All six of the scattered decision sites are
downstream of the base, so the seam covers the whole problem it was drawn for.

**The boundary keeps paying.** It also settles, with no special case, whether the
Grade's `grade.cube` needs modelling as an input-that-is-not-an-input: it does
not, because it belongs to the base. Every Layer's file is indexed, by
definition. A boundary that answers later questions without exceptions is
usually in the right place.

## What the module hides

The scattered knowledge, as it stands today, is:

- **Four hand-derived index formulas** — `1 + capCount + k` for titles,
  `1 + capCount + titleCount + ovIdx` for overlays, `stickerIdxBase + k` for
  stickers, `stickerIdxBase + stickerCount` for audio.
- **Six `isLast` sites** deciding who emits `[v]`, each encoding the population
  of every *later* stage.
- **One argv concatenation** that is the only place the real input order exists.

None of it fails at compile time. A missed edit produces either an opaque wasm
ffmpeg error or — worse — a graph that succeeds and composites the wrong bitmap.

The interface is deliberately narrow:

```ts
{ inputs, inputArgs, chains, inputCount }
```

`inputCount` is the single number that leaks, because the audio input is appended
after the video ones and would otherwise re-derive the video layout.

Encoder flags, quality profile and the audio chain stay outside: they change for
different reasons, and both retry ladders (`gbrp`→`null`, `source`→`silent`)
retry with *different args over the same graph*. The graph should not know
retries exist.

## Consequences

- **`rgbFormat` is a parameter of the whole builder**, so the retry produces two
  complete, internally consistent graphs. Today the base/caption/title chains are
  built once *outside* the retry while overlay/sticker are rebuilt *inside* it,
  which means half the `[v]` decisions are frozen before the other half is made.
- **Cut-level and per-Beat Title collapse into one Layer kind.** They are
  currently a 45-line near-copy differing only in time base. One kind cannot have
  two code paths, so the duplication dies as a consequence rather than as a task.
- **The `as any` triple-cast goes with it**, since a real Layer type has an
  honest place to put that data.
- A new kind of composited thing becomes one adapter appended to a list, rather
  than six coordinated edits with no compile-time safety net.
- **`Segment` is deliberately not a glossary term.** It is a pipeline artifact —
  one Beat rendered to `seg_N.mp4` before concat — that the author never
  encounters. It is defined in the module header instead. `Layer` *is* a glossary
  term, because it names something the author already manipulates four instances
  of.
