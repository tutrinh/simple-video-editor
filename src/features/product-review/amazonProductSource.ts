import type { ProductBrief, ProductClaim } from "../../domain/productReview";

const MAX_HTML_BYTES = 2_000_000;
const AMAZON_HOSTS = new Set([
  "amazon.com",
  "www.amazon.com",
  "amazon.ca",
  "www.amazon.ca",
  "amazon.com.mx",
  "www.amazon.com.mx",
  "amazon.com.br",
  "www.amazon.com.br",
  "amazon.co.uk",
  "www.amazon.co.uk",
  "amazon.de",
  "www.amazon.de",
  "amazon.fr",
  "www.amazon.fr",
  "amazon.it",
  "www.amazon.it",
  "amazon.es",
  "www.amazon.es",
  "amazon.nl",
  "www.amazon.nl",
  "amazon.se",
  "www.amazon.se",
  "amazon.pl",
  "www.amazon.pl",
  "amazon.com.au",
  "www.amazon.com.au",
  "amazon.co.jp",
  "www.amazon.co.jp",
  "amazon.in",
  "www.amazon.in",
  "amazon.sg",
  "www.amazon.sg",
  "amazon.ae",
  "www.amazon.ae",
  "amazon.sa",
  "www.amazon.sa",
]);

export type AmazonProductImportFailure =
  | "invalid-url"
  | "unsupported-domain"
  | "unsafe-url"
  | "not-a-product"
  | "blocked"
  | "too-large"
  | "no-product-data";

export class AmazonProductImportError extends Error {
  constructor(
    public readonly reason: AmazonProductImportFailure,
    message: string,
  ) {
    super(message);
    this.name = "AmazonProductImportError";
  }
}

export interface NormalizedAmazonProductUrl {
  asin: string;
  canonicalUrl: string;
  hostname: string;
}

export interface AmazonProductImport {
  brief: ProductBrief;
  warnings: string[];
}

export function normalizeAmazonProductUrl(input: string): NormalizedAmazonProductUrl {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new AmazonProductImportError("invalid-url", "Enter a complete Amazon product URL.");
  }
  if (url.protocol !== "https:") {
    throw new AmazonProductImportError("unsafe-url", "Amazon product links must use HTTPS.");
  }
  if (url.username || url.password || url.port) {
    throw new AmazonProductImportError("unsafe-url", "Amazon product links cannot include credentials or a custom port.");
  }
  const hostname = url.hostname.toLowerCase();
  if (!AMAZON_HOSTS.has(hostname)) {
    throw new AmazonProductImportError("unsupported-domain", "This Amazon domain is not supported.");
  }
  const match = url.pathname.match(/(?:\/dp\/|\/gp\/product\/|\/gp\/aw\/d\/)([A-Z0-9]{10})(?:[/?]|$)/i);
  if (!match) {
    throw new AmazonProductImportError("not-a-product", "The link does not contain an Amazon product identifier.");
  }
  const asin = match[1].toUpperCase();
  return {
    asin,
    canonicalUrl: `https://${hostname}/dp/${asin}`,
    hostname,
  };
}

function decodeHtml(value: unknown): string {
  if (typeof value !== "string") return "";
  const decoded = value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/<[^>]*>/g, " ");
  return decoded.replace(/\s+/g, " ").trim();
}

function isProductNode(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const type = (value as Record<string, unknown>)["@type"];
  return type === "Product" || (Array.isArray(type) && type.includes("Product"));
}

function findProductNode(value: unknown): Record<string, unknown> | null {
  if (isProductNode(value)) return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findProductNode(item);
      if (found) return found;
    }
  } else if (value && typeof value === "object") {
    const graph = (value as Record<string, unknown>)["@graph"];
    if (graph) return findProductNode(graph);
  }
  return null;
}

function jsonLdProduct(html: string): Record<string, unknown> | null {
  const scriptPattern = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(scriptPattern)) {
    try {
      const parsed = JSON.parse(match[1].trim());
      const found = findProductNode(parsed);
      if (found) return found;
    } catch {
      // Seller pages often contain unrelated malformed JSON-LD. Keep looking.
    }
  }
  return null;
}

