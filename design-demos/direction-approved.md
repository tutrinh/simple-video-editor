# Direction Approved — Simple Video Editor redesign

**Date:** 2026-07-21
**Chosen:** Direction A — **Studio** (timeline-first, dark, pro NLE workspace)

## The choice
User was shown three real HTML directions (same fictional "Dolomites Weekend" project, same domain vocabulary) and picked **A**.

- **A — Studio** ✅ chosen · `design-demos/A-studio.html` — one workspace: clip bin · preview+timeline · Beat inspector. 6 tabs collapse into a single NLE-style screen; the AI pipeline becomes a "Regenerate cut" action.
- B — Storyboard · `design-demos/B-storyboard.html` — story-first warm editorial treatment (not chosen)
- C — Guided · `design-demos/C-guided.html` — bright 3-step wizard (not chosen)

User's words: **"A"**

## Scope decided earlier
- **Structural freedom:** "Rethink the whole flow" — the 6-tab model (Ingest→Analyze→Author→Assemble→Refine→Export) is replaced by a single workspace with a Generate/Regenerate action.
- **Aesthetic:** explore-freely → landed on dark, cinematic, pro.

## Mental model (Direction A)
Single three-pane workspace:
1. **Left — Clips** (bin): posters, duration, usability dots, set-aside/unused clips.
2. **Center — Preview + Timeline**: 16:9 preview with burned caption + transport; below, a filmstrip **timeline of Beats** with a playhead. The Story (logline + Direction) is surfaced here.
3. **Right — Beat inspector**: caption/Script segment edit, in/out trim, the three per-Beat AI nudges (Rewrite caption / Re-pick trim / Swap clip), and Claude's Clip Description.

## Next
Develop A into a polished interactive prototype, then plan porting into the real React app (`src/`). Placeholder footage frames (CSS gradients) stand in until real clips exist.
