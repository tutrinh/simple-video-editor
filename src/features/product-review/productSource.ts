import type { ProductBrief } from "../../domain/productReview";
import type { AmazonProductImportFailure } from "./amazonProductSource";

export type ProductImportFailure = AmazonProductImportFailure | "network" | "invalid-response";

export type ProductImportResult =
  | { ok: true; brief: ProductBrief; warnings: string[] }
  | { ok: false; reason: ProductImportFailure; message: string; manualSeed: Partial<ProductBrief> };

export interface ProductSource {
  import(input: { url: string }): Promise<ProductImportResult>;
}

type ProductRouteFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function createAmazonProductSource(fetchRoute: ProductRouteFetch = fetch): ProductSource {
  return {
    async import({ url }): Promise<ProductImportResult> {
      const manualSeed: Partial<ProductBrief> = {
        source: { kind: "manual", url },
        features: [],
      };
      try {
        const response = await fetchRoute("/api/product/amazon", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url }),
        });
        const data = await response.json().catch(() => null) as {
          brief?: ProductBrief;
          warnings?: string[];
          error?: string;
          reason?: ProductImportFailure;
        } | null;
        if (!response.ok || !data?.brief) {
          return {
            ok: false,
            reason: data?.reason ?? "invalid-response",
            message: data?.error ?? `Product import failed with HTTP ${response.status}.`,
            manualSeed,
          };
        }
        return { ok: true, brief: data.brief, warnings: data.warnings ?? [] };
      } catch {
        return {
          ok: false,
          reason: "network",
          message: "The local product import route is unavailable.",
          manualSeed,
        };
      }
    },
  };
}

export interface ManualProductFields {
  title: string;
  brand?: string;
  description?: string;
  category?: string;
  imageUrl?: string;
  priceText?: string;
  featureText?: string;
  sourceUrl?: string;
}

export function createManualProductBrief(fields: ManualProductFields): ProductBrief {
  const featureLines = (fields.featureText ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const uniqueFeatures = [...new Set(featureLines)];
  const brief: ProductBrief = {
    source: {
      kind: "manual",
      ...(fields.sourceUrl?.trim() ? { url: fields.sourceUrl.trim() } : {}),
    },
    title: fields.title.trim(),
    features: uniqueFeatures.map((text, index) => ({
      id: `manual-${index + 1}`,
      text,
      source: "author-entered",
    })),
  };
  const optional = {
    brand: fields.brand?.trim(),
    description: fields.description?.trim(),
    category: fields.category?.trim(),
    imageUrl: fields.imageUrl?.trim(),
    priceText: fields.priceText?.trim(),
  };
  for (const [key, value] of Object.entries(optional)) {
    if (value) (brief as unknown as Record<string, unknown>)[key] = value;
  }
  return brief;
}

