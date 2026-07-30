import { describe, expect, it } from "vitest";
import type { ReviewPlan } from "../../domain/productReview";
import { applyReviewPlan } from "./applyReviewPlan";
import { importAmazonProductHtml } from "./amazonProductSource";

describe("Product Review performance regressions", () => {
  it("applies a 100-Shot plan in under 100ms", () => {
    const shots: ReviewPlan["shots"] = [];
    const script: ReviewPlan["script"] = [];
    for (let index = 0; index < 100; index++) {
      const shotId = `shot-${index}`;
      shots.push({
        id: shotId,
        description: `Product detail ${index}`,
        capture: "detail",
        framing: "close-up",
        approxDurationSec: 0.5,
      });
      script.push({
        id: `line-${index}`,
        text: `Grounded product detail ${index}.`,
        purpose: index === 0 ? "hook" : "demo",
        approxDurationSec: 0.5,
        evidence: [{ kind: "product-claim", claimId: `claim-${index}` }],
        shotId,
      });
    }
    const plan: ReviewPlan = {
      id: "stress",
      productTitle: "Stress product",
      targetDurationSec: 60,
      hook: "Stress hook",
      shots,
      script,
      createdAt: 1,
    };

    const start = performance.now();
    const applied = applyReviewPlan(plan, []);
    const elapsed = performance.now() - start;

    expect(applied.cut.beats).toHaveLength(100);
    expect(applied.placeholderClips).toHaveLength(100);
    expect(elapsed).toBeLessThan(100);
  });

  it("extracts a near-limit Amazon document in under 150ms", () => {
    const product = `<script type="application/ld+json">{"@type":"Product","name":"Large Page Product"}</script>`;
    const html = `${product}${" ".repeat(1_900_000)}`;
    const start = performance.now();
    const imported = importAmazonProductHtml("https://www.amazon.com/dp/B0ABC12345", html, 1);
    const elapsed = performance.now() - start;

    expect(imported.brief.title).toBe("Large Page Product");
    expect(elapsed).toBeLessThan(150);
  });
});
