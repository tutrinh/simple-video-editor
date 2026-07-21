# caption-font.ttf

Used for burned-in captions in the export (loaded same-origin, then written into
the ffmpeg filesystem — no CDN/CORS fragility).

**Current file is a copy of the local system Arial Bold**, grabbed as a fallback
because the open-font download was network-blocked in this environment. **Arial is
proprietary — replace `caption-font.ttf` with an open-licensed TTF (Roboto, Inter,
or DejaVu Sans; OFL/Apache) before distributing this app.** The exporter only needs
a valid `.ttf` at `/caption-font.ttf`; nothing else changes.

## fonts/ (title overlay)

`fonts/title-sans.ttf` (Arial Bold copy) and `fonts/title-serif.ttf` (Georgia Bold
copy) back the Sans-serif / Serif choices in the title overlay. **Both are
proprietary placeholders — replace with open-licensed sans/serif TTFs (e.g. Inter
+ Lora, or DejaVu Sans + DejaVu Serif) before distributing.** Users can also upload
their own title font per export, which needs no bundled file.
