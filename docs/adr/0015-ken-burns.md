# Ken Burns is a Still's moving framing, exclusive with Zoom, emitted by zoompan

A Still Beat can travel — drifting and pushing across its 10 seconds instead of
holding one frame. The move is its own concept rather than an animated Zoom, it
replaces the Zoom rather than composing with it, and one pure function of time
feeds both the preview and the export.

## Why not an end state on Zoom

A move is fully described by start (scale, focus) → end (scale, focus), and a
Beat's `zoom` + `zoomX`/`zoomY` already *is* a start state, so extending it was
tempting: one concept, no migration, and a static Zoom is just a move that
happens to end where it began.

It was rejected because the two are not the same idea wearing different values.
A Zoom is a framing decision — *what is in shot*. A Ken Burns is a motion
decision — *what the eye does over time*. Collapsing them means the control that
crops your shot and the control that animates it are the same control, and
"Ken Burns" degrades into a checkbox on a zoom slider.

## Why they are mutually exclusive

Both command the same thing: the scale and centre of the frame. Composing them
means the real starting scale is `zoom × kenBurnsStart`, so a 1.5× Zoom under a
1.0→1.2 move actually runs 1.5×→1.8× and every number in the UI lies about the
picture.

The alternative — let the move win and ignore the Zoom — was rejected on a rule
this codebase had just finished enforcing elsewhere: a control that is visible
and live-looking must not be inert. The Title layer checkbox was changed for
exactly that reason. So the two are a **mode**: a Beat's framing is static or
moving, and choosing one turns the other off.

## Why Stills only, for now

The mechanism would work on footage — a Still is only footage whose frames do
not change — but the quality story is not the same. Ingest normalises video to
1080p (ADR-0002) and deliberately does **not** normalise Stills (ADR-0012), so a
Still reaches the filtergraph at its native resolution while footage is already
capped. A push into a Still has real pixels behind it; the same push into video
is upscaling.

Ken Burns also exists *because* a Still has nothing else to give the eye. On
footage it is a flourish; on a Still it is the difference between a video and a
slideshow. Narrowing later is the hard direction, so v1 takes the narrow one.

## Why zoompan, and why the Still is pre-scaled first

The existing static chain cannot be animated into this. `zoomChain` emits
`scale,crop`; `crop`'s x/y animate under `eval=frame` and give a *pan*, but
zooming needs the crop size to change per frame and then be rescaled, and
`scale` does not reliably take per-frame output dimensions. Pan-only is easy;
pan-and-zoom that way is a dead end. `zoompan` is the filter for this and is
compiled into both self-hosted wasm cores.

`zoompan` truncates its x/y to whole pixels per frame, so slow pans can step
visibly. The mitigation is to give it more pixels than the output needs, and to
bound the cost: without a cap the per-frame work would scale with whatever the
author happened to drag in, so a 50MP scan and a 12MP phone photo would export
at wildly different speeds.

**The pre-scale happens ONCE, before the image reaches the filter graph** — a
canvas `drawImage` to the target size — and the chain that follows contains no
`scale` at all.

This is not a detail. The first draft of this ADR put `scale=3840:2160` in the
filter chain ahead of `zoompan`, and the spike measured that as **the slowest of
four options — worse than no pre-scale at all** (56.9s vs 51.8s on a 10s Still).
The cause is that `-loop 1` feeds 300 frames through the graph, and the filter
has no idea they are the same picture: it re-scaled one static image three
hundred times. A cost that should be paid once was being paid per frame, and it
outweighed everything the smaller input saved.

The measured shape, against a 31.4s no-move baseline:

| approach | cost |
| --- | --- |
| in-graph pre-scale 2× | +81% |
| no pre-scale, raw 6000px | +65% |
| in-graph pre-scale 1.5× | +53% |
| **one-time pre-scale, no in-graph scale** | **~+27%** |

**Size, not just speed:** the pre-scale target is 2× the canvas width, never
upscaling past the source. One integer step at 3840px is half an output pixel.
It is worth being honest that 2880px gives 0.67px and is also sub-pixel — the
two are close, and neither rescues a genuinely slow pan, where the move advances
under a pixel per frame and positions repeat regardless of input size. Pre-scaling
moves that threshold; it does not remove it. Sub-pixel sampling would, which is
why the canvas/WebCodecs path in `HYBRID_EXPORT_PLAN.md` is the eventual answer
rather than a larger number here.

**The zoom ceiling is available pixels, not a fixed number.** An earlier draft
capped a move at 2×; that was wrong, because a 3:4 photo needs ~2.37× merely to
fill a 16:9 canvas, and a flat cap would have forbidden the most useful preset.

## Why one function of time, used two ways

ADR-0008 and ADR-0010 both landed on one module with two emitters, and the
per-Beat rotation once shipped with an inverted sign because preview and export
were computed separately. So `kenBurnsAt(move, t01)` is the contract.

It is not ticked per frame. It **generates** the CSS keyframes for playback —
GPU-smooth, no per-frame JS — and is **sampled directly** while paused or
scrubbing. That second path is not redundancy: a running CSS animation cannot be
scrubbed, and the Still preview and the trimmer both have working scrubbers.

## Why linear, with no easing field

For keyframes and `zoompan` to agree, the interpolation must be exactly
expressible in both. Linear is `start + (end-start)·t` in CSS and in `zoompan`
frame arithmetic. A `cubic-bezier` is not, so easing would mean sampling the
curve into N stops on one side and N piecewise segments on the other, and then
arguing about N — machinery to hide the fact that easing is imperceptible on a
1.2× drift across ten seconds.

No `easing` field is stored. Adding one later is close to free here: an absent
optional field means "the old default", which `Clip.kind` (ADR-0012) and the
`google:` font id (ADR-0014) have both already demonstrated on persisted types.
A field with one legal value is a promise not yet kept.

## Why 1.0 means contain

Zoom 1× today means the frame untouched, letterbox bars and all. If Ken Burns
1.0 meant "fill the canvas", two scales would share a number and mean two
different pictures, and switching modes would silently reinterpret every value.

The cost is that a portrait Still in a 16:9 canvas starts mostly black, which is
common. A **Fill preset** computes that Still's exact cover scale instead — so
filling the frame is one click, but it is the author's decision rather than the
tool silently cropping their photograph.

## Consequences

- `zoompan` runs **before** the `pad` that letterboxes to the canvas. After it,
  the move would scale and slide the black bars themselves.
- The move is stored as start/end, never as a rate, so retrimming a Beat re-fits
  it — the same journey, faster. This follows the Sticker `fitToBeat` rule
  (ADR-0011): derived at read time, never written back, so a retrim cannot leave
  a stale duration behind.
- Six values are stored even though v1 also ships presets, so presets stay a UI
  affordance rather than a data model. Manual sliders need no schema change.
- Export time for a Still Beat rises by roughly a quarter — measured, not
  estimated. This is the feature's real cost and is bounded, not eliminated, by
  the pre-scale.
- **The exported file grows about 14×** for a Ken Burns Beat (1.1 MB → 15.1 MB
  on a 10s Still). A static Still compresses to almost nothing because every
  P-frame is empty; a moving one changes every macroblock. Those bytes flow into
  the concat and the final mux, so this is an export-wide cost rather than a
  per-Beat one, and it is independent of the pre-scale — all three moving
  variants produced the same 15.1 MB.
- A Ken Burns Still is the strongest WebCodecs candidate in the pipeline: no
  decode (it is one image), the "filter" is a GPU `drawImage`, and only the
  encode is real work. Moving it there would also make the jitter question
  disappear, since canvas sampling is sub-pixel.
