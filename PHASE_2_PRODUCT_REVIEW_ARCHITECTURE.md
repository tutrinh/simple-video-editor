# Phase 2 — Product Review Drawer Architecture

> Product Phase 2 for VIDSTR's social-reel workflow. This is distinct from the
> historical “Phase 2 — Analyze” in `docs/ROADMAP.md`.

## Outcome

Add a right-side **Product Review** drawer where an author can:

1. paste a public Amazon product URL;
2. import and verify a Product Brief;
3. add Creator Notes about real use, audience, verdict, and disclosure;
4. ask the configured local AI provider to propose a Review Plan;
5. edit the generated Script and Shot List; and
6. explicitly apply the plan to the current Project.

The feature shortens the path from “I want to review this product” to a
filmable, vertical-reel plan. It does not publish to Amazon, post to a social
network, or represent seller-listing claims as independent facts.

## Product principles

- **Grounded, not invented.** Listing-sourced facts and creator experience are
  different inputs and remain visibly attributed.
- **Proposal before mutation.** Importing or generating never silently replaces
  the Story or Cut. “Apply to Project” is a separate action with a replacement
  warning when work already exists.
- **Useful without Amazon.** Manual Product Brief entry is a first-class adapter,
  not merely an error fallback.
- **Reel-shaped output.** The default structure is Hook → Problem → Demonstration
  → Proof → Verdict → CTA, constrained to 15, 30, 45, or 60 seconds.
- **Local-first AI.** Review generation reuses the existing Claude/Codex CLI
  proxy. Product facts and frames are not sent through browser-held API keys.
- **The author owns the claim.** Recommendation, personal result, durability,
  fit, taste, and “I used…” language require Creator Notes.

## Domain model

The canonical terms live in `CONTEXT.md`.

### Product Brief

An editable snapshot of listing-sourced product facts:

```ts
interface ProductBrief {
  source: {
    kind: "amazon" | "manual";
    url?: string;
    canonicalUrl?: string;
    asin?: string;
    fetchedAt?: number;
  };
  title: string;
  brand?: string;
  category?: string;
  description?: string;
  features: ProductClaim[];
  imageUrl?: string;
  priceText?: string;
}

interface ProductClaim {
  id: string;
  text: string;
  source: "listing" | "author-entered";
}
```

`priceText` is deliberately display text rather than money. Amazon prices are
volatile, localized, and sometimes account-dependent. It is excluded from the
generated Script unless the author explicitly confirms it for this recording.

### Creator Notes

The only input allowed to establish first-person experience:

```ts
interface CreatorNotes {
  audience: string;
  problem: string;
  experience: string;
  pros: string[];
  cons: string[];
  verdict: string;
  callToAction?: string;
  disclosure: "purchased" | "gifted" | "sponsored" | "affiliate" | "unspecified";
}
```

An empty field means “unknown,” not permission for the AI to fill the gap.
`unspecified` produces a visible warning before Apply; it does not cause the AI
to guess.

### Review Plan

The generated proposal:

```ts
interface ReviewPlan {
  id: string;
  productTitle: string;
  targetDurationSec: 15 | 30 | 45 | 60;
  hook: string;
  script: ReviewScriptSegment[];
  shots: ReviewShot[];
  disclosureReminder?: string;
  createdAt: number;
}

interface ReviewScriptSegment {
  id: string;
  text: string;
  purpose: "hook" | "problem" | "demo" | "proof" | "verdict" | "cta";
  approxDurationSec: number;
  evidence: ReviewEvidenceRef[];
  shotId: string;
}

type ReviewEvidenceRef =
  | { kind: "product-claim"; claimId: string }
  | { kind: "creator-note"; field: keyof CreatorNotes };

interface ReviewShot {
  id: string;
  description: string;
  capture: "talking-head" | "product-beauty" | "detail" | "demo" | "result" | "b-roll";
  framing: "wide" | "medium" | "close-up" | "macro" | "overhead" | "screen";
  approxDurationSec: number;
  matchedClipId?: string;
}
```

`evidence` preserves grounding from Script lines back to a Product Claim or a
specific Creator Notes field. A Shot remains a capture request until it is
matched to a Clip.

## Invariants

1. Amazon content may populate listing-sourced Product Claims only.
2. First-person experience may come from Creator Notes only.
3. The generator must not summarize or imitate Amazon customer reviews.
4. A generated line containing a factual or first-person claim must reference at
   least one valid `evidence` entry.
