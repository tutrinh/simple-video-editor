import { useState } from "react";
import { useProject } from "../state/ProjectContext";
import { useSettings, toneHint } from "../state/SettingsContext";
import type { Clip, ClipDescription } from "../domain/types";
import { analyzeClip } from "../features/analyze/analyze";
import { authorStory, isAuthorable } from "../features/author/author";
import { assembleCut } from "../features/assemble/assemble";
import { isIncluded } from "./util";

export interface RegenState {
  busy: boolean;
  /** Human-readable current step, e.g. "Describing clip 2/5". */
  label: string;
  error: string;
}

export function useRegenerate() {
  const { state, dispatch } = useProject();
  const { settings } = useSettings();
  const [st, setSt] = useState<RegenState>({ busy: false, label: "", error: "" });

  /** Step 1: Analyze included clips (or a single clip) with Claude vision model. */
  async function analyzeClips(singleClipId?: string) {
    if (st.busy) return;
    setSt({ busy: true, label: "Preparing clip analysis…", error: "" });
    try {
      const targetClips = singleClipId
        ? state.clips.filter((c) => c.id === singleClipId)
        : state.clips.filter((c) => isIncluded(c));

      if (targetClips.length === 0) {
        throw new Error("No clips to analyze. Add clips or select included clips.");
      }

      for (let i = 0; i < targetClips.length; i++) {
        const clip = targetClips[i];
        setSt({ busy: true, label: `Step 1: Describing clip ${i + 1} of ${targetClips.length} (${clip.name})…`, error: "" });
        const description = await analyzeClip(clip, { model: settings.analyzeModel });
        dispatch({ type: "SET_DESCRIPTION", id: clip.id, description });
      }
      setSt({ busy: false, label: "", error: "" });
    } catch (e) {
      setSt({ busy: false, label: "", error: e instanceof Error ? e.message : String(e) });
    }
  }

  /** Step 2: Author the Vlog Story & Script with Claude, then assemble the cut. */
  async function authorScript() {
    if (st.busy) return;
    const tone = toneHint(settings.tone);
    setSt({ busy: true, label: "Checking clip descriptions…", error: "" });
    try {
      // 1. Describe any included clip that has not been analyzed yet.
      const toDescribe = state.clips.filter((c) => isIncluded(c) && !c.description);
      const freshDesc = new Map<string, ClipDescription>();
      for (let i = 0; i < toDescribe.length; i++) {
        const clip = toDescribe[i];
        setSt({ busy: true, label: `Step 1: Describing clip ${i + 1} of ${toDescribe.length}…`, error: "" });
        const description = await analyzeClip(clip, { model: settings.analyzeModel });
        dispatch({ type: "SET_DESCRIPTION", id: clip.id, description });
        freshDesc.set(clip.id, description);
      }

      const clipsNow: Clip[] = state.clips.map((c) =>
        freshDesc.has(c.id) ? { ...c, description: freshDesc.get(c.id) } : c,
      );
      if (!clipsNow.some(isAuthorable)) {
        throw new Error("No usable analyzed clips to author from. Run Step 1 or add clips.");
      }

      // 2. Author the Story with Claude.
      setSt({ busy: true, label: "Step 2: Authoring story & script with Claude…", error: "" });
      const story = await authorStory(clipsNow, state.direction, { model: settings.authorModel, tone });
      dispatch({ type: "SET_STORY", story });

      // 3. Assemble the Cut.
      setSt({ busy: true, label: "Assembling cut…", error: "" });
      const cut = assembleCut(clipsNow, story, state.cut?.aspect ?? "16:9");
      dispatch({ type: "SET_CUT", cut });

      setSt({ busy: false, label: "", error: "" });
    } catch (e) {
      setSt({ busy: false, label: "", error: e instanceof Error ? e.message : String(e) });
    }
  }

  async function regenerate() {
    return authorScript();
  }

  return {
    ...st,
    analyzeClips,
    authorScript,
    regenerate,
    clearError: () => setSt((s) => ({ ...s, error: "" })),
  };
}
