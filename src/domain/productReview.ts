import type { ClipDescription } from "./types";

export type ProductSourceKind = "amazon" | "web" | "manual";
export type ProductClaimSource = "listing" | "author-entered";
export type ReviewDisclosure = "purchased" | "gifted" | "sponsored" | "affiliate" | "unspecified";
export type ReviewDurationSec = 15 | 30 | 45 | 60;
export type ReviewPurpose = "hook" | "problem" | "demo" | "proof" | "verdict" | "cta";
export type ReviewShotCapture = "talking-head" | "product-beauty" | "detail" | "demo" | "result" | "b-roll";
export type ReviewShotFraming = "wide" | "medium" | "close-up" | "macro" | "overhead" | "screen";

export interface ProductBrief {
  source: {
    kind: ProductSourceKind;
    url?: string;
    canonicalUrl?: string;
    asin?: string;
    fetchedAt?: number;
  };
  title: string;
  brand?: string;
  category?: string;
  description?: string;
  features: ProductClaim[];
  imageUrl?: string;
  priceText?: string;
}

export interface ProductClaim {
  id: string;
  text: string;
  source: ProductClaimSource;
}

export interface CreatorNotes {
  audience: string;
  problem: string;
  experience: string;
  pros: string[];
  cons: string[];
  verdict: string;
  callToAction?: string;
  disclosure: ReviewDisclosure;
}

export type CreatorNoteField = keyof CreatorNotes;

export type ReviewEvidenceRef =
  | { kind: "product-claim"; claimId: string }
  | { kind: "creator-note"; field: CreatorNoteField };

export interface ReviewScriptSegment {
  id: string;
  text: string;
  purpose: ReviewPurpose;
  approxDurationSec: number;
  evidence: ReviewEvidenceRef[];
  shotId: string;
}

export interface ReviewShot {
  id: string;
  description: string;
  capture: ReviewShotCapture;
  framing: ReviewShotFraming;
  approxDurationSec: number;
  matchedClipId?: string;
}

export interface ReviewPlan {
  id: string;
  productTitle: string;
  targetDurationSec: ReviewDurationSec;
  hook: string;
  script: ReviewScriptSegment[];
  shots: ReviewShot[];
  disclosureReminder?: string;
  createdAt: number;
}

export interface ProductReviewWorkspace {
  brief?: ProductBrief;
  creatorNotes: CreatorNotes;
  plan?: ReviewPlan;
  importWarnings?: string[];
}

export interface ReviewClipSummary {
  id: string;
  name: string;
  description?: ClipDescription;
  tags?: string[];
}

export function emptyCreatorNotes(): CreatorNotes {
  return {
    audience: "",
    problem: "",
    experience: "",
    pros: [],
    cons: [],
    verdict: "",
    callToAction: "",
    disclosure: "unspecified",
  };
}

