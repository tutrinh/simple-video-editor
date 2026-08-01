# Creator Notes are the only Evidence; Product Features are context

A Script line in a Review Plan carries **Evidence**: a reference to the Creator
Note it draws on. Evidence has exactly one kind, `creator-note`. The Product
Brief's Features — imported from a seller listing, then verified and edited by
the Author — ground nothing. They are context the Writer may describe.

Evidence is what permits first-person language. A line that speaks for the Author
without it is discarded during validation.

## Why the Brief stopped backing lines

The original model had two Evidence kinds, `product-claim` and `creator-note`,
and an invariant that every factual or first-person line must cite at least one.
It was abandoned because the product-claim half was ceremony rather than proof.

- **The citation was never checked against the sentence.** `validEvidence` only
  confirmed that the cited id existed in `brief.features`. A line could cite the
  stainless-steel Feature while asserting something else entirely and pass.
- **The unevidenced case rubber-stamped itself.** Any line the Writer left
  uncited was assigned `brief.features[0]` — the first Feature, chosen by
  position, related to the sentence only by coincidence. Most citations in a
  typical plan were this fallback.
- **It laundered the seller's assertions into the Author's.** A listing Feature is
  what the seller says. Presenting it in the same evidence UI as a Creator Note —
  the same badge, the same list — told the Author both had been vouched for. Only
  one had.

The distinction that survives is the one that matters legally and editorially:
**who is answerable for the sentence.** A Creator Note means the Author said it
about their own experience. Nothing else in the system carries that weight, so
nothing else should look like it does.

A later revision removed the positional fallback too. Evidence is now only ever
what the Writer explicitly cited and validation accepted, so every badge the
Author sees is true.

## Considered options

- **Keep both kinds.** Rejected: preserves the ceremony above. Making it real
  would mean checking a sentence against the Feature it cites — an entailment
  problem well beyond a normalizer.
- **Require at least one Creator Note before generating.** Rejected as a fix for
  this. It guarantees the fallback finds something to point at, which produces
  more false attributions, not fewer.

## Consequences

- **A factual line legitimately carries no Evidence.** Invariant 4 in
  `PHASE_2_PRODUCT_REVIEW_ARCHITECTURE.md` narrows to first-person lines only.
- **A project with Features but no Creator Notes produces a plan with no Evidence
  anywhere.** `saveVerifiedInputs` still accepts that combination. This is
  intended: the plan is honestly unattributed rather than falsely attributed.
- **Saved plans predate the narrowing.** Projects in IndexedDB can still hold
  `{kind:"product-claim"}` entries. The evidence badge filters to `creator-note`
  rather than branching on kind, so legacy entries render as no badge instead of
  `Creator · undefined`.
- **`ProductBrief.features` looks unused to a reader tracing grounding.** It is
  not — it reaches the Writer Prompt as context, and the "Emphasize product
  features and pros" toggle spends the reel's duration on it. It simply never
  appears in `evidence`.
