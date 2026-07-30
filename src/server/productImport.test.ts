import { describe, expect, it } from "vitest";
import { fetchAmazonProduct } from "./productImport";

const html = `
  <script type="application/ld+json">
    {"@type":"Product","name":"Pocket Light","additionalProperty":[{"name":"Power","value":"12 W"}]}
  </script>`;

describe("fetchAmazonProduct", () => {
  it("returns normalized JSON from an allowed public Amazon page", async () => {
    const result = await fetchAmazonProduct(
      "https://www.amazon.com/dp/B0ABC12345",
      async () => new Response(html, { status: 200, headers: { "content-type": "text/html" } }),
      100,
    );
    expect(result.brief).toMatchObject({
      source: { asin: "B0ABC12345", fetchedAt: 100 },
      title: "Pocket Light",
      features: [{ text: "Power: 12 W" }],
    });
  });

  it("validates every redirect and refuses to follow a redirect off Amazon", async () => {
    let calls = 0;
    await expect(fetchAmazonProduct(
      "https://www.amazon.com/dp/B0ABC12345",
      async () => {
        calls++;
        return new Response(null, {
          status: 302,
          headers: { location: "https://127.0.0.1/internal" },
        });
      },
    )).rejects.toThrow(/Amazon domain|supported/i);
    expect(calls).toBe(1);
  });

  it("rejects non-HTML and oversized responses before extraction", async () => {
    await expect(fetchAmazonProduct(
      "https://www.amazon.com/dp/B0ABC12345",
      async () => new Response("{}", { headers: { "content-type": "application/json" } }),
    )).rejects.toThrow(/HTML/i);

    await expect(fetchAmazonProduct(
      "https://www.amazon.com/dp/B0ABC12345",
      async () => new Response("x", {
        headers: { "content-type": "text/html", "content-length": "2000001" },
      }),
    )).rejects.toThrow(/too large/i);
  });

  it("stops redirect loops after the fixed redirect budget", async () => {
    await expect(fetchAmazonProduct(
      "https://www.amazon.com/dp/B0ABC12345",
      async () => new Response(null, {
        status: 302,
        headers: { location: "https://www.amazon.com/dp/B0ABC12345" },
      }),
    )).rejects.toThrow(/redirect/i);
  });
});
