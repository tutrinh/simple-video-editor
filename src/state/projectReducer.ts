import type { Clip, ClipDescription, Cut, Beat, Story } from "../domain/types";

/** The whole editing session. One store; every phase reads/writes it. */
export interface ProjectState {
  /** Author-given project name (empty = "Untitled project"); names the export. */
  title: string;
  clips: Clip[];
  /** Optional author-supplied steer for the Story (ADR-0001). */
  direction: string;
  story?: Story;
  cut?: Cut;
}

export const initialState: ProjectState = { title: "", clips: [], direction: "" };

export type Action =
  | { type: "SET_TITLE"; title: string }
  | { type: "ADD_CLIPS"; clips: Clip[] }
  | { type: "REMOVE_CLIP"; id: string }
  | { type: "SET_NORMALIZED"; id: string; normalized: Blob }
  | { type: "SET_POSTER"; id: string; poster: string }
  | { type: "SET_DESCRIPTION"; id: string; description: ClipDescription }
  | { type: "SET_INCLUDED"; id: string; included: boolean }
  | { type: "SET_DIRECTION"; direction: string }
  | { type: "SET_STORY"; story: Story }
  | { type: "SET_CUT"; cut: Cut }
  | { type: "UPDATE_BEAT"; beat: Beat }
  | { type: "ADD_BEAT"; beat: Beat }
  | { type: "REMOVE_BEAT"; id: string }
  | { type: "DUPLICATE_BEAT"; id: string; newBeatId?: string; newClipId?: string }
  | { type: "REORDER_BEATS"; order: string[] }
  | { type: "RESET" };

function patchClip(clips: Clip[], id: string, patch: Partial<Clip>): Clip[] {
  return clips.map((c) => (c.id === id ? { ...c, ...patch } : c));
}

export function projectReducer(state: ProjectState, action: Action): ProjectState {
  switch (action.type) {
    case "SET_TITLE":
      return { ...state, title: action.title };
    case "ADD_CLIPS":
      return { ...state, clips: [...state.clips, ...action.clips] };
    case "REMOVE_CLIP":
      return { ...state, clips: state.clips.filter((c) => c.id !== action.id) };
    case "SET_NORMALIZED":
      return { ...state, clips: patchClip(state.clips, action.id, { normalized: action.normalized }) };
    case "SET_POSTER":
      return { ...state, clips: patchClip(state.clips, action.id, { poster: action.poster }) };
    case "SET_DESCRIPTION":
      return { ...state, clips: patchClip(state.clips, action.id, { description: action.description }) };
    case "SET_INCLUDED":
      return { ...state, clips: patchClip(state.clips, action.id, { included: action.included }) };
    case "SET_DIRECTION":
      return { ...state, direction: action.direction };
    case "SET_STORY":
      return { ...state, story: action.story };
    case "SET_CUT":
      return { ...state, cut: action.cut };
    case "UPDATE_BEAT": {
      if (!state.cut) return state;
      const beats = state.cut.beats.map((b) => (b.id === action.beat.id ? action.beat : b));
      return { ...state, cut: { ...state.cut, beats } };
    }
    case "ADD_BEAT": {
      if (!state.cut) return state;
      return { ...state, cut: { ...state.cut, beats: [...state.cut.beats, action.beat] } };
    }
    case "REMOVE_BEAT": {
      if (!state.cut) return state;
      return { ...state, cut: { ...state.cut, beats: state.cut.beats.filter((b) => b.id !== action.id) } };
    }
    case "DUPLICATE_BEAT": {
      if (!state.cut) return state;
      const idx = state.cut.beats.findIndex((b) => b.id === action.id);
      if (idx < 0) return state;
      const originalBeat = state.cut.beats[idx];
      const originalClip = state.clips.find((c) => c.id === originalBeat.clipId);

      const genId = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
      const newClipId = action.newClipId ?? genId();
      const newBeatId = action.newBeatId ?? genId();

      let updatedClips = state.clips;
      let targetClipId = originalBeat.clipId;

      if (originalClip) {
        const dupClip: Clip = {
          ...originalClip,
          id: newClipId,
          description: originalClip.description ? { ...originalClip.description } : undefined,
        };
        const clipIdx = state.clips.findIndex((c) => c.id === originalClip.id);
        updatedClips = [...state.clips];
        updatedClips.splice(clipIdx >= 0 ? clipIdx + 1 : updatedClips.length, 0, dupClip);
        targetClipId = newClipId;
      }

      const dupBeat: Beat = {
        ...originalBeat,
        id: newBeatId,
        clipId: targetClipId,
        captionText: "",
        captionDurations: undefined,
      };

      const beats = [...state.cut.beats];
      beats.splice(idx + 1, 0, dupBeat);

      return {
        ...state,
        clips: updatedClips,
        cut: { ...state.cut, beats },
      };
    }
    case "REORDER_BEATS": {
      if (!state.cut) return state;
      const byId = new Map(state.cut.beats.map((b) => [b.id, b]));
      const beats = action.order.map((id) => byId.get(id)).filter((b): b is Beat => !!b);
      return { ...state, cut: { ...state.cut, beats } };
    }
    case "RESET":
      return initialState;
    default:
      return state;
  }
}
