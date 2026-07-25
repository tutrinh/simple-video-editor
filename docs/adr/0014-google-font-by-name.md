# A Google font by name is a `google:` font id, not a new field

Any family on Google Fonts can be used for a Title layer by typing its name.
The family is carried **inside the existing `fontId` string** as
`google:Anton`, rather than as a new `googleFamily` field on
`TitleLayerSettings`.

## Why encode it in the id

`fontId` is already an opaque string that round-trips everywhere a layer goes —
`.vidstr` project packages, title presets, the copy/paste style clipboard, and
the per-beat title layers on every Beat. A new sibling field would have to be
added to each of those paths and to every literal that constructs a layer, and
any one of them missed is a font that silently reverts on reload.

Encoding it in the id means **no schema change and no migration**: a project
saved with `fontId: "google:Anton"` reloads correctly through code that predates
this feature, because that code only ever passed the string along.

## The two seams

Font resolution already funnels through exactly two functions, so those are the
only places that learn the new form:

1. **`findFontById(id)`** → the CSS family, for the preview and the canvas
   renderer. A `google:` id yields a synthetic `GoogleFontOption` whose
   `cssFamily` is `'Anton', sans-serif`.
2. **`getTitleFontBytes(id, weight, file)`** → the TTF bytes, for the canvas
   renderer and ffmpeg `drawtext`. A `google:` id builds the same synthetic
   option and hands it to `fetchGoogleFontBytes`.

Everything downstream — `titleCanvas`, `export.ts`, `FinalPreview` — is
untouched, because it already consumes only the family and the bytes.

## No conversion step

`fetchGoogleFontBytes` already fetches uncompressed TTF from the Fontsource CDN
(`cdn.jsdelivr.net/fontsource/fonts/{slug}@latest/latin-{weight}-normal.ttf`),
and the slug is the family name lowercased with hyphens. That is precisely the
format ffmpeg wants, so "fetch and convert" is only a fetch — the tier that
makes this work has existed since titles did.

## Typos have to fail loudly

`fetchGoogleFontBytes` ends in a guaranteed fallback to `title-sans.ttf`, so a
misspelled family cannot be detected from its result — it renders in the wrong
font rather than failing. The picker therefore **probes** the CDN before
accepting a name, and reports "not found" instead of storing an id that will
quietly render as something else.

## Consequences

- Only families published to Fontsource/Google resolve. A commercial or
  personal font still needs the upload path, which is why both remain.
- Weight coverage varies per family. `fetchGoogleFontBytes` already falls back
  from the requested weight to 400, so asking for 800 on a 400-only family gets
  400 rather than failing.
- The bytes are fetched over the network at export time; the local `/fonts/`
  tier can never hold an arbitrary family. Offline exports keep working for the
  bundled fonts only.
