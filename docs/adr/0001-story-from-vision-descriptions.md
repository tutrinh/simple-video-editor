# Story is discovered from per-clip vision descriptions, assuming non-speech footage

The product's core promise is that Claude discovers a Story *from the clips*.
Clips are **not** assumed to contain speech, so transcription is not the signal.
We rejected making the user tag/describe each clip (that shifts the "analysis"
onto the human and undercuts the value). Instead, we sample frames from each
Clip and send them to a vision-capable Claude model, which writes a **Clip
Description**; the Story, Script, and ordering are then reasoned from those
descriptions (optionally steered by an author **Direction**).

This is the one option where "Claude analyzes the clips" is literally true. It
costs a vision call per clip — the price of the value proposition. Silent b-roll
that needs deep visual understanding is served; footage whose story lives only
in its audio track is out of scope for v1.

**Consequences:** A high-volume, low-stakes per-clip description pass is a good
fit for a cheaper vision model (e.g. `claude-haiku-4-5`) even if story-authoring
uses `claude-opus-4-8` — model choice per stage is a config knob.

## Validation (spike, throwaway)

`spikes/vision-descriptions/` tested this on real footage (volleyball highlight
clips) using `claude -p` for the vision call (no API key needed for the spike).

- **The model is not the weak link.** Descriptions were concrete and specific —
  jersey colors/numbers, venue, distinct actions (warm-up vs. dig vs. attack).
- **Frame sampling is the weak link.** 4 evenly-spaced frames missed the
  decisive instant: a "kill" clip read as a routine set; a "win" clip missed the
  celebration. The peak often falls *between* evenly-spaced frames.
- **Two fixes, validated together:** ~8 frames instead of 4 caught the payoff
  (huddle, celebration), and passing the clip's **filename/label as a hint** let
  the model reason about the intended beat — it correctly narrated the
  rally→celebration arc and even flagged "the decisive kill lands between frames"
  instead of hallucinating the spike.

**Required build rules:**
1. Sample ~8 frames per clip (evenly-spaced as a floor; motion/scene-aware
   sampling to land the peak frame is a later refinement).
2. Feed the clip's filename/label to the vision call as a hint. This promotes
   the "optional user tag" idea to a first-class, high-value input — it carries
   the story beat the pixels sometimes miss. See [[direction]] / clip-level tags
   in CONTEXT.md.
