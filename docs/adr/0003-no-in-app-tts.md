# No in-app TTS — the Script is a portable voiceover deliverable

> **SUPERSEDED by [ADR-0006](./0006-in-app-voiceover.md) (in-app voiceover).**
> The app now generates and mixes audio itself. This ADR is kept for the record;
> its stance no longer reflects the product.

The finished video carries the Story to the viewer through **burned-in
Captions**, not spoken narration. The app never generates audio. The same
Script that becomes the on-screen Captions is also exported as narration text
(`.srt`/`.txt`) that the user can take to an external voiceover platform such as
ElevenLabs themselves.

This keeps the app out of the TTS business entirely — no voice selection, no
audio mixing pipeline, no synthetic-voice quality bar — while still giving the
user a clean path to add a voiceover downstream. It mirrors the stance taken on
music (the app arranges audio but doesn't source it): the app *composes the
words*, external tools *speak* them.

**Consequence:** Because a future voiceover should line up with the edit, Beat
durations are driven by the Script's spoken length (see ADR-0004), so the
exported Script drops into a VO tool already timed to the cut.
