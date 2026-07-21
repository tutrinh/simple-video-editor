import { useProject } from "../state/ProjectContext";
import { useSettings, TONE_OPTIONS } from "../state/SettingsContext";
import { isIncluded } from "./util";

/** Surfaces the Story in the workspace: logline + the Direction and Tone steers
 *  that shape the next Regenerate. */
export default function StoryBar() {
  const { state, dispatch } = useProject();
  const { settings, update } = useSettings();
  const includedCount = state.clips.filter(isIncluded).length;
  const usedCount = new Set(state.cut?.beats.map((b) => b.clipId)).size;

  return (
    <div className="st-storybar">
      <div className="st-story-lab">Story</div>
      <div className="st-story-main">
        <div className={"st-logline" + (state.story ? "" : " empty")}>
          {state.story?.logline ?? "No story yet — Regenerate to let Claude find one across your clips."}
        </div>
        <div className="st-dirrow">
          <input
            className="st-dir-input"
            value={state.direction}
            onChange={(e) => dispatch({ type: "SET_DIRECTION", direction: e.target.value })}
            placeholder="Direction (optional) — steer the story, e.g. build the tension, save the best for last"
          />
          <select
            className="st-tone"
            value={settings.tone}
            onChange={(e) => update({ tone: e.target.value })}
            title="Tone that steers the script voice and clip coaching on the next Regenerate"
          >
            {TONE_OPTIONS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          {state.cut && <span className="st-chipcount st-num">{usedCount} of {includedCount} clips used</span>}
        </div>
      </div>
    </div>
  );
}
