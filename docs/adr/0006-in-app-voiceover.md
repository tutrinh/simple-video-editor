# In-app voiceover via pluggable TTS engines

**Supersedes ADR-0003 (No in-app TTS).**

The app now **generates spoken narration itself**, reversing ADR-0003. The Script
is no longer only a portable text deliverable; it is spoken in the exported video
by an in-app engine, and the burned-in Captions are one carrier of the Story
among two (on-screen text *and* voice).

Voiceover dispatches to one of two engines behind a single interface:

- **Kokoro** — neural TTS running fully in-browser (ONNX/transformers.js). Free,
  needs no key, survives a static deploy.
- **ElevenLabs** — higher quality, via the dev proxy with a server-side key.

Narration is shaped by two pacing controls — **voice speed** and a **pause held
after each line** — and the finished audio is **mixed** (an optional music bed is
looped, trimmed, and ducked under the voice). Narration length remains the master
clock for a Beat's on-screen duration (ADR-0004 still holds; the trailing pause
extends the Beat, and footage freezes on its last frame to cover it).

The `.srt`/`.txt` Script export survives as a **secondary** path (hand the words
to an external VO tool), not the only one.

**Trade-off:** ADR-0003 kept the app out of the TTS business precisely to avoid a
synthetic-voice quality bar and an audio-mixing pipeline. We now own both. Accepted
because in-app narration is the product's payoff — a finished, spoken reel in the
browser, not a text file the user has to voice elsewhere.

**Consequence:** "voiceover", "voice", and "music bed" are now in-domain concepts.
The Script glossary entry no longer claims the app never generates audio.
