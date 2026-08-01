import { describe, expect, it, beforeEach } from "vitest";
import {
  deleteSavedReviewPlan,
  getSavedReviewPlans,
  saveReviewPlanToHistory,
} from "./savedReviewPlans";
import type { ProductReviewWorkspace } from "../domain/productReview";

describe("savedReviewPlans", () => {
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

  const mockWorkspace: ProductReviewWorkspace = {
    brief: {
      source: { kind: "manual", url: "https://example.com/product" },
      title: "Test Headphones",
      brand: "AudioCo",
      imageUrl: "https://example.com/image.jpg",
      features: [],
    },
    creatorNotes: {
      audience: "music lovers",
      problem: "noise",
      experience: "great bass",
      pros: ["clear sound"],
      cons: ["heavy"],
      verdict: "recommended",
      disclosure: "purchased",
    },
    plan: {
      id: "plan-123",
      productTitle: "Test Headphones",
      targetDurationSec: 30,
      hook: "Best bass ever",
      hookOptions: ["Best bass ever"],
      script: [
        {
          id: "s1",
          text: "I love these headphones.",
          purpose: "hook",
          approxDurationSec: 5,
          evidence: [],
          shotId: "shot-1",
        },
      ],
      shots: [
        {
          id: "shot-1",
          description: "Close-up of earcups",
          capture: "detail",
          framing: "close-up",
          approxDurationSec: 5,
        },
      ],
      createdAt: 1000000,
    },
  };

  it("saves a review plan to local history and retrieves it", () => {
    expect(getSavedReviewPlans()).toHaveLength(0);
    const saved = saveReviewPlanToHistory(mockWorkspace);
    expect(saved).toHaveLength(1);
    expect(saved[0].productTitle).toBe("Test Headphones");
    expect(getSavedReviewPlans()).toHaveLength(1);
  });

  it("deletes a saved plan by id", () => {
    saveReviewPlanToHistory(mockWorkspace);
    expect(getSavedReviewPlans()).toHaveLength(1);
    const updated = deleteSavedReviewPlan("plan-123");
    expect(updated).toHaveLength(0);
    expect(getSavedReviewPlans()).toHaveLength(0);
  });
});
