import type { ProductReviewWorkspace } from "../domain/productReview";

const STORAGE_KEY = "simple-video-editor:saved-review-plans";

export interface SavedReviewPlanItem {
  id: string;
  savedAt: number;
  productTitle: string;
  imageUrl?: string;
  brand?: string;
  workspace: ProductReviewWorkspace;
}

function getStorage(): Storage | null {
  try {
    if (typeof localStorage !== "undefined") {
      return localStorage;
    }
  } catch {
    // Return null if storage is restricted
  }
  return null;
}

export function getSavedReviewPlans(): SavedReviewPlanItem[] {
  const storage = getStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SavedReviewPlanItem[];
  } catch {
    return [];
  }
}

export function saveReviewPlanToHistory(workspace: ProductReviewWorkspace): SavedReviewPlanItem[] {
  if (!workspace.plan || !workspace.brief) return getSavedReviewPlans();
  const current = getSavedReviewPlans();
  const title = workspace.brief.title || workspace.plan.productTitle || "Untitled Product";
  const newItem: SavedReviewPlanItem = {
    id: workspace.plan.id || `plan-${Date.now()}`,
    savedAt: Date.now(),
    productTitle: title,
    imageUrl: workspace.brief.imageUrl,
    brand: workspace.brief.brand,
    workspace,
  };
  const updated = [newItem, ...current.filter((item) => item.id !== newItem.id)].slice(0, 20);
  const storage = getStorage();
  if (storage) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch (err) {
      console.warn("Failed to persist saved review plan to history:", err);
    }
  }
  return updated;
}

export function deleteSavedReviewPlan(id: string): SavedReviewPlanItem[] {
  const current = getSavedReviewPlans().filter((item) => item.id !== id);
  const storage = getStorage();
  if (storage) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(current));
    } catch (err) {
      console.warn("Failed to delete saved review plan:", err);
    }
  }
  return current;
}
