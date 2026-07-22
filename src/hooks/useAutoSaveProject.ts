import { useEffect, useRef, useState } from "react";
import { useProject } from "../state/ProjectContext";
import { saveProjectToStorage, loadProjectFromStorage } from "../lib/projectStorage";

export function useAutoSaveProject() {
  const { state, dispatch } = useProject();
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [lastSavedTime, setLastSavedTime] = useState<number | null>(null);
  const isInitialMount = useRef(true);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 1. Initial rehydration from IndexedDB on app mount
  useEffect(() => {
    async function restoreActiveProject() {
      try {
        const saved = await loadProjectFromStorage();
        if (saved && saved.clips && saved.clips.length > 0) {
          dispatch({ type: "LOAD_PROJECT", state: saved });
          setSaveStatus("saved");
          setLastSavedTime(Date.now());
        }
      } catch (err) {
        console.error("Failed to restore active project from IndexedDB:", err);
      } finally {
        isInitialMount.current = false;
      }
    }

    restoreActiveProject();
  }, [dispatch]);

  // 2. Debounced auto-save on project state changes
  useEffect(() => {
    if (isInitialMount.current) return;
    if (state.clips.length === 0) {
      setSaveStatus("idle");
      return;
    }

    setSaveStatus("saving");

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(async () => {
      try {
        await saveProjectToStorage(state);
        setSaveStatus("saved");
        setLastSavedTime(Date.now());
      } catch (err) {
        console.error("Auto-save failed:", err);
        setSaveStatus("error");
      }
    }, 1500);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [state]);

  return { saveStatus, lastSavedTime };
}
