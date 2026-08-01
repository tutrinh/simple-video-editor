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

  it("round-trips the persona steer a plan was written under", () => {
    const withPersona: MotivationalStoryWorkspace = {
      ...mockWorkspace,
      personaId: "custom",
      pov: "third-person",
      targetDurationSec: 45,
      customPersona: {
        speaker: "A welder taking evening drafting classes",
        audience: "Someone told they are too far along to retrain",
        pov: "first-person",
        world: "sparks on a shop floor, a night-class parking permit",
        vernacular: "Blunt, trade-specific.",
      },
    };

    saveMotivationalPlanToHistory(withPersona);
    const [restored] = getSavedMotivationalPlans();

    expect(restored.workspace.personaId).toBe("custom");
    expect(restored.workspace.pov).toBe("third-person");
    expect(restored.workspace.targetDurationSec).toBe(45);
    expect(restored.workspace.customPersona?.speaker).toBe("A welder taking evening drafting classes");
  });

  it("round-trips per-line concreteDetail and the plan's persona/incident", () => {
    saveMotivationalPlanToHistory({
      ...mockWorkspace,
      plan: {
        ...mockWorkspace.plan!,
        persona: "A 22-year-old rehabbing a retorn ACL",
        incident: "The first morning back in the empty 6AM gym",
        script: [
          {
            id: "l1",
            text: "The surgery date is on a strip of tape inside my locker.",
            purpose: "hook",
            approxDurationSec: 4,
            shotId: "s1",
            concreteDetail: "strip of tape with the surgery date",
          },
        ],
      },
    });

    const [restored] = getSavedMotivationalPlans();
    expect(restored.workspace.plan?.persona).toMatch(/retorn ACL/);
    expect(restored.workspace.plan?.incident).toMatch(/6AM gym/);
    expect(restored.workspace.plan?.script[0].concreteDetail).toBe("strip of tape with the surgery date");
  });
});