function metaContent(html: string, key: string): string {
  const metaPattern = /<meta\b[^>]*>/gi;
  for (const tag of html.match(metaPattern) ?? []) {
    const attrs = new Map<string, string>();
    for (const match of tag.matchAll(/([:\w-]+)\s*=\s*(["'])(.*?)\2/gi)) {
      attrs.set(match[1].toLowerCase(), match[3]);
    }
    const metaKey = attrs.get("property") ?? attrs.get("name");
    if (metaKey?.toLowerCase() === key.toLowerCase()) return decodeHtml(attrs.get("content"));
  }
  return "";
}

function productBrand(node: Record<string, unknown>): string {
  const brand = node.brand;
  if (typeof brand === "string") return decodeHtml(brand);
  if (brand && typeof brand === "object") return decodeHtml((brand as Record<string, unknown>).name);
  return "";
}

function productImage(node: Record<string, unknown>): string {
  const image = node.image;
  if (typeof image === "string") return image;
  if (Array.isArray(image)) {
    const first = image.find((item) => typeof item === "string");
    return typeof first === "string" ? first : "";
  }
  if (image && typeof image === "object") return decodeHtml((image as Record<string, unknown>).url);
  return "";
}

function productFeatures(node: Record<string, unknown>, asin: string): ProductClaim[] {
  const claims: string[] = [];
  const props = Array.isArray(node.additionalProperty) ? node.additionalProperty : [];
  for (const prop of props) {
    if (!prop || typeof prop !== "object") continue;
    const item = prop as Record<string, unknown>;
    const name = decodeHtml(item.name);
    const value = decodeHtml(item.value);
    const text = name && value ? `${name}: ${value}` : value || name;
    if (text) claims.push(text);
  }
  const unique = [...new Set(claims)].slice(0, 12);
  return unique.map((text, index) => ({
    id: `listing-${asin}-${index + 1}`,
    text,
    source: "listing",
  }));
}

function productPrice(node: Record<string, unknown>): string {
  const offers = Array.isArray(node.offers) ? node.offers[0] : node.offers;
  if (!offers || typeof offers !== "object") return "";
  const record = offers as Record<string, unknown>;
  const price = decodeHtml(record.price);
  const currency = decodeHtml(record.priceCurrency);
  return price ? [currency, price].filter(Boolean).join(" ") : "";
}

function challengePage(html: string): boolean {
  return /robot check|enter the characters you see|api-services-support@amazon|captcha/i.test(html);
}

export function importAmazonProductHtml(
  sourceUrl: string,
  html: string,
  fetchedAt = Date.now(),
): AmazonProductImport {
  const normalized = normalizeAmazonProductUrl(sourceUrl);
  if (html.length > MAX_HTML_BYTES) {
    throw new AmazonProductImportError("too-large", "The Amazon response was too large to import safely.");
  }
  if (challengePage(html)) {
    throw new AmazonProductImportError("blocked", "Amazon blocked the product import; enter the details manually.");
  }

  const node = jsonLdProduct(html);
  const title = decodeHtml(node?.name) || metaContent(html, "og:title");
  if (!title) {
    throw new AmazonProductImportError("no-product-data", "No product details were found on this Amazon page.");
  }

  const brand = node ? productBrand(node) : "";
  const description = decodeHtml(node?.description) || metaContent(html, "og:description");
  const imageUrl = (node ? productImage(node) : "") || metaContent(html, "og:image");
  const features = node ? productFeatures(node, normalized.asin) : [];
  const warnings: string[] = [];
  if (features.length === 0) warnings.push("No product feature claims were found; add or verify them manually.");
  if (!brand) warnings.push("Brand was not found; verify it manually.");

  const brief: ProductBrief = {
    source: {
      kind: "amazon",
      url: sourceUrl,
      canonicalUrl: normalized.canonicalUrl,
      asin: normalized.asin,
      fetchedAt,
    },
    title,
    features,
  };
  const category = decodeHtml(node?.category);
  const priceText = node ? productPrice(node) : "";
  if (brand) brief.brand = brand;
  if (category) brief.category = category;
  if (description) brief.description = description;
  if (imageUrl) brief.imageUrl = imageUrl;
  if (priceText) brief.priceText = priceText;

  return { brief, warnings };
}
