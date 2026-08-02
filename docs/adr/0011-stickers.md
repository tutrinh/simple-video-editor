# Stickers are a Sticker track modelled on SFX, drawn by one shared canvas renderer

Stickers — PNG/SVG/WebP images placed over the Cut, freely positioned, scaled and
rotated — reuse two systems this project already has rather than inventing a
third. The library half copies the SFX track; the rendering half obeys ADR-0008.

## The library and track half: copy SFX

A Sticker's asset lives in the app-wide `stickers/` library at the repository
root, listed, streamed and uploaded through `/api/stickers` — a dev-server plugin that mirrors
`audioLibrary` exactly (`basename()` before joining so a request cannot escape
the folder, an extension allowlist, upload writing into the same folder so an
uploaded asset joins the library). `src/lib/stickerLibrary.ts` mirrors
`src/lib/sfxLibrary.ts` call for call.

A **Sticker** is a placement on `cut.stickers`, shaped like `SfxSegment` and
`OverlayClip`: an id, the asset's filename, an absolute `startTimeSec` and
`durationSec` on the Cut's timeline. `ADD_STICKER`/`UPDATE_STICKER`/
`REMOVE_STICKER`/`DUPLICATE_STICKER` mirror the SFX reducer cases including the
+0.5s offset on duplicate. Its timeline lane mirrors the SFX lane: drag to move,
drag the right edge to trim, duplicate and remove buttons on the chip.

The deliberate additions are the four spatial fields SFX has no need for —
`x`, `y` (centre, as a fraction of the frame), `scale` (fraction of frame width)
and `rotation` (degrees) — plus `opacity`, which `OverlayClip` already carries.

**Rotation is ±180°, not the ±15° of a Beat's rotation.** Those are different
concepts wearing the same word: a Beat's rotation straightens footage, where
anything past a few degrees is a mistake; a Sticker's rotation is placement, where
any angle is legitimate. Fractions of the frame rather than pixels keep a
placement correct across the 16:9 / 9:16 / 1:1 aspects.

## The rendering half: obey ADR-0008

A Sticker is drawn by **one shared canvas renderer** (`stickerCanvas.ts`,
mirroring `titleCanvas.ts`) that composes the asset onto a full-frame
transparent bitmap at export resolution. The preview displays that bitmap
CSS-scaled; the export hands the identical PNG to ffmpeg `overlay`, time-gated
with `enable='between(t,a,b)'` per Beat segment the way B-roll Overlays already
are. Parity is by construction — the same code produces both sides, so a
Sticker cannot land in a different place in the export than it did in the
preview.

Doing this any other way is the mistake ADR-0008 was written about. CSS
`transform` on an `<img>` in the preview and an ffmpeg `overlay` offset in the
export are different engines, and rotation plus scale about a centre point is
exactly the kind of geometry where they drift. ADR-0010 hit the same wall for
colour, and a per-Beat rotation shipped with an inverted sign because the two
sides were computed separately.

## Favourites

Favourites are filenames in `localStorage`, mirroring how `voPresets.ts` stores
its starred default. They sort to the top of the picker, the way custom
ElevenLabs voices already sort above stock ones. They are global rather than
per-Project: a Sticker the author reaches for often is a property of the author,
not of one edit.

## Consequences

- `stickers/` is a real directory in the repo, like `audio/`, `music/` and
  `overlays/`. It ships with a README and no assets.
- Projects persist only sticker filenames. Deleting a project removes its
  timeline placements but never removes assets from the shared library.
- SVG assets are rasterised through an `<img>` at export resolution before being
  drawn, so a large `scale` stays sharp — the one place a Sticker beats a
  pre-rendered PNG.
- A Sticker spanning a Beat boundary is composited into each Beat's segment with
  its own local `enable` window, the same treatment B-roll Overlays get.
