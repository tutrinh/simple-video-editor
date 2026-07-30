import { AmazonProductImportError, importAmazonProductHtml, normalizeProductUrl } from "../features/product-review/amazonProductSource";

const MAX_REDIRECTS = 3;
const MAX_HTML_BYTES = 10_000_000;
const REQUEST_TIMEOUT_MS = 10_000;

type PageFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function fetchAmazonProduct(
  sourceUrl: string,
  pageFetch: PageFetch = fetch,
  fetchedAt = Date.now(),
) {
  const source = normalizeProductUrl(sourceUrl);
  let currentUrl = source.canonicalUrl;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
      const response = await pageFetch(currentUrl, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          accept: "text/html,application/xhtml+xml",
          "accept-language": "en-US,en;q=0.8",
          "user-agent": "VIDSTR Local Product Import/1.0",
        },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new AmazonProductImportError("no-product-data", "The store returned an empty redirect.");
        if (redirect === MAX_REDIRECTS) {
          throw new AmazonProductImportError("no-product-data", "The store returned too many redirects.");
        }
        const next = new URL(location, currentUrl).toString();
        currentUrl = normalizeProductUrl(next).canonicalUrl;
        continue;
      }
      if (!response.ok) {
        throw new AmazonProductImportError(
          response.status === 429 || response.status === 403 ? "blocked" : "no-product-data",
          `The store returned HTTP ${response.status}.`,
        );
      }
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
        throw new AmazonProductImportError("no-product-data", "The product page did not return HTML.");
      }
      const declaredLength = Number(response.headers.get("content-length") ?? 0);
      if (declaredLength > MAX_HTML_BYTES) {
        throw new AmazonProductImportError("too-large", "The product page response was too large to import safely.");
      }
      const html = await response.text();
      if (html.length > MAX_HTML_BYTES) {
        throw new AmazonProductImportError("too-large", "The product page response was too large to import safely.");
      }
      return importAmazonProductHtml(sourceUrl, html, fetchedAt);
    }
    throw new AmazonProductImportError("no-product-data", "The store returned too many redirects.");
  } finally {
    clearTimeout(timeout);
  }
}

