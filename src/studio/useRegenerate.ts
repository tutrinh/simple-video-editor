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

/**
 * The flow rethink: the old Analyze → Author → Assemble tabs collapse into one
 * action. Describes any not-yet-described clips, authors a Story from the
 * included clips + Direction, then assembles the Cut. Reuses the existing
 * feature logic verbatim — this hook only orchestrates + reports progress.
 */
export function useRegenerate() {
  const { state, dispatch } = useProject();
  const { settings } = useSettings();
  const [st, setSt] = useState<RegenState>({ busy: false, label: "", error: "" });

  async function regenerate() {
    if (st.busy) return;
    const tone = toneHint(settings.tone);
    setSt({ busy: true, label: "Preparing…", error: "" });
    try {
      // 1. Describe included clips that need it (skip ones already described).
      const toDescribe = state.clips.filter((c) => isIncluded(c) && !c.description);
      const freshDesc = new Map<string, ClipDescription>();
      for (let i = 0; i < toDescribe.length; i++) {
        const clip = toDescribe[i];
        setSt({ busy: true, label: `Describing clip ${i + 1} of ${toDescribe.length}…`, error: "" });
        // Descriptions are tone-neutral (ADR-0007) — Tone steers the Script, not this.
        const description = await analyzeClip(clip, { model: settings.analyzeModel });
        dispatch({ type: "SET_DESCRIPTION", id: clip.id, description });
        freshDesc.set(clip.id, description);
      }

      // Merge just-created descriptions locally — `state.clips` in this closure is
      // stale and won't reflect the dispatches above, so author/assemble must see
      // this fresh copy or they'd think the clips are still undescribed.
      const clipsNow: Clip[] = state.clips.map((c) =>
        freshDesc.has(c.id) ? { ...c, description: freshDesc.get(c.id) } : c,
      );
      if (!clipsNow.some(isAuthorable)) {
        throw new Error("No usable clips to build a cut from. Add clips, or include some.");
      }

      // 2. Author the Story.
      setSt({ busy: true, label: "Finding the story…", error: "" });
      const story = await authorStory(clipsNow, state.direction, { model: settings.authorModel, tone });
      dispatch({ type: "SET_STORY", story });

      // 3. Assemble the Cut (keep current aspect if one exists).
      setSt({ busy: true, label: "Assembling the cut…", error: "" });
      const cut = assembleCut(clipsNow, story, state.cut?.aspect ?? "16:9");
      dispatch({ type: "SET_CUT", cut });

      setSt({ busy: false, label: "", error: "" });
    } catch (e) {
      setSt({ busy: false, label: "", error: e instanceof Error ? e.message : String(e) });
    }
  }

  return { ...st, regenerate, clearError: () => setSt((s) => ({ ...s, error: "" })) };
}
