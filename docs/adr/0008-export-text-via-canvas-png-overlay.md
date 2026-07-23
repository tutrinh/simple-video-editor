# Export text is rendered by the browser to a PNG, not by ffmpeg drawtext

Captions and Title overlays in the exported video are rendered with the
**browser's own text engine** — a single shared canvas-2D renderer — to a
transparent PNG, which ffmpeg then composites with `overlay`. ffmpeg no longer
draws any text; `drawtext` is removed from the export path.

## Why

The exported video did not match the in-app preview for text. The preview uses
the browser to lay out text; the export used ffmpeg `drawtext`. These are
different engines, and the gap is **structural, not tunable**:

- `drawtext` in this `@ffmpeg/core` build has no CSS `letter-spacing`
  (`tracking` crashes the filter with "Option not found").
- It kerns and shapes differently from the browser.
- It cannot wrap, so the export approximated wrapping with a glyph-width *guess*
  (`~0.5·fontsize`), which disagrees with how the browser wraps the same string.

No amount of tuning closes an engine mismatch. The only way to make the export
match the preview is to render both with the **same** engine.

## The decision, in parts

1. **Same engine, same code.** One canvas-2D renderer (`fillText` +
   `ctx.letterSpacing` + `measureText`-based wrapping) is the single source of
   truth. The preview draws with it; the export calls the identical function and
   captures the result as a PNG. Parity is by construction, not approximation.
2. **Export-pixel coordinate space.** The renderer always draws at full export
   resolution (e.g. 1920×1080). The preview shows that same bitmap CSS-scaled
   down, so both sides share one unit system and a wrap boundary can never flip
   between them.
3. **Static bitmap, motion on top.** Glyphs are baked once into a static PNG
   (identical on both sides). The preview animates that bitmap with a CSS
   transform/opacity transition; the export moves/fades it with matched ffmpeg
   `overlay` x/y/alpha expressions using the same linear easing. Caption cue
   windows are gated with `overlay:enable='between(t,a,b)'`.
4. **Arc titles reuse SVG.** Flat text uses canvas `fillText`; curved text
   (`arcDeg ≠ 0`) uses the existing SVG `textPath` → `drawImage`. Both cases
   live inside the one renderer and are called by both sides, so arc stays a
   single source of truth without new glyph-on-path math.

## Alternatives rejected

- **Keep tuning `drawtext`.** Rejected: cannot reach parity (no CSS
  letter-spacing, different shaping, guessed wrap).
- **SVG→PNG for export while the preview stays CSS.** Rejected: SVG text layout
  and CSS/HTML text layout are different browser engines and can still drift on
  wrapping and line-height. "Both browser" is not "same engine."
- **Full WebCodecs/Mediabunny hybrid** (see `HYBRID_EXPORT_PLAN.md`). Deferred:
  it is a large rewrite whose value is *speed*; parity does not require it. It
  can layer on later as a performance pass.

## Consequences

- ffmpeg's role in the text stages shrinks to compositing a pre-rendered PNG.
  The `drawtext` filters, the `wrapCaption` glyph-width heuristic, and the
  "tracking not supported" workaround all go away.
- The preview's caption must move from the CSS `.cap` `<div>` to the shared
  canvas renderer. This is a real change to `StagePreview` / `FinalPreview`, and
  it also closes today's *non-font* caption gaps (background box, wrapping,
  scale, line-height, opacity), which the plain preview span never showed.
- **Hard requirement:** the exact font must be loaded as a `FontFace` and
  `document.fonts.ready` awaited before any measure or draw, on both sides. If
  the canvas draws before the font resolves it silently falls back to a system
  font and `measureText` then wraps against the wrong metrics — parity is lost
  invisibly.
- Built on `0fbcf56` (`ffmpeg-multipass`), which carries the overlay/audio/
  magenta/timeout/multipass export fixes; the `FontFace` + PNG-title logic is
  ported from the `font-match` branch. Landed titles-first, captions-second.
