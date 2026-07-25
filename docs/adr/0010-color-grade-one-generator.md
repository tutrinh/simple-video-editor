# One grade generator drives both preview and export; a Look is a target, not an offset

Color had the same two-engine problem ADR-0008 fixed for text: the preview graded
with CSS filters and the export graded with ffmpeg `eq`/`hue`/`colorbalance`.
Those are different operations, not different tunings, so the export could not
match what the author saw. This ADR applies ADR-0008's principle — *same engine,
same code, both sides* — to color, and settles what a Look means when it is
applied across every Beat.

## The two faults

**Divergent math.** Preview used `brightness(1 + exposure/100)`, a multiplicative
gain; export used `eq=brightness=exposure/200`, an additive offset. At exposure
+50 the preview multiplied by 1.5 and kept blacks black while the export added an
offset that lifted them to grey. Contrast and saturation ran in gamma-encoded
sRGB on the preview side and YUV on the export side. Worst of all, split-tone —
added specifically so cinematic looks would be representable — had no preview at
all: CSS cannot tone-target, so the shadow and highlight axes were folded into
the global white balance at 0.4× as an admitted "directional hint" while the
export applied a real per-tonal-range `colorbalance`. The author graded the most
expressive part of the model blind.

**The Look was applied twice.** Deriving a Look set it as the global fine-tune,
and applying it to the Beats then wrote a per-shot matched grade to each one
without clearing the global. The two summed. `gradeBeatToLook` explicitly
instructs Claude to *"account for where the shot already sits… don't double up"*,
and the composition rule then doubled up anyway.

## The decision, in parts

1. **One generator owns the grade math.** A single TS module turns a Grade into
   a pixel transform, expressed as one channel-mixing step composed with one
   per-channel curve step. Nothing else computes color.

2. **The preview applies that transform natively via SVG filters.** The
   channel-mixing step is an `feColorMatrix` (saturation, hue, white balance);
   the per-channel step is an `feComponentTransfer type="table"` (exposure,
   contrast, split-tone). Both ride the CSS `filter` already on the `<video>`,
   extending the inline-SVG data-URI approach the white-balance matrix used.
   Split-tone becomes visible before export for the first time.

3. **The export bakes the identical composition into a 3D LUT.** The same
   generator writes a `.cube` consumed by ffmpeg `lut3d`, replacing the
   `eq`/`hue`/`colorbalance` chain outright — which is what removes the
   additive-vs-multiplicative exposure bug rather than tuning around it.
   `lut3d` and `haldclut` are compiled into the self-hosted core; `curves` is
   not, which is why a 1D-curve export filter was not an option.

4. **A Look is a target, not an offset.** Beats are graded *individually toward*
   a Look, because clips shot at different exposures and white balances need
   different corrections to land in the same place. Applying a Look to the Beats
   therefore clears the global fine-tune, and Undo restores both. The global
   adjustment survives only as a manual override.

5. **The composed value is clamped to ±100** — the range the sliders, the domain
   model, and the AI prompt are all defined in, and a bounded input the LUT bake
   requires.

## Alternatives rejected

- **Reconcile the math in place** (multiplicative exposure on both sides, a
  better split-tone fold). Rejected for ADR-0008's reason: no amount of tuning
  closes an engine mismatch, and CSS still cannot tone-target.
- **Shrink the model to what CSS expresses exactly** — delete the four split-tone
  axes. Rejected once `feComponentTransfer` proved split-tone *is* previewable.
  It also would not have delivered parity on its own: the surviving six axes kept
  the divergent exposure math and the sRGB/YUV split, so it needed the
  reconciliation work anyway, at the cost of the AI film look's most distinctive
  range and a migration for saved Looks and projects.
- **A WebGL grading pass in the preview.** Unnecessary — SVG filters cover the
  model without replacing the `<video>` with a canvas.
- **Defer to the WebCodecs migration** (`HYBRID_EXPORT_PLAN.md`), where one
  shader could grade both sides. Rejected as blocking a visibly-wrong shipped
  feature behind a large unstarted project. The generator is the artifact that
  survives that migration regardless.

## Consequences

- Grade values are authored against a LUT, so the bake's grid resolution becomes
  a real parameter: too coarse and gradients band, too fine and the `.cube` gets
  large. One LUT is baked per distinct Grade.
- The preview's SVG filter and the export's `.cube` must be regenerated from the
  same call. If they ever drift, parity is lost invisibly — the same hazard
  ADR-0008 flagged for fonts, and it warrants the same discipline of a single
  shared entry point.
- **One deliberate exception to "a Look is a target."** Deriving a Look and
  loading a saved reference no longer touch the global override, but *saving* a
  Look as a preset still activates it there. Selecting a preset is the manual
  override this ADR keeps, and a user who has just saved a Look is taken to want
  to see it. The consequence is accepted knowingly: values Claude derived to push
  *neutral* footage toward a reference land flat on every Beat, without the
  per-shot match `gradeBeatToLook` provides. "Apply to all beats" remains the
  correct path.
