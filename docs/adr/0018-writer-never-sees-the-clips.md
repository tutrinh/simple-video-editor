# The Writer never sees the Project's Clips; Shot matching is the Author's

The Writer Prompt carries the Product Brief and the Creator Notes. It does not
carry the Project's Clips. The Writer therefore proposes a Shot List of things to
film and never proposes which existing Clip realizes a Shot.

Pairing a Shot with a Clip is done by the Author, from the per-Shot picker on the
plan review step.

## Why the Clips were withheld

The Writer used to receive a trimmed summary of every Clip — id, name, and the
Clip Description's `subjectAction`, `settingMood` and `usability` — and was asked
to set `matchedClipId` "only when the Clip Description visibly supports the Shot."

That instruction asked for a judgement the input could not support. A Clip
Description's `subjectAction` is capped at roughly fourteen words by design
(ADR-0007) — it is the signal a *Story* is built from, deliberately terse. Deciding
whether a specific fourteen-word summary depicts a specific requested Shot is a
finer-grained question than the summary was written to answer.

The failure was also asymmetric. An unmatched Shot is visible: it becomes a
placeholder, it is counted in the "N missing Shots" badge, and the Author is
prompted to film it. A *wrongly* matched Shot is invisible — it applies cleanly,
produces a Beat, and is only caught by watching the export and noticing the
footage does not show what the line claims.

Withholding the Clips converts a silent failure into an explicit choice. It also
shortens the prompt on every generation.

## Consequences

- **`normalizeShots` still validates `matchedClipId` against the Project's clip
  ids.** This looks like dead code and is not. It is a backstop that drops a
  match the Writer invents unprompted — including through an Author-edited Writer
  Prompt, which may reintroduce anything.
- **`ReviewShot.matchedClipId` stays in the domain type** and is still written,
  by the Author's picker and by `applyReviewPlan` when placing Beats. Only its
  *producer* changed.
- **Every Shot in a freshly generated plan is unmatched.** The missing-Shot count
  on the review step now equals the Shot count, and applying a plan produces a
  placeholder per Shot until the Author pairs them.
- **Clip Descriptions no longer influence the Script at all** in the product
  review path. They remain the primary signal for the main Story path, which is
  what ADR-0001 and ADR-0007 describe.