5. Price is omitted unless the author confirms it immediately before generation.
6. A Review Plan cannot mutate the Project until the author chooses Apply.
7. Applying a plan to a non-empty Story or Cut requires an explicit replace or
   keep-existing decision.
8. Missing footage becomes an unfulfilled Shot or an existing template
   placeholder; the generator never invents a Clip.
9. Imported fields remain editable because seller pages can be incomplete,
   personalized, stale, or incorrectly parsed.
10. The Project package stores the Product Brief, Creator Notes, and last Review
    Plan, but never stores Amazon cookies, credentials, or fetched HTML.

## Drawer experience

### Entry point and layout

Add a **Product Review** action to `TopBar`. It lazily mounts
`ProductReviewDrawer`, following the existing `AiStoryDrawer` lifetime rule:
mount on first open, remain mounted across close/reopen, and discard on
“Start over.”

The drawer is a 500px right-side docked column inside `.st-main`; it pushes the
workspace rather than obscuring the Stage. Only one right-side creation drawer
may be open at a time. Opening Product Review closes AI Story, and vice versa.
Export and Settings retain their current behavior.

### Four drawer states

#### 1. Import

- Amazon URL field
- **Import details** primary action
- **Enter manually** secondary action
- Loading, blocked-page, unsupported-domain, timeout, and malformed-page states
- No automatic generation after import

#### 2. Verify

- Editable title, brand, description, feature claims, image, and optional price
- Every imported value labeled “From listing”
- Remove/edit controls for claims
- “Verify before publishing” notice
- Creator Notes fields and disclosure selector

The author can proceed with a partially populated brief as long as `title` and
at least one Product Claim or Creator Note exist.

#### 3. Generate

- Target duration: 15 / 30 / 45 / 60 seconds
- Tone: reuse the existing Tone setting
- Format fixed to Product review
- Toggles: include price, include CTA, match existing Clips
- **Generate Review Plan**
- Progress stages: Grounding → Writing Script → Building Shot List → Matching Clips

#### 4. Review and apply

- Script segments grouped by purpose
- Shot cards paired with their Script segment
- Per-line grounding indicator
- Edit, reorder, regenerate-line, and rematch-shot actions
- Missing-footage count
- Disclosure warning
- **Apply to Project**

Apply offers:

- **Create new review Cut** — replace current Story/Cut after confirmation.
- **Save plan only** — persist the plan without touching the Cut.

A future phase may support merging a plan into an existing Cut. Phase 2 does not.

## Module architecture

```text
ProductReviewDrawer                         UI adapter
    │
    ├── importProduct(url)
    │       └── ProductSource module
    │             ├── Amazon link adapter ── local HTTP route ── public page
    │             └── Manual entry adapter
    │
    ├── generateReviewPlan(input)
    │       └── ReviewAuthor module
    │             ├── Claude CLI adapter
    │             └── Codex CLI adapter
    │
    └── applyReviewPlan(plan, mode)
            └── ReviewPlan application module
                    ├── Story
                    ├── Cut / Beats
                    └── template placeholders for missing Shots
```

### ProductSource module

The module hides URL normalization, page retrieval, extraction priority,
sanitization, and diagnostics behind one interface:

```ts
interface ProductSource {
  import(input: { url: string }): Promise<ProductImportResult>;
}

type ProductImportResult =
  | { ok: true; brief: ProductBrief; warnings: string[] }
  | { ok: false; reason: ProductImportFailure; manualSeed?: Partial<ProductBrief> };
```

Two adapters make the seam real:

- **Amazon link adapter:** best-effort extraction through the local Vite proxy.
- **Manual entry adapter:** normalizes author-entered fields into the same brief.

Extraction order:

1. schema.org `Product` JSON-LD;
2. Open Graph metadata;
3. stable semantic page fields;
4. partial result plus warnings;
5. manual entry.

The UI never parses Amazon HTML and never depends on Amazon selectors.

### ReviewAuthor module

The module accepts grounded domain data and returns a validated Review Plan:

```ts
interface GenerateReviewPlanInput {
  brief: ProductBrief;
  creatorNotes: CreatorNotes;
  clips: Array<Pick<Clip, "id" | "name" | "description" | "tags">>;
  targetDurationSec: 15 | 30 | 45 | 60;
  tone: string;
  includePrice: boolean;
  includeCta: boolean;
}

function generateReviewPlan(
  input: GenerateReviewPlanInput,
  author: ReviewAuthorAdapter,
): Promise<ReviewPlan>;
```

