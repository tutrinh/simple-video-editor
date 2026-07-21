# Roadmap — Simple Video Editor

Phased build plan for the core loop: **ingest → analyze → author → assemble →
refine → export**. Vocabulary is defined in [CONTEXT.md](../CONTEXT.md);
constraints in [docs/adr/](./adr/). Both load-bearing bets are already validated
by throwaway spikes (see ADR-0001 and ADR-0002 validation sections).

## Data model spine (built in Phase 0, used everywhere)

```
Project   { clips: Clip[], direction?: Direction, cut?: Cut }
Clip      { id, file, name, durationSec, width, height,
            normalized?: Blob,            // 1080p normalized source (ADR-0002)
            description?: ClipDescription }
ClipDescription { subjectAction, settingMood, usability: 1..5, model, raw }
Cut       { beats: Beat[], aspect: "16:9" | "9:16" | "1:1" }
Beat      { id, clipId, inSec, outSec,
            durationSec,                  // derived from Script (ADR-0004)
            scriptText, captionText }
Story     { logline, orderedClipIds }     // authored intermediate
```

`Clip` and `Cut`/`Beat` are the load-bearing types; everything else hangs off
them. State lives in one store (reducer or Zustand) so any phase can read/write
the Project.

## Cross-cutting modules (Phase 0; shared, framework-agnostic TS)

- **`ffmpegEngine`** — isolated-instance wrapper (ADR-0002): one fresh engine per
  clip op, torn down after. Used by *ingest* (normalize) and *export* (render).
  Ports from `spikes/ffmpeg-export`.
- **`frameSampler`** — `<video>`+`<canvas>` frame grab, downscaled. Used by
  *ingest* (poster) and *analyze* (8-frame vision input). Ports from
  `spikes/vision-descriptions`.
- **`claudeClient`** — browser-side calls (key in client, ADR-0002); per-stage
  model config (cheap for analyze, stronger for author — ADR-0001).

---

## Phases

### Phase 0 — Foundation
**Goal:** a scaffolded app with the data model and the three shared modules.
**Builds:** Vite + React + TS scaffold (workspace convention); domain types;
Project store; `ffmpegEngine`, `frameSampler`, `claudeClient` with smoke tests.
**Deliverable:** empty app shell that loads; modules importable and unit-smoke green.
**Depends on:** nothing. **ADRs:** 0002.

### Phase 1 — Ingest
**Goal:** get clips in and normalized.
**Builds:** upload/drop; read duration + dimensions; **normalize 4K→1080p on
import** (`ffmpegEngine`); poster thumbnail (`frameSampler`); clip tray UI.
**Deliverable:** drop clips → see them listed with a poster frame; 4K clips
normalized with a progress indicator.
**Depends on:** 0. **ADRs:** 0002. **Risk:** normalize time/memory — mitigated by
isolated engine; needs progress UX.

### Phase 2 — Analyze  ← *first meaningful vertical slice*
**Goal:** each Clip gets a Clip Description.
**Builds:** sample **8 frames**; call vision model with the **filename as a hint**
(ADR-0001); parse into `ClipDescription` (subject/action, setting/mood, usability
1–5); show per-clip in UI; model selector (haiku default).
**Deliverable:** drop clips → see real Clip Descriptions + usability scores.
**Depends on:** 1. **ADRs:** 0001. **Note:** ports the validated spike prompt +
sampling rules directly.

### Phase 3 — Author (Story + Script)
**Goal:** turn Clip Descriptions into a Story and a per-clip Script.
**Builds:** author call over all `ClipDescription`s (+ optional **Direction**) →
`Story` (logline + ordered clip ids, weak clips dropped) and a **Script** segment
per kept clip; compute each segment's spoken length → target Beat duration
(**script-driven pacing**, ADR-0004).
**Deliverable:** "Generate" → proposed Story + ordered Script segments.
**Depends on:** 2. **ADRs:** 0001, 0004. **Note:** highlight arc (build-up →
climax → payoff) shapes the author prompt; filenames carry the beats.

### Phase 4 — Assemble (the Cut)
**Goal:** a visible, playable draft Cut of Beats.
**Builds:** convert authored order → `Beat[]`: pick each clip's in/out trim window
of the script-driven duration (v1: usable/start window; motion-aware later);
caption = script segment; timeline UI (ordered Beat cards); **in-browser preview**
(sequential playback, no full export).
**Deliverable:** a draft Cut you can watch.
**Depends on:** 3. **ADRs:** 0004 (Beat = trim + duration; no reuse/split).

### Phase 5 — Refine (propose-then-refine editor)
**Goal:** the human shapes the Cut.
**Builds:** manual edits (reorder Beats, edit caption, adjust in/out, drop/restore
clips); **full-Cut regenerate** with edited Direction (clean rebuild, warned);
**per-Beat AI nudges** ("rewrite caption", "re-pick trim", "swap clip") that touch
only that Beat.
**Deliverable:** the real editor.
**Depends on:** 4. **ADRs:** propose-then-refine; 0001 (Direction).

### Phase 6 — Export
**Goal:** one finished file.
**Builds:** render Cut via `ffmpegEngine` (isolated instance per Beat): trim →
scale/pad to chosen aspect (16:9 default, **letterbox** mismatches) → **burn
caption** → concat; audio = original + global mute + optional music bed;
progress UI; download. Plus **`.srt`/`.txt` Script export** (ElevenLabs-ready,
ADR-0003). Robust `drawtext` caption escaping.
**Deliverable:** exported 1080p captioned video + Script text file.
**Depends on:** 4 (Cut exists). **ADRs:** 0002, 0003.

### Phase 7 — Polish & hardening
Envelope warnings (>~15 clips / long footage); error/empty states; project
save/reload; multithreaded ffmpeg core swap (~2–4× faster export); model-config
surface. **ADRs:** 0002.

---

## Sequencing strategy

Phases are mostly linear (0→1→2→3→4→…). One deliberate choice:

**Build a minimal Export (Phase 6 core) right after Phase 4**, before the full
Refine phase. This gives a **walking skeleton** — ingest → analyze → author →
assemble → export end-to-end — early, so the whole pipeline is proven in the real
app before we invest in the richer editor. Then Phase 5 (Refine) and Phase 7
(Polish) enrich a system that already works front-to-back.

Recommended order: **0 → 1 → 2 → 3 → 4 → 6 (minimal) → 5 → 6 (full) → 7.**
