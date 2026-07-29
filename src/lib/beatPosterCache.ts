import type { Beat, Clip } from "../domain/types";
import { sampleFrameAt } from "./frameSampler";

const MAX_CACHE_ENTRIES = 100;
const cache = new Map<string, string>();
const pending = new Set<string>();

// Bounded queue for frame sampling tasks to avoid concurrent HTML5 video decoder overload
let activeSamplerCount = 0;
const MAX_CONCURRENT_SAMPLERS = 2;
const samplingQueue: Array<() => Promise<void>> = [];

function processSamplingQueue() {
  while (activeSamplerCount < MAX_CONCURRENT_SAMPLERS && samplingQueue.length > 0) {
    const task = samplingQueue.shift();
    if (task) {
      activeSamplerCount++;
      task().finally(() => {
        activeSamplerCount--;
        processSamplingQueue();
      });
    }
  }
}

function setCacheEntry(key: string, value: string) {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }
  cache.set(key, value);
}

/**
 * Returns the data URL or poster URL for a Beat's cover thumbnail at its trim inSec.
 * Falls back to clip.poster initially, then asynchronously extracts and caches
 * the frame at beat.inSec.
 */
export function getBeatPosterUrl(beat: Beat | undefined, clip: Clip | undefined, onUpdate?: () => void): string | undefined {
  if (!clip || !beat) return undefined;
  if (clip.isTemplatePlaceholder) return undefined;
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
    samplingQueue.push(async () => {
      try {
        const frame = await sampleFrameAt(clip.file, roundedInSec, 360);
        setCacheEntry(key, frame.dataUrl);
        pending.delete(key);
        onUpdate?.();
      } catch {
        pending.delete(key);
      }
    });
    processSamplingQueue();
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

