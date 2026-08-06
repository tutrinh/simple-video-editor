# A Cover is rendered by one canvas and keeps its own pixels

A **Cover** is a still captured from a Beat and dressed to advertise the Project.
Two decisions shape it, and they are the same stance stated twice: a Cover is
independent of the video pipeline.

1. **One renderer.** The canvas the author edits on *is* the canvas that
   downloads. There is no preview implementation and no export implementation —
   there is one function, called twice at different sizes.
2. **It keeps its pixels.** Capture stores the decoded frame as a File. It is
   never re-derived from the Beat it came from.

## Why one renderer, when nothing else here gets one

Every other visual surface in this app is rendered twice — CSS for the preview,
ffmpeg for the export — and the cost is documented at length. ADR-0008, ADR-0010
and ADR-0015 each declare a "one module, two emitters" rule and each implements
it *separately*, for its own property. Candidate B in
[ARCHITECTURE_BACKLOG.md](../../ARCHITECTURE_BACKLOG.md) counts **16 visual
properties computed twice** by two expressions that happen to agree, and lists
three occasions where the agreement failed in shipped code: rotation with an
inverted sign, Ken Burns focus off by a half-crop, and Overlays cropped in
preview but contained in export.

A Cover can escape this because **a still has no playback**. Playback is the only
reason a preview needs a `<video>` element and a DOM tree around it; remove it
and the reason for a second renderer disappears with it. This is not available to
Beats and never will be, so it is not a pattern to generalise — it is a property
to take while it is on offer.

Rejected alternatives:

- **A single frame through the ffmpeg pipeline.** The strongest possible parity
  claim: byte-identical to a frame of the exported video. Rejected because it
  boots ffmpeg.wasm to produce a JPEG, and `segmentGraph.ts` is shaped around
  video segments — a still would be threaded through a pipeline built for
  footage in order to gain parity with a video the Cover is not part of.
- **`ctx.filter = url(#svgFilter)` reusing `gradeSvgFilter`.** Would match
  `StagePreview` by construction. Rejected on two counts: `ctx.filter` with an
  SVG `url()` reference has uneven cross-browser support, and `gradeSvgFilter`
  is the *approximating* emitter.

## Colour comes from `gradePixel`, which is not a third emitter

The Cover greys its picture by running `gradePixel` over the canvas `ImageData`.
This does not violate ADR-0010's one-generator rule, because `gradePixel` **is**
the generator: it is documented at `grade.ts:333` as "the reference transform.
Both emitters derive from this", and `gradeCube` calls it per lattice point to
bake the export's `.cube`.

Applying it per pixel is therefore *more* faithful than the export, which
interpolates a 33³ lattice — the same gap `gradeCube.test.ts:121` accommodates
with `tolerance = 2 / CURVE_SAMPLES`.

## Why the pixels are kept

A Cover advertises a Project on a platform, and the author will re-open it weeks
later to adjust a headline. Storing `sourceBeatId + atSec` and re-decoding would
make that re-open conditional on the Cut still containing that Beat, that Beat
still containing that timestamp, and that Clip not having been swapped. Each of
those is a routine edit, and each would silently change or destroy a finished
Cover.

Keeping the frame makes a Cover a **leaf**: nothing upstream can reach it. The
provenance — `"Beat 2 @ 1.4s"` — is retained as a human-readable label only, so a
gallery of six near-identical captures can be told apart. It is never resolved.

Keeping the frame is also what lets a Cover's picture come from a **file the
Author uploads** rather than from a Beat at all, at no structural cost: an upload
is simply a Cover whose pixels arrived by a different door. Origin is therefore
**not modelled**. There is no `kind` discriminator, unlike `Clip.kind`, which
exists because a Still's duration, ffmpeg input and frame sampling all branch on
it. Nothing about a Cover branches after ingest — pixels are pixels — so origin
survives only as the `sourceLabel` text, `"Beat 2 @ 1.4s"` or `"sunset.jpg"`.

The one place the two differ is what they *seed*. A captured Cover inherits
`resolveGrade(beat, globalLook, intensity)`, because it is a frame of the graded
footage. An uploaded picture starts **neutral**: it is not that footage, and a
Look built to correct one camera is as likely to hurt an unrelated photo as help
it.

The frame is stored with its long edge capped at **3840 px**, both origins alike.
The largest canvas is 1920 px on the long edge and Zoom punches in up to 3×, so
3840 holds full per-pixel sharpness to 2× and softens only at the extreme. Left
uncapped, a 12-megapixel phone upload would put 5–10 MB into every autosave; at
the cap a Cover costs ~0.8–1.5 MB, carried by the same strip/reinject machinery
`userVoicePersist.ts` already uses for recordings.

## Consequences

- **The Grade must be applied before the Veil composites.** Both live on the same
  canvas, so running `gradePixel` over the finished `ImageData` would grade the
  Veil, the Stickers and the Titles as well. Order is load-bearing:
  crop → grade → Veil → Stickers → Titles.
- **A Cover does not follow a later re-grade of the Cut.** Its Grade is flattened
  once at capture via `resolveGrade(beat, globalLook, intensity)`. Deliberate —
  it is what "leaf" means, and re-grading a Cover by hand is a slider drag.
- **Split-screen gains a third layout encoding.** The layout geometry already
  exists twice in `splitScreenCanvas.ts` — as CSS grid templates and as a
  re-derived `cols`/`rows` if-chain — and the canvas compositor adds a third. It
  was deliberately *not* unified, to keep this feature away from the shipped
  encoder and its golden tests. See the defect below.
- **Building this surfaced a live export defect, since fixed.** `panX`/`panY`
  were honoured by the CSS preview and silently discarded by the ffmpeg export.
  Adding a third encoding is what made the disagreement visible. `crop` now takes
  x/y expressions from a shared `slotPanOffset()`, and a test binds the canvas
  renderer's effective displacement to the same function — so the three encodings
  disagree about layout in no way a test would miss.
- **Ken Burns needed no amendment.** It is a *moving* framing and a Cover cannot
  move, so a Cover reuses Zoom's scale-and-centre model unchanged and Ken Burns
  simply does not apply to it. The glossary took the new concept without either
  term shifting.
