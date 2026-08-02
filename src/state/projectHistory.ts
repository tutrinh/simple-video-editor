import { initialState, projectReducer, type Action, type ProjectState } from "./projectReducer";

const HISTORY_LIMIT = 60;
const COALESCE_MS = 700;

export interface ProjectHistory {
  past: ProjectState[];
  present: ProjectState;
  future: ProjectState[];
  lastGroup: string | null;
  lastAt: number;
}

export type ProjectHistoryAction =
  | { kind: "dispatch"; action: Action; at: number }
  | { kind: "undo" }
  | { kind: "redo" };

export function initialProjectHistory(state: ProjectState = initialState): ProjectHistory {
  return { past: [], present: state, future: [], lastGroup: null, lastAt: 0 };
}

function historyGroup(action: Action): string | null {
  switch (action.type) {
    case "SET_TITLE":
    case "SET_DIRECTION":
    case "UPDATE_MUSIC_TRACK_VOLUME":
      return action.type;
    case "UPDATE_BEAT": return `${action.type}:${action.beat.id}`;
    case "UPDATE_OVERLAY": return `${action.type}:${action.overlay.id}`;
    case "UPDATE_VO": return `${action.type}:${action.segment.id}`;
    case "UPDATE_VOS": return `${action.type}:${action.segments.map((segment) => segment.id).join(",")}`;
    case "UPDATE_SFX": return `${action.type}:${action.segment.id}`;
    case "UPDATE_USER_VOICE": return `${action.type}:${action.segment.id}`;
    case "UPDATE_STICKER": return `${action.type}:${action.sticker.id}`;
    default: return null;
  }
}

function isBackgroundAction(action: Action): boolean {
  return action.type === "SET_NORMALIZED" || action.type === "SET_POSTER" || action.type === "SET_CLIP_FPS";
}

export function projectHistoryReducer(history: ProjectHistory, event: ProjectHistoryAction): ProjectHistory {
  if (event.kind === "undo") {
    const previous = history.past.at(-1);
    if (!previous) return history;
    return {
      past: history.past.slice(0, -1),
      present: previous,
      future: [history.present, ...history.future].slice(0, HISTORY_LIMIT),
      lastGroup: null,
      lastAt: 0,
    };
  }
  if (event.kind === "redo") {
    const next = history.future[0];
    if (!next) return history;
    return {
      past: [...history.past, history.present].slice(-HISTORY_LIMIT),
      present: next,
      future: history.future.slice(1),
      lastGroup: null,
      lastAt: 0,
    };
  }

  const { action, at } = event;
  const next = projectReducer(history.present, action);
  if (next === history.present) return history;
  if (action.type === "LOAD_PROJECT" || action.type === "RESET") return initialProjectHistory(next);
  if (isBackgroundAction(action)) return { ...history, present: next };

  const group = historyGroup(action);
  const coalesced = group !== null && group === history.lastGroup && at - history.lastAt <= COALESCE_MS;
  return {
    past: coalesced ? history.past : [...history.past, history.present].slice(-HISTORY_LIMIT),
    present: next,
    future: [],
    lastGroup: group,
    lastAt: at,
  };
}