`generateReviewPlan` owns prompt construction, JSON parsing, normalization,
duration budgeting, claim validation, missing-shot handling, and one repair
attempt. The Claude and Codex adapters reuse `callClaude`; callers do not know
which CLI produced the result.

Prompt rules:

- use only supplied claims and Creator Notes;
- never infer ownership, use, results, price, sponsorship, or recommendation;
- keep the hook under two spoken sentences;
- write for spoken delivery, not a blog post;
- return strict JSON with stable IDs and evidence references;
- budget the sum of segment durations to the selected target;
- request shots that can be filmed on a phone;
- match a Clip only when its Clip Description visibly supports the Shot.

### ReviewPlan application module

A pure in-process module converts a confirmed plan into existing domain objects.
Its interface returns data rather than dispatching:

```ts
interface AppliedReviewPlan {
  story: Story;
  cut: Cut;
  placeholderClips: Clip[];
}

function applyReviewPlan(
  plan: ReviewPlan,
  clips: Clip[],
  aspect?: Aspect,
): AppliedReviewPlan;
```

Matched Shots become Beats using the matched Clip. Unmatched Shots become the
same template-placeholder shape already supported by `APPLY_TEMPLATE`. The
drawer dispatches one existing `APPLY_TEMPLATE`-style action after confirmation.

## Local product import route

Add `POST /api/product/amazon` to the Vite development middleware:

```json
{ "url": "https://www.amazon.com/.../dp/ASIN" }
```

The route returns normalized JSON, never raw HTML:

```json
{
  "brief": {
    "source": { "kind": "amazon", "canonicalUrl": "...", "asin": "..." },
    "title": "...",
    "brand": "...",
    "features": []
  },
  "warnings": []
}
```

### Retrieval safety

- HTTPS only.
- Explicit allowlist of supported Amazon hostnames.
- Reject credentials in URLs, IP literals, localhost, nonstandard ports, and
  non-Amazon shorteners.
- Validate every redirect target against the same allowlist.
- Fixed request timeout, redirect limit, and response-size limit.
- Accept HTML only; do not execute scripts.
- Do not forward browser cookies, Amazon credentials, or local request headers.
- Strip fetched HTML after extraction; do not persist or return it.
- Rate-limit repeated imports in the local process.

Amazon may return bot challenges, localized markup, consent pages, or incomplete
data. These are expected import failures, not exceptional application crashes.
The drawer preserves the URL and moves directly to manual entry.

### Amazon integration choice

Phase 2 uses best-effort public-page metadata because VIDSTR is currently a
personal, locally hosted tool. The ProductSource module keeps retrieval behind a
seam so a future Amazon Product Advertising adapter can replace it if credentials,
licensing, reliability, or hosted distribution justify that move.

## State and persistence

Extend `ProjectState` with an optional review workspace:

```ts
interface ProductReviewWorkspace {
  brief?: ProductBrief;
  creatorNotes: CreatorNotes;
  plan?: ReviewPlan;
  importWarnings?: string[];
}

interface ProjectState {
  // existing fields...
  productReview?: ProductReviewWorkspace;
}
```

Use reducer actions at domain granularity:

- `SET_PRODUCT_BRIEF`
- `SET_CREATOR_NOTES`
- `SET_REVIEW_PLAN`
- `CLEAR_PRODUCT_REVIEW`

Do not dispatch one action per form keystroke into specialized subfields. The
drawer owns transient form edits and commits coherent values to the Project
store on blur, generation, and Apply.

Update project autosave and project packaging with backward-compatible optional
fields. Imported product images remain remote references in Phase 2; they are
not embedded as Clips or package media.

## Error model

| Failure | Drawer behavior |
|---|---|
| Unsupported or unsafe URL | Keep input; explain supported Amazon links; offer manual entry |
| Amazon challenge/timeout | Preserve URL; open manual form; label import unavailable |
| Partial metadata | Populate what was found; show field-level warnings |
| AI unavailable | Preserve verified inputs; show current Claude/Codex configuration guidance |
| Invalid AI JSON | One repair attempt, then retain raw diagnostic without applying anything |
| Unsupported claim | Remove the line from the plan and show a grounding warning |
| No matching Clip | Keep the Shot as missing footage / placeholder |
| Existing Story or Cut | Require replace confirmation or save plan only |

