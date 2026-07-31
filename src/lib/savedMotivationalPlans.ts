import type { MotivationalStoryWorkspace, SavedMotivationalPlanItem } from "../domain/motivationalStory";

const STORAGE_KEY = "sve_saved_motivational_plans_v1";

function genId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2, 11);
}

function getStorage(): Storage | null {
  try {
    if (typeof localStorage !== "undefined" && typeof localStorage.getItem === "function") {
      return localStorage;
    }
  } catch {
    // Return null if storage is restricted
  }
  return null;
}

export function getSavedMotivationalPlans(): SavedMotivationalPlanItem[] {
  const storage = getStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedMotivationalPlanItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn("[SavedMotivationalPlans] Failed to read history from localStorage:", err);
    return [];
  }
}

export function saveMotivationalPlanToHistory(workspace: MotivationalStoryWorkspace): SavedMotivationalPlanItem[] {
  if (!workspace.plan) return getSavedMotivationalPlans();
  const storage = getStorage();
  if (!storage) return [];
  try {
    const current = getSavedMotivationalPlans();
    const newItem: SavedMotivationalPlanItem = {
      id: workspace.plan.id || genId(),
      savedAt: Date.now(),
      prompt: workspace.prompt || workspace.plan.prompt || "Motivational Reel",
      workspace: JSON.parse(JSON.stringify(workspace)),
    };

    const filtered = current.filter(
      (item) => item.id !== newItem.id && item.workspace.plan?.id !== workspace.plan?.id
    );

    const updated = [newItem, ...filtered].slice(0, 30);
    storage.setItem(STORAGE_KEY, JSON.stringify(updated));
    return updated;
  } catch (err) {
    console.warn("[SavedMotivationalPlans] Failed to save plan to localStorage:", err);
    return getSavedMotivationalPlans();
  }
}

export function deleteSavedMotivationalPlan(id: string): SavedMotivationalPlanItem[] {
  const storage = getStorage();
  if (!storage) return [];
  try {
    const current = getSavedMotivationalPlans();
    const updated = current.filter((item) => item.id !== id);
    storage.setItem(STORAGE_KEY, JSON.stringify(updated));
    return updated;
  } catch (err) {
    console.warn("[SavedMotivationalPlans] Failed to delete plan from localStorage:", err);
    return getSavedMotivationalPlans();
  }
}
