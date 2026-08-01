# Motivational Story — Persona Axis & Anti-Generic Prompt — Task Tracker

The generated motivational stories read generic because the prompt asks for a *category*
("viral motivational Reel") and gets that category's centroid. This adds **Persona** as a
first-class steer — orthogonal to Tone (voice) and Format (structure) — and rewrites
`authorMotivationalPrompt` around three anti-generic levers:

1. **One incident, not a montage** — the reel tells a single day / decision / ten-minute stretch.
2. **Specificity contract** — every line carries a filmable detail; the model must name it
   in a `concreteDetail` field; stock grindset phrases are banned outright.
3. **Footage grounding** — shots are written *from* clip evidence (ported from
   `features/author/author.ts:74`), not matched afterward.

A persona kills genericness only when it carries a concrete **world** (objects, hours, places,
sensations), not just a label — so presets ship speaker/audience/pov/world/vernacular, not a name.

Also fixes: `MotivationalStoryView` writes raw display labels into `settings.tone` /
`settings.scriptType`, which every other feature reads as *ids* via `toneHint()` /
`scriptTypeHint()`. That drops the motivational tone steer and silently corrupts the steer for
AI Story and Product Review.

**Working rule:** one task at a time — implement → tests → validation → gate, then next.
`npx tsc --noEmit` clean at every gate. No commits (per session instruction).

- [x] **Task 0 — Tracked task doc.** This file. _Validation:_ lists Tasks 1–6.
- [x] **Task 1 — Persona domain + presets** (`domain/motivationalPersona.ts`): `MotivationalPersona`,
      8 presets with world/vernacular, `personaById()`, `renderPersonaBlock()`, custom-persona support.
      _Tests:_ preset integrity + block rendering. _Gate:_ vitest + tsc.
- [x] **Task 2 — Prompt rewrite** (`features/motivational-story/storyAuthor.ts`): persona block,
      one-incident rule, specificity contract, ban list, footage grounding, `concreteDetail` in the
      beat schema + parser. _Tests:_ extend `storyAuthor.test.ts`. _Gate:_ vitest + tsc.
- [x] **Task 3 — Tone/format id fix** (`studio/MotivationalStoryView.tsx`): use `TONE_OPTIONS` /
      `SCRIPT_TYPE_OPTIONS` ids, send `toneHint()` / `scriptTypeHint()`. _Tests:_ regression test that
      settings hold ids. _Gate:_ vitest + tsc.
- [x] **Task 4 — Persona UI** (`studio/MotivationalStoryView.tsx`): persona select + POV override +
      custom persona fields in step 1. _Tests:_ render + selection. _Gate:_ vitest + tsc.
- [x] **Task 5 — Persistence**: persona + target duration into `MotivationalStoryWorkspace` and the
      saved-plan history; restore on load. _Tests:_ round-trip. _Gate:_ vitest + tsc.
- [x] **Task 6 — E2E gate:** ✅ `vitest run` 795/795 across 88 files, ✅ `npx tsc --noEmit`, ✅ `yarn build`.
      ⏳ Manual pass through the drawer against a live `claude -p` proxy still pending.

## Carried out beyond the persona work

Two parser defects were fixed because they directly undercut the "write from the footage" rule:
the positional `clips[i]` fallback (an omitted `matchedClipId` became an arbitrary clip, so the
labelled empty slot never appeared) and an invalid `capture: "close-up"` reaching the Cut through
an `as unknown as` cast. Enum values from the model are now coerced rather than cast.

`findGenericScriptLines` is wired as an advisory flag on weak beats. The second *sharpening call*
from the "Full" option — a follow-up request that rewrites only the failing lines — is NOT built.

## Still open (from the earlier read-through, untouched here)

- Saved-plan delete doesn't refresh the modal (`MotivationalStoryView.tsx` — `setHistoryOpen(true)`
  on an already-true value; React bails out).
- Silent-beat VO misalignment in `fitMotivationalStoryVoiceoversToLength` (index fallback grabs
  another beat's segment); same pattern in `product-review/applyReviewPlan.ts`.
- Duplicate clip selection across beats is silently dropped at apply time.
- Beat durations aren't normalized to the target length after generation.
- `startOver` in `StudioApp.tsx` doesn't unmount the motivational drawer, leaving a stale plan.