## File plan

```text
src/domain/productReview.ts
src/features/product-review/productSource.ts
src/features/product-review/amazonProductSource.ts
src/features/product-review/reviewAuthor.ts
src/features/product-review/applyReviewPlan.ts
src/studio/ProductReviewDrawer.tsx
src/studio/ProductReviewView.tsx
src/state/projectReducer.ts
src/lib/projectStorage.ts
src/lib/projectPackager.ts
src/studio/StudioApp.tsx
src/studio/TopBar.tsx
src/studio/studio.css
vite.config.ts
```

If the Vite route grows beyond a small adapter, move local middleware out of
`vite.config.ts` into `server/productImport.ts`; do not let product parsing add
another large concern to the configuration file.

## Testing strategy

The module interfaces are the test surfaces.

### ProductSource

- URL allowlist and redirect validation
- Amazon canonical URL and ASIN extraction
- JSON-LD, Open Graph, partial-page, consent-page, and challenge fixtures
- response size, timeout, malformed HTML, and sanitization
- no live Amazon request in the test suite

### ReviewAuthor

- prompt contains every allowed source and the no-invention rules
- strict-schema parsing and one repair attempt
- first-person claims rejected without supporting Creator Notes
- every factual or first-person Script line retains valid evidence references
- target-duration budget and Shot/Script pairing
- deterministic Claude/Codex adapter fakes

### Apply

- matched Shots become Beats
- unmatched Shots become template placeholders
- source order and Script mapping are stable
- 9:16 is the default aspect
- applying is pure and does not mutate the input plan or Clips

### State and UI

- reducer and project-package round trips
- Import → Verify → Generate → Review state transitions
- close/reopen retains work; Start over discards it
- existing Cut confirmation
- keyboard Escape, focus return, labels, and loading/error announcements

The repository currently lacks a React component test harness. Add jsdom and
Testing Library before the drawer UI task rather than testing rendered source as
text.

## Delivery slices

### Slice 1 — Domain and manual workflow

- Product-review domain types and reducer state
- drawer shell and exclusive right-drawer coordination
- manual Product Brief and Creator Notes
- persistence/package round trips

**Gate:** a plan workspace survives reload without Amazon or AI.

### Slice 2 — Amazon import

- safe local route
- Amazon link and manual ProductSource adapters
- fixture-driven extraction tests
- Verify state with warnings and edits

**Gate:** supported fixture links produce editable briefs; blocked pages degrade
to manual entry without losing work.

### Slice 3 — AI Review Plan

- ReviewAuthor module
- Claude/Codex adapters
- schema validation, grounding, duration budgeting, and repair
- editable Script and Shot List UI

**Gate:** both AI adapters produce the same validated Review Plan shape and
unsupported claims cannot reach Apply.

### Slice 4 — Apply to Project

- Clip matching
- placeholder generation
- replace/save-only confirmation
- Story/Cut integration and 9:16 default

**Gate:** Review Plan → editable Cut → preview → export works end to end.

### Slice 5 — Hardening

- component tests and accessibility pass
- manual Amazon failure matrix
- long-field and localization handling
- disclosure and price confirmation checks

**Gate:** full tests/build pass plus manual dark/light drawer review.

## Explicitly deferred

- Amazon customer-review ingestion or summarization
- authenticated Amazon browsing
- price tracking
- affiliate-link creation
- posting directly to social platforms
- product-comparison scripts involving multiple URLs
- automatic product-image download into the Clip Bin
- merging a generated plan into an existing Cut
- medical, financial, or performance claim verification

## Acceptance criteria

- The Product Review drawer opens from the editor and does not obscure the Stage.
- An Amazon URL yields an editable Product Brief or a useful manual fallback.
- Listing facts and Creator Notes are visibly distinct.
- Claude and Codex can generate the same Review Plan contract.
- The Script and Shot List fit the selected reel duration and remain editable.
- Unsupported first-person claims are rejected before Apply.
- Missing footage is visible and becomes a placeholder only after Apply.
- Existing Project work is never overwritten without confirmation.
- Review workspace data survives autosave and project packaging.
- A confirmed plan produces a 9:16 Cut that can use the existing preview/export
  pipeline without product-review-specific export logic.
