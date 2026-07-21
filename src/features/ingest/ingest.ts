import type { Clip } from "../../domain/types";
import { probeVideo } from "../../lib/frameSampler";
import { runIsolated } from "../../lib/ffmpegEngine";

// Ingest logic (ADR-0002): probe metadata, and normalize oversized (4K+) clips
// down to 1080p so everything downstream runs in one memory-friendly space.

async function fileBytes(file: Blob): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

function extOf(name: string): string {
  const m = name.match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : "mp4";
}

/** Read a file's metadata and build a Clip (no normalization/description yet). */
export async function createClip(file: File): Promise<Clip> {
  const meta = await probeVideo(file);
  return {
    id: crypto.randomUUID(),
    file,
    name: file.name,
    durationSec: meta.durationSec,
    width: meta.width,
    height: meta.height,
  };
}

/** True when the clip's long edge exceeds 1080p and it needs downscaling. */
export function needsNormalize(clip: Pick<Clip, "width" | "height">): boolean {
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
