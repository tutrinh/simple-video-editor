# Ken Burns — Task Tracker

A Still Beat's moving framing: it travels across its duration instead of holding
one frame. Decisions and rationale in [ADR-0015](./docs/adr/0015-ken-burns.md);
the **Ken Burns** and **Zoom** terms in [CONTEXT.md](./CONTEXT.md).

**Binding constraint: one function of time, two uses.** `kenBurnsAt(move, t01)`
is the contract. It **generates** the CSS keyframes for playback and is
**sampled** while paused or scrubbing — a running CSS animation cannot be
scrubbed, and both the Still preview and the trimmer have working scrubbers.
The export turns the same move into `zoompan` expressions. Preview and export
must never interpolate separately; that is how the per-Beat rotation once
shipped with an inverted sign.

**Second constraint: Ken Burns and Zoom are a mode, not a stack.** Turning one
on turns the other off. Nothing may end up with a live-looking control that does
nothing.

**Working rule:** one task at a time — implement → tests → validation gate →
next. `npx tsc --noEmit` clean at every gate. No commits (per session
instruction).

---

- [x] **Task 0 — Docs.** ADR-0015, the CONTEXT `Ken Burns` term (and `Zoom`,
  which had five fields on `Beat` and no definition), and this tracker.
  _Gate:_ ✅ files exist.

- [x] **Task 1 — Spike: is `zoompan` fast enough?** Measured a real 10s Still
  segment through the app's own engine and self-hosted cores.
  _Why first:_ ADR-0015 reasoned about pixel counts, not milliseconds.

  **Results** (single-thread — `MT_ENABLED` is off by kill-switch, so this is
  what users actually get):

  | case | seconds | × realtime | vs baseline | size |
  | --- | --- | --- | --- | --- |
  | baseline (no move) | 31.4 | 3.14× | — | 1.1 MB |
  | in-graph pre-scale 1.5× (2880w) | 48.2 | 4.82× | +53% | 15.1 MB |
  | in-graph pre-scale 2× (3840w) | 56.9 | 5.69× | +81% | 15.1 MB |
  | no pre-scale, raw 6000w | 51.8 | 5.18× | +65% | 15.6 MB |

  **The spike found a design error, which is why it went first.** The 2×
  pre-scale — the version ADR-0015 specified — was the SLOWEST of the four,
  worse than no pre-scale at all. Cause: `-loop 1` pushes 300 frames through the
  graph and `scale` has no idea they are the same picture, so a one-time cost
  was being paid three hundred times.

  **Verdict: GO, with the pre-scale moved out of the filter graph** — one canvas
  `drawImage` before the bytes reach ffmpeg, and no `scale` in the chain.
  Projected ~40s, **+27%** over baseline. ADR-0015 corrected accordingly.

  _Also found:_ a moving Beat is ~14× the bytes of a static one (1.1 → 15.1 MB),
  independent of pre-scale, and that inflation flows into the concat and mux.
  _Also confirmed:_ the 31.4s baseline is 0.32× realtime, matching the "~0.3×
  realtime" figure in `HYBRID_EXPORT_PLAN.md` — so that document's conclusions
  apply directly here.
  _Gate:_ ✅ measured, verdict recorded, ADR corrected.

- [x] **Task 2 — Domain + the contract.** `KenBurns` on `Beat` (six values:
  start scale + focus x/y, end scale + focus x/y) and `framing?: "zoom" |
  "kenBurns"` as the mode. `kenBurnsAt(move, t01)` in `util.ts` beside
  `beatZoomStyle`/`zoomChain`. The preset table (Push In, Pull Out, Drift Left,
  Drift Right, Push In + Drift, Fill) and `coverScale(srcW, srcH, canvasW,
  canvasH)` for Fill. All pure.
  _Tests:_ `kenBurnsAt` at t=0, t=1 and midpoint; linear by construction;
  clamps outside 0..1; a degenerate move (start === end) is stable; focus
  interpolates independently of scale. `coverScale` for portrait-in-landscape,
  landscape-in-portrait, square-in-both, and an exact-match aspect returning 1.
  Plus two that guard the concept itself: every preset actually MOVES (one that
  holds still is a Zoom wearing the wrong name), and no preset drifts its focus
  past the frame it has punched into.
  _Gate:_ ✅ vitest (19) + `tsc`, full suite 398/398.
  _Note:_ the exclusivity of the mode is enforced where it is edited (Task 5),
  not in the domain — `framing` is a single field, so an invalid combination is
  unrepresentable rather than needing a rule.

