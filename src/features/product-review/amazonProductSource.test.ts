import { describe, expect, it } from "vitest";
import {
  AmazonProductImportError,
  importAmazonProductHtml,
  normalizeAmazonProductUrl,
} from "./amazonProductSource";

const PRODUCT_JSON_LD = `
<!doctype html>
<html><head>
  <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "Product",
      "name": "Trail &amp; Table Press",
      "brand": { "@type": "Brand", "name": "Northline" },
      "description": "&lt;b&gt;Double-wall&lt;/b&gt; travel coffee press.",
      "image": ["https://images.example/press.jpg"],
      "category": "Travel Coffee Makers",
      "additionalProperty": [
        { "@type": "PropertyValue", "name": "Material", "value": "Stainless steel" }
      ],
      "offers": { "@type": "Offer", "price": "39.95", "priceCurrency": "USD" }
    }
  </script>
</head><body></body></html>`;

describe("normalizeAmazonProductUrl", () => {
  it("accepts a public product URL and produces a stable canonical URL", () => {
    expect(normalizeAmazonProductUrl("https://www.amazon.com/Trail-Press/dp/B0ABC12345?tag=creator-20")).toEqual({
      asin: "B0ABC12345",
      canonicalUrl: "https://www.amazon.com/dp/B0ABC12345",
      hostname: "www.amazon.com",
    });
  });

  it.each([
    "http://www.amazon.com/dp/B0ABC12345",
    "https://user:pass@www.amazon.com/dp/B0ABC12345",
    "https://www.amazon.com:8443/dp/B0ABC12345",
    "https://amazon.example/dp/B0ABC12345",
    "https://127.0.0.1/dp/B0ABC12345",
    "https://www.amazon.com/s?k=coffee",
  ])("rejects unsafe or non-product URL %s", (url) => {
    expect(() => normalizeAmazonProductUrl(url)).toThrow(AmazonProductImportError);
  });
});

describe("importAmazonProductHtml", () => {
  it("extracts and sanitizes schema.org product data without retaining HTML", () => {
    const result = importAmazonProductHtml(
      "https://www.amazon.com/Trail-Press/dp/B0ABC12345",
      PRODUCT_JSON_LD,
      100,
    );

    expect(result.brief).toEqual({
      source: {
        kind: "amazon",
        url: "https://www.amazon.com/Trail-Press/dp/B0ABC12345",
        canonicalUrl: "https://www.amazon.com/dp/B0ABC12345",
        asin: "B0ABC12345",
        fetchedAt: 100,
      },
      title: "Trail & Table Press",
      brand: "Northline",
      category: "Travel Coffee Makers",
      description: "Double-wall travel coffee press.",
      features: [{
        id: "listing-B0ABC12345-1",
        text: "Material: Stainless steel",
        source: "listing",
      }],
      imageUrl: "https://images.example/press.jpg",
      priceText: "USD 39.95",
    });
    expect(result.warnings).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("<script");
  });

  it("falls back to Open Graph metadata and reports missing feature claims", () => {
    const html = `
      <meta property="og:title" content="Pocket Light">
      <meta property="og:description" content="A compact fill light">
      <meta property="og:image" content="https://images.example/light.jpg">
    `;
    const result = importAmazonProductHtml("https://amazon.co.uk/dp/B0XYZ67890", html, 100);
    expect(result.brief).toMatchObject({
      title: "Pocket Light",
      description: "A compact fill light",
      imageUrl: "https://images.example/light.jpg",
      features: [],
    });
    expect(result.warnings).toContain("No product feature claims were found; add or verify them manually.");
  });

  it("treats challenge and consent pages as expected import failures", () => {
    expect(() => importAmazonProductHtml(
      "https://www.amazon.com/dp/B0ABC12345",
      "<html><title>Robot Check</title><body>Enter the characters you see below</body></html>",
    )).toThrowError(/blocked/i);
  });

  it("rejects documents above the extraction size limit before parsing", () => {
    expect(() => importAmazonProductHtml(
      "https://www.amazon.com/dp/B0ABC12345",
      "x".repeat(2_000_001),
    )).toThrowError(/too large/i);
  });
});
