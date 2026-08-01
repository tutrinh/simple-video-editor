# Caption Font Selection — Task Tracker

Captions are locked to one bundled face: `captionCanvas.ts` fetches `/caption-font.ttf`,
registers it as the family `caption-font`, and every caption draws with it. Titles, by
contrast, carry a `fontId` resolved through `lib/googleFonts.ts` (`findFontById` →
`cssFamily`, `ensureFontLoadedById`, `fetchGoogleFontBytes`) and registered for canvas by
`ensureTitleFontFace`. This gives captions the same treatment, reusing that machinery
rather than duplicating it.

**Captions draw on three surfaces, and all three must agree:**

| Surface | Renderer | File |
|---|---|---|
| Stage preview (Beat mode) | DOM `<div class="cap">` | `studio/StagePreview.tsx:723` |
| Cut preview / Export preview | canvas `drawCaptionBlock` | `features/export/FinalPreview.tsx:1243` |
| Export | canvas `renderCaptionToPng` → PNG overlay | `features/export/export.ts:630` |

Captions are composited as PNGs, not ffmpeg `drawtext`, so no font file has to reach
ffmpeg — the browser canvas only needs the family registered. That is what keeps this
much smaller than the title font path.

**Back-compat:** the default stays the bundled face, so existing projects render
identically until someone picks a font.

**Working rule:** one task at a time — implement → tests → validation → gate, then next.
`npx tsc --noEmit` clean at every gate. No commits until asked.

- [x] **Task 1 — Font resolution** (`features/export/captionFont.ts`): resolve a caption
      font id to a canvas family, falling back to the bundled face. Reuses
      `findFontById` / `fetchGoogleFontBytes` / `ensureTitleFontFace`. _Tests:_ id → family,
      default, unknown id. _Gate:_ vitest + tsc.
- [x] **Task 2 — Renderer** (`captionCanvas.ts`): `CaptionSpec.fontId`, used by
      `drawCaptionBlock` for `ctx.font` and therefore for `measureText` wrapping.
      _Gate:_ vitest + tsc.
- [x] **Task 3 — Setting** (`state/ExportSettingsContext.tsx`): `captionFontId`, defaulting
      to the bundled face, persisted like the other caption settings. _Gate:_ tsc.
- [x] **Task 4 — Thread it through**: `export.ts`, `FinalPreview`, and the DOM caption in
      `StagePreview` so all three surfaces match. _Gate:_ tsc.
- [x] **Task 5 — Picker**: reuse `studio/FontPicker` in Export's caption controls, beside
      size / underlay opacity / line height. _Gate:_ tsc + build.
- [x] **Task 6 — E2E gate:** full `vitest run`, `npx tsc --noEmit`, `yarn build`.

## Out of scope

- Caption **weight** selection — stays at the current 700. Bytes are fetched at that
  weight so the face matches what is drawn.
- Uploaded caption font files (titles support `fontFile`); this covers listed and
  typed-by-name Google families plus the system faces, which is what `FontPicker` offers.
- Per-segment caption fonts. This is one editor-wide setting, like the other caption
  controls.
