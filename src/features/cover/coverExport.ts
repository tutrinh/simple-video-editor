import type { Aspect } from "../../domain/types";
import { canvasDims, projectFileBase } from "../export/export";

// Getting a Cover out of the app. The size readout is the point of this module:
// YouTube rejects a thumbnail over 2MB, and a PNG of a photographic frame goes
// past that routinely (ADR-0021). Finding out at upload time is the failure this
// prevents.

export type CoverFormat = "jpeg" | "png";

/**
 * Delivery quality. Higher than it needs to be for a photograph and lower than
 * the stored frame's 0.95, which is a source rather than an output.
 */
export const COVER_JPEG_QUALITY = 0.92;

/** YouTube's hard ceiling. Instagram and TikTok are looser; this is the binding one. */
export const YOUTUBE_MAX_BYTES = 2 * 1024 * 1024;

const MIME: Record<CoverFormat, string> = { jpeg: "image/jpeg", png: "image/png" };
const EXT: Record<CoverFormat, string> = { jpeg: "jpg", png: "png" };

export function coverMime(format: CoverFormat): string {
  return MIME[format];
}

export function coverExtension(format: CoverFormat): string {
  return EXT[format];
}

/** Quality is meaningless for PNG, and passing it is how you get a silent no-op. */
export function coverEncodeOptions(format: CoverFormat): [string, number | undefined] {
  return format === "jpeg" ? [MIME.jpeg, COVER_JPEG_QUALITY] : [MIME.png, undefined];
}

/**
 * The downloaded filename. One-based, so the second Cover is `-cover-2` rather
 * than the `-cover-1` a reader would expect the first to be.
 */
export function coverFileName(projectTitle: string, index: number, format: CoverFormat): string {
  const n = Math.max(1, Math.floor(index) + 1);
  return `${projectFileBase(projectTitle)}-cover-${n}.${EXT[format]}`;
}

/**
 * The pixel dimensions the active aspect exports at.
 *
 * Read from `canvasDims` rather than written out, so it cannot claim a size the
 * renderer does not produce — the whole reason to show it is to be believed.
 */
export function aspectResolutionLabel(aspect: Aspect): string {
  const [w, h] = canvasDims(aspect);
  return `${w} × ${h}`;
}

/** A byte count for the readout: KB up to a megabyte, MB beyond it. */
export function formatCoverSize(bytes: number): string {
  const b = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

/** True when this file would be rejected by YouTube. Drives the warning. */
export function exceedsYouTubeLimit(bytes: number): boolean {
  return bytes > YOUTUBE_MAX_BYTES;
}

/** Encode the rendered canvas. The same canvas the author has been editing. */
export function coverBlob(canvas: HTMLCanvasElement, format: CoverFormat): Promise<Blob> {
  const [mime, quality] = coverEncodeOptions(format);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("cover encode failed"))),
      mime,
      quality,
    );
  });
}
