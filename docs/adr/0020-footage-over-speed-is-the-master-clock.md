---
status: accepted
supersedes: ADR-0004, ADR-0019
---

# Footage over Speed is the master clock

A Beat is exactly as long as its footage takes to play at its Speed:

```
requested   = outSec - inSec
available   = clipDuration - inSec
windowSec   = min(requested, available)
timelineSec = round(windowSec / speed × PROJECT_FPS) / PROJECT_FPS
```

Speed therefore moves the Beat's length. Slowing a Beat makes it longer and the
Cut longer with it; speeding one up makes both shorter. The duration is snapped
to a whole frame so a Beat never ends mid-frame.

This supersedes **ADR-0004**, which made the Script segment's spoken length the
master clock, and **ADR-0019**, which held the Beat's length fixed and made Speed
change only how much of the trim window was seen.

## Why the clock moved

ADR-0004 chose words as the clock because the narrative is the product, and the
cost it accepted was that "a great 2-second moment may be stretched." Speed makes
that cost concrete and adjustable: an Author who wants a moment to last longer
now slows it, and the Beat lengthens to suit.

ADR-0019's rule — Speed shows less of the trim rather than lengthening the Beat —
held up for slow motion but broke down as soon as Speeds above 1 were offered. A
2× Beat with a fixed length spends its footage halfway through and then sits on a
frozen frame, which is not what anyone asking for fast motion wants. Making the
length follow the Speed removes the failure instead of decorating it.

## Consequences

- **Fill is unreachable.** It existed for a Beat that outlasted its footage, and
  a Beat sized to its footage never does. The field, the filter branches and the
  `speedPlan` handling are all retained — `beatTiming` cannot produce a gap, but
  a hand-built timing still behaves, and the guard costs nothing. The Inspector
  control was already conditional on a gap existing, so it simply stops
  appearing. `CONTEXT.md` keeps the term because a saved Project can still carry
  the field.
- **Migration preserves length, not picture.** A Project saved before Speed
  existed gets `speed = windowSec / requested`, which reproduces the length the
  Beat had. For shortfalls up to 2.5× that is also the exact Speed the old
  `setpts=ratio*PTS` produced, so the picture matches too. Past 2.5× the old
  export *looped*, which is unrepresentable now; those Beats slow instead. Length
  is what the rest of the Cut, the Voiceover and the Music are aligned to, so
  length is what is preserved.
- **`Beat.durationSec` is now a cache, not a source of truth.** The model derives
  the length; the stored field is kept in step by the Inspector so consumers that
  read it directly stay correct. Anything timing-critical should call
  `beatTiming`, which is what the export, the preview and the Cut totals do.
- **A duration preset now sizes the trim window, not the Beat directly.** Asking
  for a 3s Beat at 0.5× takes 1.5s of footage, so `resizeBeat` multiplies the
  requested length by the Speed before setting the trim.
- **Captions and Voiceover are consequences, not drivers.** With the Script no
  longer sizing any Beat, caption fit and VO length follow the Cut rather than
  shaping it. This is the largest downstream effect of the change and the part
  most likely to want revisiting.

## What is unchanged

`setpts` still runs before the encoder conforms to `PROJECT_FPS`, so a 60fps
source slowed to 0.5× still lands one distinct source frame per output frame.
Parity is still structural: `src/domain/beatTiming.ts` is the only place Speed
becomes time, the export and StagePreview both derive from it, and
`speedParity.test.ts` reads the emitted filtergraph back to prove they agree.
