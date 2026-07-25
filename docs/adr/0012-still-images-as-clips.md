# A still image is a Clip with a synthetic duration, not a second kind of source

JPG/PNG/WebP stills import through the same door as footage and become ordinary
Clips. The only thing a still lacks is a length, so ingest **invents** one:
`STILL_CLIP_DURATION_SEC` (10s). Everything downstream — the trimmer, the beat
window maths, `preBeats`, the timeline — then reads a real number where it used
to read `0`, and needs no still-specific arithmetic.

## Why a synthetic duration rather than "duration = null"

A still's natural model is "no length", but `durationSec: 0` propagates as a
bug rather than a signal. `computeWindow` clamps with
`Math.min(target, clipDur)`, so a zero-length source collapses the Beat to
nothing; `preBeats` clamps `footageLen` against `clipDur - inSec`; the trimmer
divides by `dur` to place its handles. Each would need its own guard, and each
guard is a place a future change can forget the still case.

Giving the Clip a length instead means a still *is* a 10-second source as far as
every consumer is concerned. One field, `kind`, and one constant carry the whole
feature.

**The cost, accepted:** 10s is also the ceiling. A still Beat can be trimmed
shorter but not stretched longer, because the trimmer bounds itself by the
source. Raising the ceiling is a one-constant change; making it unbounded is a
different feature and is not v1.

## Where `kind` is actually read

`kind` is optional and `undefined` means video, so every project saved before
this ADR loads unchanged. Five places branch on it:

1. **Ingest** — `probeStill` via `<img>` instead of `probeVideo` via `<video>`,
   and no 1080p normalization pass (`normalizeTo1080p` runs libx264 and would
   turn a photo into a one-frame video).
2. **Beat window** — `computeWindow` gives a still the whole source window
   `[0, 10]` rather than a script-derived slice. ADR-0004 paces a Beat by its
   Script line because footage has a most-interesting moment to land on; a still
   has one frame, so pacing it by word count buys nothing and a predictable
   length is worth more.
3. **The three preview surfaces** — `<img>` where there is a `<video>`. The
   still cannot drive a clock, so `StagePreview`'s beat view and `BeatTrimmer`
   grow a rAF clock. `FinalPreview` already advances `beatElapsed` on rAF
   independently of the video element, so it only swaps the element.
4. **Export** — `-loop 1 -t {len} -r 30 -i in.jpg` in place of
   `-ss {in} -t {len} -i in.mp4`, and the segment's audio always comes from
   `anullsrc`. This is the same `-loop 1` treatment captions, Title overlays and
   Stickers already get (ADR-0008, ADR-0011); the filtergraph downstream of the
   input is byte-for-byte what a video Beat builds.
5. **The two vision paths** — `analyzeClip` and the per-beat AI grade take the
   Still's own frame rather than seeking a `<video>` to a timestamp.

## Consequences

- The Clip Bin accepts images, and its drop hint says so. A file that is neither
  is still ignored silently, as before.
- `sourceName()` must consult `kind` **before** `normalized`. On project import,
  `projectPackager` sets `normalized` to the original blob for every clip; a
  still would otherwise be handed to ffmpeg as `in.mp4`. The packager now leaves
  a still's `normalized` unset.
- A still Clip is described by Claude from its own single frame — `sampleFrames`
  returns that frame — so a still can be authored into a Story like any Clip.
- Beat rotation, zoom, colour grade, Stickers, Title overlays, Captions and
  transitions all apply to a still Beat unchanged, since they operate on the
  segment after the input stage.
