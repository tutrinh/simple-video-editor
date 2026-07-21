import StudioApp from "./studio/StudioApp";

// Direction A — "Studio": a single dark NLE-style workspace (clip bin · preview +
// timeline · beat inspector) that replaces the old six-tab flow. The AI pipeline
// (describe → author → assemble) is a single "Regenerate cut" action. See
// design-demos/PORT-PLAN.md and design-demos/direction-approved.md.
export default function App() {
  return <StudioApp />;
}
