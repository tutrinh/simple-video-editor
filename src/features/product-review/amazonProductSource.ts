import type { ProductBrief, ProductClaim } from "../../domain/productReview";

const MAX_HTML_BYTES = 10_000_000;
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

export type ProductImportFailure =
  | "invalid-url"
  | "unsupported-domain"
  | "unsafe-url"
  | "not-a-product"
  | "blocked"
  | "too-large"
  | "no-product-data";

export class ProductImportError extends Error {
  constructor(
    public readonly reason: ProductImportFailure,
    message: string,
  ) {
    super(message);
    this.name = "ProductImportError";
  }
}

export type AmazonProductImportFailure = ProductImportFailure;
export const AmazonProductImportError = ProductImportError;

export interface NormalizedProductUrl {
  asin: string;
  canonicalUrl: string;
  hostname: string;
  kind: "amazon" | "web";
}

export type NormalizedAmazonProductUrl = NormalizedProductUrl;

export interface ProductImportResult {
  brief: ProductBrief;
  warnings: string[];
}

export type AmazonProductImport = ProductImportResult;

export function normalizeProductUrl(input: string): NormalizedProductUrl {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new ProductImportError("invalid-url", "Enter a complete product URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ProductImportError("unsafe-url", "Product links must use HTTP or HTTPS.");
  }
  if (url.username || url.password || (url.port && url.port !== "80" && url.port !== "443")) {
    throw new ProductImportError("unsafe-url", "Product links cannot include credentials or custom ports.");
  }
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0" || hostname.endsWith(".local")) {
    throw new ProductImportError("unsafe-url", "Local IP and network addresses cannot be imported.");
  }

  if (AMAZON_HOSTS.has(hostname)) {
    const match = url.pathname.match(/(?:\/dp\/|\/gp\/product\/|\/gp\/aw\/d\/)([A-Z0-9]{10})(?:[/?]|$)/i);
    if (match) {
      const asin = match[1].toUpperCase();
      return {
        asin,
        canonicalUrl: `https://${hostname}/dp/${asin}`,
        hostname,
        kind: "amazon",
      };
    }
  }

  const cleanUrl = new URL(url.toString());
  const searchParams = new URLSearchParams(cleanUrl.search);
  const keysToDelete: string[] = [];
  searchParams.forEach((_, key) => {
    if (/^(utm_|ref|fbclid|gclid|mc_eid|_ga)/i.test(key)) {
      keysToDelete.push(key);
    }
  });
  keysToDelete.forEach((key) => searchParams.delete(key));
  cleanUrl.search = searchParams.toString();

  return {
    asin: "",
    canonicalUrl: cleanUrl.toString(),
    hostname,
    kind: "web",
  };
}

export function normalizeAmazonProductUrl(input: string): { asin: string; canonicalUrl: string; hostname: string } {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new ProductImportError("invalid-url", "Enter a complete Amazon product URL.");
  }
  if (url.protocol !== "https:") {
    throw new ProductImportError("unsafe-url", "Amazon product links must use HTTPS.");
  }
  if (url.username || url.password || url.port) {
    throw new ProductImportError("unsafe-url", "Amazon product links cannot include credentials or a custom port.");
  }
  const hostname = url.hostname.toLowerCase();
  if (!AMAZON_HOSTS.has(hostname)) {
    throw new ProductImportError("unsupported-domain", "This Amazon domain is not supported.");
  }
  const match = url.pathname.match(/(?:\/dp\/|\/gp\/product\/|\/gp\/aw\/d\/)([A-Z0-9]{10})(?:[/?]|$)/i);
  if (!match) {
    throw new ProductImportError("not-a-product", "The link does not contain an Amazon product identifier.");
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
    for (const item of image) {
      if (typeof item === "string" && item.trim()) return item.trim();
      if (item && typeof item === "object") {
        const url = (item as Record<string, unknown>).url || (item as Record<string, unknown>).contentUrl;
        if (typeof url === "string" && url.trim()) return url.trim();
      }
    }
  }
  if (image && typeof image === "object") {
    const url = (image as Record<string, unknown>).url || (image as Record<string, unknown>).contentUrl;
    if (typeof url === "string") return decodeHtml(url);
  }
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

export function cleanAmazonTitle(rawTitle: string): string {
  let title = rawTitle
    .replace(/^Amazon\.[a-z.]+\s*:\s*/i, "")
    .replace(/:\s*Amazon\.[a-z.]+.*$/i, "")
    .replace(/:\s*Beauty & Personal Care.*$/i, "")
    .replace(/:\s*Everything Else.*$/i, "")
    .trim();

  if (title.length > 100) {
    const parts = title.split(/\s+[|:]\s+/);
    if (parts[0] && parts[0].trim().length >= 10) {
      title = parts[0].trim();
    }
  }
  return title;
}

