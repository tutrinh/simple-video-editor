import { useState } from "react";
import { useProject } from "../state/ProjectContext";
import { useSettings, toneHint, scriptTypeHint } from "../state/SettingsContext";
import type { ClipDescription } from "../domain/types";
import { analyzeClip, hintFromName } from "../features/analyze/analyze";
import { authorBeatScripts, type BeatDesc } from "../features/author/author";
import { rewriteCaption } from "../features/refine/refine";
import { beatClips } from "./util";

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

  /** Step 1: Analyze the cut's beat clips (or a single clip) with Claude vision model. */
  async function analyzeClips(singleClipId?: string) {
    if (st.busy) return;
    setSt({ busy: true, label: "Preparing clip analysis…", error: "" });
    try {
      // Analyze only what's in the cut — the arranged beats. A single-clip request
      // is honored as-is (the caller already knows it's a beat in the cut).
      const targetClips = singleClipId
        ? state.clips.filter((c) => c.id === singleClipId)
        : beatClips(state.clips, state.cut);

      if (targetClips.length === 0) {
        throw new Error("No beats in the cut to analyze. Arrange your clips into a cut first.");
      }

      for (let i = 0; i < targetClips.length; i++) {
        const clip = targetClips[i];
        setSt({ busy: true, label: `Step 1: Describing clip ${i + 1} of ${targetClips.length} (${clip.name})…`, error: "" });
        const description = await analyzeClip(clip, { provider: settings.aiProvider, model: settings.analyzeModel });
        dispatch({ type: "SET_DESCRIPTION", id: clip.id, description });
      }
      setSt({ busy: false, label: "", error: "" });
    } catch (e) {
      setSt({ busy: false, label: "", error: e instanceof Error ? e.message : String(e) });
    }
  }

  /**
   * Author a script line for each beat the editor has already arranged. The cut's
   * beats are the story: their order, membership, and trims are LEFT UNCHANGED —
   * only each beat's `scriptText` is (re)written. Un-analyzed beat clips are
   * described first so Claude has something to write from.
   */
  async function authorScript() {
    if (st.busy) return;
    const cut = state.cut;
    if (!cut || cut.beats.length === 0) {
      setSt({ busy: false, label: "", error: "Arrange your clips into a cut first — the AI writes the script for the cut you build." });
      return;
    }
    const tone = [
      toneHint(settings.tone),
      cut.templateToneHint ? `Template visual tone: ${cut.templateToneHint}` : "",
    ].filter(Boolean).join(". ");
    setSt({ busy: true, label: "Checking clip descriptions…", error: "" });
    try {
      // 1. Describe any beat clip that hasn't been analyzed yet (cut beats only).
      const freshDesc = new Map<string, ClipDescription>();
      const toDescribe = beatClips(state.clips, cut).filter((c) => !c.description);
      for (let i = 0; i < toDescribe.length; i++) {
        const clip = toDescribe[i];
        setSt({ busy: true, label: `Step 1: Describing clip ${i + 1} of ${toDescribe.length}…`, error: "" });
        const description = await analyzeClip(clip, { provider: settings.aiProvider, model: settings.analyzeModel });
        dispatch({ type: "SET_DESCRIPTION", id: clip.id, description });
        freshDesc.set(clip.id, description);
      }

      const clipById = new Map(state.clips.map((c) => [c.id, c]));
      const descOf = (clipId: string) => freshDesc.get(clipId) ?? clipById.get(clipId)?.description;

      // 2. Ask Claude for ONE line per beat, in the cut's exact order.
      setSt({ busy: true, label: "Step 2: Writing a script line for each beat…", error: "" });
      const payload: BeatDesc[] = cut.beats.map((b) => {
        const clip = clipById.get(b.clipId);
        const d = descOf(b.clipId);
        return {
          label: clip ? hintFromName(clip.name) : "",
          subjectAction: d?.subjectAction ?? "",
          settingMood: d?.settingMood ?? "",
          durationSec: Math.round(b.durationSec),
          templateRole: b.templateSlotDescription,
          hasFootage: Boolean(clip && !clip.isTemplatePlaceholder),
        };
      });
      const { logline, lines } = await authorBeatScripts(payload, state.direction, {
        provider: settings.aiProvider,
        model: settings.authorModel,
        tone,
        scriptType: scriptTypeHint(settings.scriptType),
      });

      // 3. Apply lines in place — same beats, same order, only scriptText changes.
      const updatedBeats = cut.beats.map((b, i) => {
        const line = (lines[i] ?? "").trim();
        return line ? { ...b, scriptText: line } : b;
      });
      dispatch({ type: "SET_CUT", cut: { ...cut, beats: updatedBeats } });
      dispatch({ type: "SET_STORY", story: { logline, beats: updatedBeats.map((b) => ({ clipId: b.clipId, scriptText: b.scriptText })) } });

      setSt({ busy: false, label: "", error: "" });
    } catch (e) {
      setSt({ busy: false, label: "", error: e instanceof Error ? e.message : String(e) });
    }
  }

  async function regenerate() {
    return authorScript();
  }

  /** Rewrite a single beat's script line with Claude (propose-then-refine), in the
   *  current tone. Leaves the rest of the cut untouched. */
  async function refineBeat(beatId: string) {
    if (st.busy || !state.cut) return;
    const beat = state.cut.beats.find((b) => b.id === beatId);
    if (!beat) return;
    const clip = state.clips.find((c) => c.id === beat.clipId);
    if (!clip) return;
    setSt({ busy: true, label: "Refining script line with AI…", error: "" });
    try {
      const line = await rewriteCaption(clip, beat.scriptText, state.story?.logline ?? "", {
        provider: settings.aiProvider,
        model: settings.authorModel,
        tone: toneHint(settings.tone),
      });
      dispatch({ type: "UPDATE_BEAT", beat: { ...beat, scriptText: line } });
      setSt({ busy: false, label: "", error: "" });
    } catch (e) {
      setSt({ busy: false, label: "", error: e instanceof Error ? e.message : String(e) });
    }
  }

  return {
    ...st,
    analyzeClips,
    authorScript,
    regenerate,
    refineBeat,
    clearError: () => setSt((s) => ({ ...s, error: "" })),
  };
}
