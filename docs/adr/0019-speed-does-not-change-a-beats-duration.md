---
status: superseded by ADR-0020
---

# Speed does not change a Beat's duration

> **Superseded by [ADR-0020](./0020-footage-over-speed-is-the-master-clock.md).**
> Speed now sets the Beat's length. What survives from this record is the split
> between Speed and Fill, the 60fps ordering requirement, and how preview/export
> parity is held — all still in force.

A Beat carries a **Speed** — how fast its footage plays relative to the source —
and a **Fill** — what it shows once that footage is spent. Speed does not move
`durationSec`. The Script still sets the Beat's length (ADR-0004); slowing a Beat
shows *less* of its trim window rather than making the Beat last longer, and
speeding one up spends the window early and leaves Fill to cover the tail.

```
timelineSec  = outSec - inSec                       // how long the Beat runs
windowSec    = min(timelineSec, clipDuration - inSec) // footage that exists
slowedLength = windowSec / speed
gap          = timelineSec - slowedLength
gap > 0  → Fill decides: hold the last frame, or loop the trim window
gap ≤ 0  → the source is truncated at timelineSec; Fill is unused
```

The two lengths are not interchangeable, and the difference is the whole reason
Fill exists. `timelineSec` is how long the Beat occupies the Cut. `windowSec` is
how much footage there is to fill it, which is smaller whenever the trim window
runs past the end of the Clip. A Beat can therefore outlast its footage at Speed
1 — that case is exactly what the old implicit stretch existed to paper over.

`Beat.durationSec` is deliberately not in these formulas. The export has always
encoded `outSec - inSec` and never read `durationSec`, so using it here would
compute against a number nothing downstream honours.

## Why not the usual editor behaviour

In most editors slow motion lengthens the clip — footage is the clock. Here words
are the clock, and have been since ADR-0004. Letting a speed slider move
`durationSec` would make one Beat's length footage-derived while every other
Beat's stays Script-derived, and dragging that slider would silently reflow the
Caption schedule, the Voiceover fit, and the Cut's total.

The cost is real and worth naming: **slowing a Beat does not make the moment
last longer.** An Author who wants that must lengthen the Beat, and Speed then
decides how much of the trim window fills it.

## Why Speed and Fill are separate properties

An earlier shape had a single control that stretched footage to fit whatever
duration the Script asked for. It was rejected because it made speed a *result*
rather than a choice — the Author could not ask for 0.5× on footage that already
fit.

Splitting them keeps ADR-0015's rule that one property has one owner. Speed owns
how fast the footage plays; Fill owns only what happens after it runs out. They
never compose into a third, derived rate, so no number shown to the Author is a
lie. This is why Fill has no "slow" option: that would hand speed a second owner
and reintroduce exactly that.

## What this replaces

`export.ts` previously derived a hidden `speedRatio = segDur / footageLen` and,
when a Beat outran its footage, slowed the picture up to 2.5×, then looped, then
freeze-framed the remainder — none of it authored, and none of it in the domain.
Three surfaces disagreed about it:

| Surface | Behaviour |
| --- | --- |
| `export.ts` | slow ≤2.5× → loop → freeze |
| `StagePreview.tsx` | play trim at 1×, jump back to `inSec` |
| `Inspector.tsx` | told the Author "last frame holds" |

Speed and Fill give that mechanism a name, an owner, and one behaviour across all
three.

## Consequences

- **Saved Projects are migrated, not reinterpreted.** A Beat with a gap is
  rewritten on load to the values reproducing what it already exported —
  `speed = 1/ratio, fill = "hold"` where the old cascade slowed, `speed = 1,
  fill = "loop"` where it exceeded 2.5×. Existing work looks the same and the
  Author can now see and change it.
- **A slowed Beat's own audio is time-stretched** with `atempo`, chained for
  rates below 0.5× since one instance bottoms out there. The Beat's audio stays
  synced and pitch-corrected; previously it played at 1× and ran to silence.
- **Speed is unavailable on a Still.** Its picture is identical at any Speed, and
  Ken Burns travels across the *Beat* rather than the source (ADR-0015), so Speed
  must not touch it.
- **The offered Speeds are a UI constraint, not a domain one.** The slider walks
  `BEAT_SPEED_STEPS` — 0.5×, 0.75×, 1×, 1.5×, 2× — by index, so it can only land
  on a ratio that reads as deliberate. The model accepts any positive Speed, and
  `beatTiming` deliberately does not clamp to the steps, because migration
  produces arbitrary ratios like 0.31× that must still play back exactly. Naming
  the field `speed` rather than `slowMotion` is what let fast motion arrive as a
  slider change with no migration.
- **Every offered step reaches `atempo` in one instance.** The chain exists for
  ratios below 0.5×, which only migration now produces.
- **A 60fps source slows smoothly; a 30fps one cannot.** `setpts` runs before the
  encoder conforms to `PROJECT_FPS`, so slowing a 60fps Clip to 0.5× spreads its
  own frames across the longer window and lands one distinct source frame per
  output frame. Conforming first would discard half those frames and duplicate
  what remained. A 30fps source slowed to 0.5× has only half the frames it needs
  and must duplicate — inherent to the source, not to this design.

## How parity is held

`src/domain/beatTiming.ts` is the only place Speed and Fill become time. The
export builds its filter graph from `speedPlan`, and StagePreview seeks from
`sourceOffsetAt`; both come from that module. `speedParity.test.ts` then reads
the *emitted* filtergraph back, reconstructs the source offset it implies without
using the shared helper, and asserts it matches what the preview would show at
the same moment — so agreement is evidence rather than assumption.
