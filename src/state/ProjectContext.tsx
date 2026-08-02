import { createContext, useCallback, useContext, useEffect, useReducer, type ReactNode, type Dispatch } from "react";
import { type ProjectState, type Action } from "./projectReducer";
import { initialProjectHistory, projectHistoryReducer } from "./projectHistory";

interface ProjectContextValue {
  state: ProjectState;
  dispatch: Dispatch<Action>;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [history, send] = useReducer(projectHistoryReducer, undefined, () => initialProjectHistory());
  const dispatch = useCallback<Dispatch<Action>>((action) => send({ kind: "dispatch", action, at: Date.now() }), []);
  const undo = useCallback(() => send({ kind: "undo" }), []);
  const redo = useCallback(() => send({ kind: "redo" }), []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.key.toLowerCase() !== "z") return;
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      event.preventDefault();
      if (event.shiftKey) redo(); else undo();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [redo, undo]);

  return <ProjectContext.Provider value={{ state: history.present, dispatch, undo, redo, canUndo: history.past.length > 0, canRedo: history.future.length > 0 }}>{children}</ProjectContext.Provider>;
}

export function useProject() {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error("useProject must be used within a ProjectProvider");
  return ctx;
}
