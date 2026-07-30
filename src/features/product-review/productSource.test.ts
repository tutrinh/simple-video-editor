import { describe, expect, it } from "vitest";
import { createAmazonProductSource, createManualProductBrief } from "./productSource";

describe("ProductSource", () => {
  it("imports a normalized Product Brief through the local route contract", async () => {
    const fetchRoute = async () => new Response(JSON.stringify({
      brief: {
        source: { kind: "amazon", canonicalUrl: "https://www.amazon.com/dp/B0ABC12345", asin: "B0ABC12345" },
        title: "Pocket Light",
        features: [],
      },
      warnings: ["Verify the brand."],
    }), { status: 200, headers: { "content-type": "application/json" } });

    const result = await createAmazonProductSource(fetchRoute).import({
      url: "https://www.amazon.com/dp/B0ABC12345",
    });

    expect(result).toEqual({
      ok: true,
      brief: expect.objectContaining({ title: "Pocket Light" }),
      warnings: ["Verify the brand."],
    });
  });

  it("returns a stable failure instead of throwing route diagnostics into the UI", async () => {
    const fetchRoute = async () => new Response(JSON.stringify({
      error: "Amazon blocked the product import.",
      reason: "blocked",
    }), { status: 422, headers: { "content-type": "application/json" } });

    await expect(createAmazonProductSource(fetchRoute).import({
      url: "https://www.amazon.com/dp/B0ABC12345",
    })).resolves.toEqual({
      ok: false,
      reason: "blocked",
      message: "Amazon blocked the product import.",
      manualSeed: {
        source: { kind: "manual", url: "https://www.amazon.com/dp/B0ABC12345" },
        features: [],
      },
    });
  });

  it("normalizes manual fields into an editable author-entered Product Brief", () => {
    expect(createManualProductBrief({
      title: "  Pocket Light ",
      brand: " Lumos ",
      description: " ",
      featureText: "USB-C charging\n\nMagnetic back\nUSB-C charging",
      sourceUrl: "https://example.test/product",
    })).toEqual({
      source: { kind: "manual", url: "https://example.test/product" },
      title: "Pocket Light",
      brand: "Lumos",
      features: [
        { id: "manual-1", text: "USB-C charging", source: "author-entered" },
        { id: "manual-2", text: "Magnetic back", source: "author-entered" },
      ],
    });
  });
});
