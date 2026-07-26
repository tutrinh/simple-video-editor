import type { Beat, Clip } from "../domain/types";
import { sampleFrameAt } from "./frameSampler";

const cache = new Map<string, string>();
const pending = new Set<string>();

/**
 * Returns the data URL or poster URL for a Beat's cover thumbnail at its trim inSec.
 * Falls back to clip.poster initially, then asynchronously extracts and caches
 * the frame at beat.inSec.
 */
export function getBeatPosterUrl(beat: Beat | undefined, clip: Clip | undefined, onUpdate?: () => void): string | undefined {
  if (!clip || !beat) return undefined;
  if (clip.kind === "still" || !clip.file) {
    return clip.poster;
  }

  const roundedInSec = Math.round((beat.inSec || 0) * 10) / 10;
  const key = `${clip.id}:${roundedInSec}`;

  if (cache.has(key)) {
    return cache.get(key);
  }

  if (!pending.has(key)) {
    pending.add(key);
    sampleFrameAt(clip.file, roundedInSec, 360)
      .then((frame) => {
        cache.set(key, frame.dataUrl);
        pending.delete(key);
        onUpdate?.();
      })
      .catch(() => {
        pending.delete(key);
      });
  }

  return clip.poster;
}

/**
 * CSS background value for a Beat's cover thumbnail at its trim inSec.
 */
export function beatPosterBg(beat: Beat | undefined, clip: Clip | undefined, onUpdate?: () => void): string | undefined {
  const url = getBeatPosterUrl(beat, clip, onUpdate);
  return url ? `#0a0b0d url(${JSON.stringify(url)}) center/cover no-repeat` : undefined;
}
