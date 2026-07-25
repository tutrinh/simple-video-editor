import type { Clip } from "../../domain/types";
import { probeVideo, probeStill } from "../../lib/frameSampler";
import { runIsolated } from "../../lib/ffmpegEngine";

// Ingest logic (ADR-0002): probe metadata, and normalize oversized (4K+) clips
// down to 1080p so everything downstream runs in one memory-friendly space.
// Stills (ADR-0012) come in through the same door and skip both.

const STILL_EXT_RE = /\.(jpe?g|png|webp|avif|bmp|gif)$/i;

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

/**
 * `accept` for a file input that takes footage and Stills. Enumerated rather
 * than `image/*` so it cannot drift from STILL_EXT_RE — and so SVG stays out,
 * since ffmpeg has no decoder for it (an SVG belongs on the Sticker track).
 */
export const CLIP_FILE_ACCEPT =
  "video/*,image/jpeg,image/png,image/webp,image/avif,image/bmp,image/gif,.jpg,.jpeg,.png,.webp,.avif,.bmp,.gif";

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
  const meta = still ? await probeStill(file) : await probeVideo(file);
  return {
    id: crypto.randomUUID(),
    file,
    name: file.name,
    durationSec: meta.durationSec,
    width: meta.width,
    height: meta.height,
    ...(still ? { kind: "still" as const } : {}),
  };
}

/**
 * True when the clip's long edge exceeds 1080p and it needs downscaling. Never
 * a Still: normalizeTo1080p runs libx264, which would turn a photo into a
 * one-frame video and cost us the image input the export stage wants.
 */
export function needsNormalize(clip: Pick<Clip, "width" | "height"> & Partial<Pick<Clip, "kind">>): boolean {
  if (clip.kind === "still") return false;
  return Math.max(clip.width, clip.height) > 1920;
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
     "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
     "-c:a", "aac", "-movflags", "+faststart", "out.mp4"],
    "out.mp4",
    onProgress,
  );
  return new Blob([out], { type: "video/mp4" });
}