- [x] **Task 3 — Export.** Two halves, per the Task 1 correction:
  1. **A one-time pre-scale before ffmpeg.** Canvas `drawImage` of the Still to
     2× canvas width (never upscaling past the source), producing the bytes the
     Beat's input stage feeds. Paid once per Still, not per frame.
  2. **`kenBurnsChain(w, h, move, durSec)`** emitting `zoompan=d=1` with linear
     expressions over the frame index and **no `scale` in the chain**, placed
     before the `pad` that letterboxes to canvas.

  Only for a Still Beat whose `framing === "kenBurns"`; every other Beat emits
  exactly what it does now.
  _Tests:_ the emitted chain — the zoom expression hits `fromScale` at frame 0
  and `toScale` at the last frame; x/y track the focus; **the chain contains no
  `scale`** (the regression guard for the Task 1 finding); it sits ahead of the
  pad; a video Beat and a static-Zoom Still are byte-identical to today's
  output. The pre-scale sizing is pure and tested separately: never exceeds the
  source's native width, targets 2× canvas, and is a no-op when the source is
  already smaller.
  _Gate:_ ✅ vitest (33 in `kenBurns.test.ts`, 412 total) + `tsc` + `yarn build`.
  _Found by the tests:_ the lerp template emitted `(-8+(8--8)*on/299)` for any
  preset starting at a negative focus — a double-minus the expression parser is
  entitled to read as something else. `push-drift` hit it. The delta is now
  computed in TS and emitted as a literal, and rounded, because `1.2-1.0` is
  `0.19999999999999996` in binary floating point.
  _Also:_ `renderStillContained` in `frameSampler.ts` is the one-time GPU
  pre-render; `beatInputArgs` gained a name override, since a Ken Burns Still is
  re-encoded to JPEG whatever the original file was called.

- [x] **Task 4 — Preview.** `StagePreview` and `FinalPreview` drive the move
  from `kenBurnsAt`: CSS keyframes generated from it while playing, direct
  sampling while paused or scrubbing. The existing zoom/rotation wrappers stay;
  Ken Burns replaces what `beatZoomStyle` contributes when the mode is
  `kenBurns`.
  _Gate:_ ✅ vitest (41 in `kenBurns.test.ts`, 420 total) + `tsc` + `yarn build`.
  _Found while building it:_ **CSS and zoompan disagree about what a focus value
  means.** zoompan's `x` is the crop's LEFT EDGE within the leftover space, so
  focus 50 at 2x spans 0.5..1.0 and is centred on 0.75 — a CSS transform that
  centred on 1.0 would have shown a different picture. `kenBurnsVisibleCenter`
  is now the single source both sides derive from, with a test asserting the
  preview's centre equals the emitted crop's centre to 9 decimals at five points
  across a move. This is precisely the drift ADR-0008 exists to prevent, and it
  would not have been visible without that test.
  _Also:_ `StagePreview` injects a `@keyframes` rule named from the Beat id (CSS
  has no inline keyframes) and swaps to sampling the instant playback stops.
  `FinalPreview` samples throughout — it already runs its own rAF clock and
  scrubs the whole Cut, so there is no playback phase an animation could own.

- [x] **Task 5 — Inspector.** A Zoom | Ken Burns mode switch on a Still Beat
  (Zoom only on a video Beat), the preset row reusing the weight-ladder idiom,
  and the six manual sliders reusing the existing `adjRow` slider rows. Turning
  on Ken Burns seeds Push In 1.0 → 1.15 centred.
  _Gate:_ ✅ `tsc` + `yarn build`.
  _Where it lives:_ inside the existing "Zoom / Punch-In" section, since that is
  the Beat's framing and there should not be two places to set one thing.
  Switching to Ken Burns also clears the Zoom, so nothing is left set that no
  longer applies. A video Beat never sees the switch.
  _Fill is computed, not tabled:_ the scale that just covers depends on THIS
  photo's aspect, and the Scale sliders raise their ceiling to match, since the
  limit is available pixels rather than a fixed number.

- [x] **Task 6 — E2E gate.** Full `vitest run`, `tsc`, `yarn build`, and a
  `.vidstr` round-trip for the new fields.
  ⏳ Manual pass: a portrait photo with Fill, a landscape with Push In, scrub
  both, retrim one and confirm the move re-fits, then export and confirm the
  burned-in move matches the preview.
  _Gate:_ ✅ `vitest run` 423/423 across 32 files, ✅ `tsc`, ✅ `yarn build`.
  _Persistence tests:_ the mode and all six values survive a `.vidstr` round
  trip, including on a Beat that also carries title layers — the title-font
  strip/reinject rebuilds every Beat, and a spread that dropped unknown fields
  would lose the move silently, showing up only on reload. A Beat with no move
  still reads `framing: undefined` and keeps its Zoom.
  ⏳ Manual pass still pending. So is re-running the spike against the real
  implementation: the **+27% is projected, not measured**.
