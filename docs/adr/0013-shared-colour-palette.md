# One Colour field, one global palette

Every place the editor picks a colour — a Title layer's `color`, a Sticker's
`tintColor` — renders the same `ColorField` component and reads the same
palette. A colour eyedropped while tinting a Sticker is there the next time a
Title layer is coloured, and in the next project.

## Why one palette rather than two swatch rows

Before this, `TitleTreatmentEditor` had a hardcoded `TITLE_SWATCHES` of three
(white, black, yellow) and the Sticker tint row had a different inline list of
seven. Neither could be extended, so a custom colour picked through
`<input type="color">` was used once and lost — you could not apply the same
colour to a Title and a Sticker without re-picking it by eye. Two hardcoded
lists is also two places to edit, and they had already drifted.

## Global, not per-project

The palette lives in `localStorage`, the way sticker favourites (ADR-0011), VO
presets and filter presets already do. **A colour the author reaches for is a
property of the author, not of one edit** — the same reasoning ADR-0011 applied
to favourites.

**The cost, accepted:** the palette does not travel in a `.vidstr`. A
collaborator opening the project sees their own palette, not the author's. If
that becomes a real complaint, the fix is a per-project palette layered over
this one, not a replacement for it.

## The stored list IS the palette

`loadPalette()` seeds from `DEFAULT_PALETTE` on first read and thereafter
returns exactly what is stored. Defaults are not a separate immutable tier, so
removing works uniformly on every swatch and the author can curate the row down
to the colours they actually use.

New colours **append** rather than sorting to the front: a palette that
reorders on every pick moves swatches out from under the cursor. The list is a
rolling `MAX_PALETTE` (20) that drops from the front when it overflows, which
is the one rule that keeps a bounded row without silently refusing to add.

## The eyedropper

The `EyeDropper` API samples a colour from anywhere on screen — including the
Cut preview, which is the point: tint a Sticker with a colour taken out of the
footage. It is Chromium-only, so the button is feature-detected and simply
absent elsewhere; `<input type="color">` remains, and carries the OS picker's
own eyedropper on macOS.

Anything picked through either route is added to the palette, since a colour
worth sampling is a colour worth reusing — that is the whole point of the
change.

## Consequences

- Three render sites collapse to one component: per-beat Titles (Inspector),
  cut-level Titles (Export), and the Sticker tint row.
- `ColorField` is presentational and takes `value`/`onChange`. It does not know
  what it is colouring, so the next thing that needs a colour gets the palette
  for free.
- A `usePalette()` subscription keeps every mounted `ColorField` in step: add a
  colour in the Sticker row and the Title row's swatches update without a
  remount.
