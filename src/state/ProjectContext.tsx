import { createContext, useContext, useReducer, type ReactNode, type Dispatch } from "react";
import { projectReducer, initialState, type ProjectState, type Action } from "./projectReducer";

const ProjectContext = createContext<{ state: ProjectState; dispatch: Dispatch<Action> } | null>(null);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(projectReducer, initialState);
  return <ProjectContext.Provider value={{ state, dispatch }}>{children}</ProjectContext.Provider>;
}

export function useProject() {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error("useProject must be used within a ProjectProvider");
  return ctx;
}
