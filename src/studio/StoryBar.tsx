import { useProject } from "../state/ProjectContext";
import { useSettings, TONE_OPTIONS, AI_PROVIDER_OPTIONS, type AiProvider } from "../state/SettingsContext";
import { isIncluded } from "./util";

interface Props {
  onAuthor?: () => void;
  busy?: boolean;
}

/** Surfaces the Story in the workspace: logline + Direction & Tone steers + Step 2 Author action. */
export default function StoryBar({ onAuthor, busy }: Props) {
  const { state, dispatch } = useProject();
  const { settings, update } = useSettings();
  const includedCount = state.clips.filter(isIncluded).length;
  const usedCount = new Set(state.cut?.beats.map((b) => b.clipId)).size;

  return (
    <div className="st-storybar">
      <div className="st-story-lab">Step 2</div>
      <div className="st-story-main">
        <div className={"st-logline" + (state.story ? "" : " empty")}>
          {state.story?.logline ?? "No story yet — click '2. Author Story & Script' to generate a vlog script across your clips."}
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
            value={settings.aiProvider}
            onChange={(e) => update({ aiProvider: e.target.value as AiProvider })}
            title="AI CLI engine choice: Claude CLI (claude -p) vs Antigravity CLI (antigravity)"
          >
            {AI_PROVIDER_OPTIONS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          <select
            className="st-tone"
            value={settings.tone}
            onChange={(e) => update({ tone: e.target.value })}
            title="Tone that steers the script voice and clip coaching"
          >
            {TONE_OPTIONS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          {onAuthor && (
            <button
              type="button"
              className="st-btn primary"
              style={{ padding: "6px 12px", fontSize: 12, flexShrink: 0 }}
              onClick={onAuthor}
              disabled={busy}
              title="Step 2: Use Claude to write story logline & beat scripts"
            >
              2. Author Story & Script
            </button>
          )}
          {state.cut && <span className="st-chipcount st-num">{usedCount} of {includedCount} clips used</span>}
        </div>
      </div>
    </div>
  );
}