export function cleanImageUrl(rawUrl: string): string {
  if (!rawUrl) return "";
  let url = rawUrl.trim();
  url = url
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");

  if (url.startsWith("//")) {
    url = `https:${url}`;
  }
  if (url.startsWith("/api/") || url.startsWith("blob:") || url.startsWith("data:")) {
    return url;
  }
  if (/^https?:\/\//i.test(url)) {
    return `/api/product/image?url=${encodeURIComponent(url)}`;
  }
  return url;
}

export function importAmazonProductHtml(
  sourceUrl: string,
  html: string,
  fetchedAt = Date.now(),
): AmazonProductImport {
  const normalized = normalizeProductUrl(sourceUrl);
  if (html.length > MAX_HTML_BYTES) {
    throw new AmazonProductImportError("too-large", "The product page response was too large to import safely.");
  }
  if (challengePage(html)) {
    throw new AmazonProductImportError("blocked", "The store blocked the product import; enter the details manually.");
  }

  const node = jsonLdProduct(html);
  
  let rawTitle = decodeHtml(node?.name) || metaContent(html, "og:title") || metaContent(html, "title");
  if (!rawTitle) {
    const spanTitleMatch = /<span\b[^>]*id\s*=\s*["']productTitle["'][^>]*>([\s\S]*?)<\/span>/i.exec(html);
    if (spanTitleMatch) rawTitle = decodeHtml(spanTitleMatch[1]);
  }
  if (!rawTitle) {
    const pageTitleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
    if (pageTitleMatch) {
      rawTitle = decodeHtml(pageTitleMatch[1]);
    }
  }

  const title = rawTitle && !/robot check|captcha/i.test(rawTitle) ? cleanAmazonTitle(rawTitle) : "";

  if (!title) {
    console.warn("[Product Import] Could not extract title from HTML length:", html.length);
    throw new AmazonProductImportError("no-product-data", "No product details were found on this product page.");
  }

  const brand = node ? productBrand(node) : "";
  let imageUrl = (node ? productImage(node) : "")
    || metaContent(html, "og:image")
    || metaContent(html, "og:image:secure_url")
    || metaContent(html, "twitter:image")
    || metaContent(html, "twitter:image:src");

  if (!imageUrl) {
    const linkMatch = /<link\b[^>]*rel=["'](?:image_src|preload)["'][^>]*href=["']([^"']+)["']/i.exec(html);
    if (linkMatch) imageUrl = linkMatch[1];
  }

  if (!imageUrl) {
    const cdnMatch = /(https:\/\/(?:target\.scene7\.com|images\.target|cdn\.shopify|images\.unsplash|m\.media-amazon|pisces\.bbystatic)[^"' \s]+\.(?:jpg|jpeg|png|webp|avif)(?:\?[^"' \s]*)?)/i.exec(html);
    if (cdnMatch) imageUrl = cdnMatch[1];
  }

  if (!imageUrl) {
    const landingImageMatch = /id=["']landingImage["'][^>]*src=["']([^"']+)["']/i.exec(html)
      || /data-old-hires=["']([^"']+)["']/i.exec(html)
      || /data-a-dynamic-image=["']\{&quot;([^&"]+)&quot;/i.exec(html);
    if (landingImageMatch) imageUrl = landingImageMatch[1];
  }

  if (imageUrl) {
    imageUrl = imageUrl
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, "\"")
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">");
    if (imageUrl.startsWith("//")) imageUrl = `https:${imageUrl}`;
  }

  const features = node ? productFeatures(node, normalized.asin || "web") : [];
  const warnings: string[] = [];
  if (features.length === 0) warnings.push("No product feature claims were found; add or verify them manually.");
  if (!brand) warnings.push("Brand was not found; verify it manually.");

  console.log("%c[Product Import DevTools Log]", "color: #ffb339; font-weight: bold;", {
    sourceUrl,
    asin: normalized.asin,
    title,
    brand: brand || "(none)",
    imageUrl: imageUrl || "(none)",
    featuresCount: features.length,
    warnings,
    htmlBytesReceived: html.length,
  });

  const source: ProductBrief["source"] = normalized.kind === "amazon"
    ? {
        kind: "amazon",
        url: sourceUrl,
        canonicalUrl: normalized.canonicalUrl,
        asin: normalized.asin,
        fetchedAt,
      }
    : {
        kind: "web",
        url: sourceUrl,
        canonicalUrl: normalized.canonicalUrl,
        fetchedAt,
      };

  const brief: ProductBrief = {
    source,
    title,
    features,
  };
  const category = decodeHtml(node?.category);
  const priceText = node ? productPrice(node) : "";
  if (brand) brief.brand = brand;
  if (category) brief.category = category;
  if (imageUrl) brief.imageUrl = imageUrl;
  if (priceText) brief.priceText = priceText;

  return { brief, warnings };
}
