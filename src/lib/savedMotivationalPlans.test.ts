import { beforeEach, describe, expect, it } from "vitest";
import type { MotivationalStoryWorkspace } from "../domain/motivationalStory";
import {
  deleteSavedMotivationalPlan,
  getSavedMotivationalPlans,
  saveMotivationalPlanToHistory,
} from "./savedMotivationalPlans";

const mockWorkspace: MotivationalStoryWorkspace = {
  prompt: "Gym Motivation",
  plan: {
    id: "plan-123",
    title: "Iron Will",
    prompt: "Gym Motivation",
    targetDurationSec: 30,
    hook: "No days off.",
    createdAt: Date.now(),
    shots: [],
    script: [],
  },
};

describe("savedMotivationalPlans", () => {
  beforeEach(() => {
    let store: Record<string, string> = {};
    const mockStorage = {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => { store[key] = value; },
      removeItem: (key: string) => { delete store[key]; },
      clear: () => { store = {}; },
      length: 0,
      key: () => null,
    };
    Object.defineProperty(globalThis, "localStorage", { value: mockStorage, writable: true, configurable: true });
  });

  it("saves and retrieves motivational story plans from localStorage", () => {
    expect(getSavedMotivationalPlans()).toEqual([]);

    const saved = saveMotivationalPlanToHistory(mockWorkspace);
    expect(saved.length).toBe(1);
    expect(saved[0].prompt).toBe("Gym Motivation");
    expect(saved[0].workspace.plan?.title).toBe("Iron Will");

    const retrieved = getSavedMotivationalPlans();
    expect(retrieved.length).toBe(1);
    expect(retrieved[0].id).toBe("plan-123");
  });

  it("deletes a saved plan by ID", () => {
    saveMotivationalPlanToHistory(mockWorkspace);
    expect(getSavedMotivationalPlans().length).toBe(1);

    const updated = deleteSavedMotivationalPlan("plan-123");
    expect(updated.length).toBe(0);
    expect(getSavedMotivationalPlans().length).toBe(0);
  });
});
