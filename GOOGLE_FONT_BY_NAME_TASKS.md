# Google font by name — Task Tracker

Type a family name in the Font picker and the editor fetches it. The family
rides inside the existing `fontId` as `google:Anton`, so nothing else changes
shape. Decisions and rationale in
[ADR-0014](./docs/adr/0014-google-font-by-name.md).

**Binding constraint: two seams only.** Font resolution already funnels through
`findFontById` (the CSS family) and `getTitleFontBytes` (the TTF bytes). Those
two learn the `google:` form; `titleCanvas`, `export.ts` and `FinalPreview` stay
untouched, because they already consume only the family and the bytes. **No new
field on `TitleLayerSettings`** — a sibling field would need adding to the
`.vidstr` package, title presets, the style clipboard and every layer literal,
and one missed path is a font that silently reverts on reload.

**Working rule:** one task at a time — implement → tests → validation gate →
next. `npx tsc --noEmit` clean at every gate. No commits (per session
instruction).

---

- [x] **Task 0 — Docs.** ADR-0014 and this tracker.
  _Gate:_ ✅ files exist.

- [x] **Task 1 — The id form.** In `googleFonts.ts`: `GOOGLE_FAMILY_PREFIX`,
  `googleFamilyId(family)`, `parseGoogleFamilyId(id)`, `slugifyFamily(family)`
  (the Fontsource slug — lowercased, spaces to hyphens) and
  `syntheticGoogleFont(family)` building a `GoogleFontOption` with the right
  `cssFamily`, `googleFontName` and `fontsourceSlug`. All pure.
  _Tests:_ round-trip `googleFamilyId` → `parseGoogleFamilyId`; the parse
  rejects a bare id, an empty family and a non-prefixed string; slugs for
  one-word, multi-word, mixed-case, extra-whitespace and punctuated names;
  `syntheticGoogleFont` quotes the family in `cssFamily`, `+`-encodes
  `googleFontName` for the Google CSS API, and its slug matches
  `slugifyFamily`; a family containing a colon does not break the round-trip.
  Plus the regression guard that matters most: `slugifyFamily` reproduces every
  `fontsourceSlug` the built-in list declares by hand, which is what confirms
  the convention is right.
  _Gate:_ ✅ vitest (17) + `tsc`.

- [x] **Task 2 — The two seams.** `findFontById` returns the synthetic option
  for a `google:` id; `getTitleFontBytes` builds the same option and hands it to
  `fetchGoogleFontBytes` before its system-font fallthrough. `ensureGoogleFontLoaded`
  works unchanged on a synthetic option, so the preview stylesheet comes free.
  _Tests:_ `findFontById` on a `google:` id yields the family's `cssFamily` and
  is still correct for the built-in and system ids; an unknown id still returns
  undefined.
  _Also:_ `ensureFontLoadedById` replaced the hand-rolled
  `GOOGLE_TITLE_FONTS.find(...)` in both preview effects — they only loaded
  stylesheets for LISTED fonts, so a typed family would have previewed in the
  fallback face. `curFamily` for the weight swatches now routes through
  `findFontById` for the same reason.
  _Gate:_ ✅ vitest (22) + `tsc` + `yarn build`.

- [x] **Task 3 — Probe.** `probeGoogleFamily(family)` checks the Fontsource CDN
  and returns whether the family resolves to real uncompressed font bytes,
  reusing the same content-type and WOFF-magic checks
  `fetchGoogleFontBytes`'s tier 2 uses. Needed because that function ends in a
  guaranteed `title-sans.ttf` fallback, so a typo is otherwise undetectable —
  it renders in the wrong font instead of failing.
  _Tests:_ the response checker is pure and split out — accepts a real TTF
  header, rejects an HTML error page, rejects WOFF/WOFF2 magic bytes, rejects a
  too-short body, rejects a non-ok response.
  _Gate:_ ✅ vitest (27) + `tsc`.

- [x] **Task 4 — Picker UI.** A "Google font by name" field at the foot of
  `FontPicker`'s list: type a family, Enter or the button probes it, and on
  success the layer takes `google:<Family>` and the list closes. Failure says
  the family was not found and keeps the list open. In-flight state disables the
  control. A `google:` layer shows its family as the trigger label and as a
  checked row so the current choice is visible.
  _Gate:_ ✅ `tsc` + `yarn build`.

- [x] **Task 5 — E2E gate.** Full `vitest run`, `tsc`, `yarn build`.
  ⏳ Manual pass: type "Anton", confirm the preview restyles, export and confirm
  the burned-in title matches, save and reload the project, then try a
  misspelling and confirm it reports rather than silently falling back.
  _Gate:_ ✅ `vitest run` 379/379 across 31 files, ✅ `tsc`, ✅ `yarn build`.
  ✅ The premise was checked against the live CDN rather than assumed:
  `anton`, `bebas-neue` and `lobster` each return a 200 with sfnt magic
  `00010000` (35–103 KB), a bogus slug returns 404, and the response carries
  `access-control-allow-origin: *` so the browser fetch is not blocked.
  ⏳ Manual pass still pending — none of the UI has run in a browser.
