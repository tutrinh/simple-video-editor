import type { Clip } from "../../domain/types";
import { probeVideo, probeStill } from "../../lib/frameSampler";
import { runIsolated } from "../../lib/ffmpegEngine";

// Ingest logic (ADR-0002): probe metadata, and normalize oversized (4K+) clips
// down to 1080p so everything downstream runs in one memory-friendly space.
// Stills (ADR-0012) come in through the same door and skip both.

const STILL_EXT_RE = /\.(jpe?g|png|webp|avif|bmp|gif|heic|heif)$/i;
const HEIC_EXT_RE = /\.(heic|heif)$/i;
const HEIC_MIME_RE = /^image\/(heic|heif)$/i;

/**
 * True when a file should import as a Still rather than footage (ADR-0012).
 * MIME wins when the browser supplied one — it is the only way to tell a
 * `video/webm` from a `.webp` when a name is misleading — and the extension is
 * the fallback for the drops that arrive with an empty `type`.
 */
export function isStillFile(file: Pick<File, "name" | "type">): boolean {
  if (file.type.startsWith("image/")) return true;
  if (file.type.startsWith("video/")) return false;
  return STILL_EXT_RE.test(file.name);
}

/** True for Apple's HEIC/HEIF still-image containers. */
export function isHeicFile(file: Pick<File, "name" | "type">): boolean {
  if (HEIC_MIME_RE.test(file.type)) return true;
  if (file.type.startsWith("video/")) return false;
  return HEIC_EXT_RE.test(file.name);
}

/**
 * Convert HEIC at the import boundary so every browser preview, canvas render,
 * project save, and FFmpeg export downstream receives an ordinary JPEG.
 */
export async function prepareStillFile(file: File): Promise<File> {
  if (!isHeicFile(file)) return file;

  // heic-to tracks current libheif releases. This matters for iOS 18+, whose
  // auxiliary image metadata is rejected as invalid by heic2any's old build.
  const { heicTo } = await import("heic-to");
  const jpeg = await heicTo({ blob: file, type: "image/jpeg", quality: 0.95 });

  const jpegName = HEIC_EXT_RE.test(file.name)
    ? file.name.replace(HEIC_EXT_RE, ".jpg")
    : `${file.name || "image"}.jpg`;
  return new File([jpeg], jpegName, { type: "image/jpeg", lastModified: file.lastModified });
}

/**
 * `accept` for a file input that takes a still picture. Enumerated rather than
 * `image/*` so it cannot drift from STILL_EXT_RE — and so SVG stays out, since
 * ffmpeg has no decoder for it (an SVG belongs on the Sticker track).
 *
 * A Cover's picture uses this directly (ADR-0021): SVG is excluded there for its
 * own reason — an SVG has no intrinsic pixel size to cap and taints a canvas —
 * but the answer is the same list, so there is one list.
 */
export const COVER_FILE_ACCEPT =
  "image/jpeg,image/png,image/webp,image/avif,image/bmp,image/gif,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.avif,.bmp,.gif,.heic,.heif";

/** `accept` for a file input that takes footage and Stills. */
export const CLIP_FILE_ACCEPT = `video/*,${COVER_FILE_ACCEPT}`;

async function fileBytes(file: Blob): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

function extOf(name: string): string {
  const m = name.match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : "mp4";
}

/** Read a file's metadata and build a Clip (no normalization/description yet). */
export async function createClip(file: File): Promise<Clip> {
  const still = isStillFile(file);
  const source = still ? await prepareStillFile(file) : file;
  const meta = still ? await probeStill(source) : await probeVideo(source);
  return {
    id: crypto.randomUUID(),
    file: source,
    name: source.name,
    durationSec: meta.durationSec,
    width: meta.width,
    height: meta.height,
    ...(meta.fps ? { fps: meta.fps } : {}),
    ...(still ? { kind: "still" as const } : {}),
  };
}

/**
 * True when a clip requires normalization on import.
 * Returns false so 4K and high-resolution clips preserve their original
 * resolution and visual quality without lossy re-encoding on import.
 */
export function needsNormalize(_clip: Pick<Clip, "width" | "height"> & Partial<Pick<Clip, "kind">>): boolean {
  return false;
}

/**
 * Downscale a clip to fit within 1920×1080 (aspect preserved — no padding; the
 * export stage letterboxes to the chosen canvas). Runs in an isolated engine.
 */
export async function normalizeTo1080p(file: File, onProgress?: (f: number) => void): Promise<Blob> {
  const name = `in.${extOf(file.name)}`;
  const bytes = await fileBytes(file);
  const out = await runIsolated(
    [{ name, data: bytes }],
    ["-i", name,
     "-vf", "scale=1920:1080:force_original_aspect_ratio=decrease,setsar=1",
     "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
     "-c:a", "aac", "-movflags", "+faststart", "out.mp4"],
    "out.mp4",
    onProgress,
  );
  return new Blob([out], { type: "video/mp4" });
}
