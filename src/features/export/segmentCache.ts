import type { EngineInput } from "../../lib/ffmpegEngine";

interface CacheEntry {
  bytes: Uint8Array<ArrayBuffer>;
  size: number;
}

const entries = new Map<string, CacheEntry>();
let totalBytes = 0;

function cacheBudgetBytes(): number {
  const mem = typeof navigator !== "undefined"
    ? (navigator as { deviceMemory?: number }).deviceMemory
    : undefined;
  if (typeof mem === "number" && mem <= 4) return 192 * 1024 * 1024;
  if (typeof mem === "number" && mem <= 8) return 384 * 1024 * 1024;
  return 512 * 1024 * 1024;
}

function hex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Hash the exact FFmpeg argv and input bytes. A cache hit therefore reuses only
 * a bit-identical Beat render, regardless of which Project setting changed.
 */
export async function segmentCacheKey(inputs: EngineInput[], args: string[]): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  const manifest: string[] = [JSON.stringify(args)];
  for (const input of inputs) {
    const digest = await globalThis.crypto.subtle.digest(
      "SHA-256",
      input.data as Uint8Array<ArrayBuffer>,
    );
    manifest.push(`${input.name}:${input.data.byteLength}:${hex(digest)}`);
  }
  const keyDigest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(manifest.join("\n")),
  );
  return hex(keyDigest);
}

export function getCachedSegment(key: string): Uint8Array<ArrayBuffer> | null {
  const entry = entries.get(key);
  if (!entry) return null;
  // Refresh insertion order so eviction is least-recently-used.
  entries.delete(key);
  entries.set(key, entry);
  return entry.bytes;
}

export function cacheSegment(key: string, bytes: Uint8Array<ArrayBuffer>): void {
  const existing = entries.get(key);
  if (existing) {
    totalBytes -= existing.size;
    entries.delete(key);
  }
  entries.set(key, { bytes, size: bytes.byteLength });
  totalBytes += bytes.byteLength;

  const budget = cacheBudgetBytes();
  while (totalBytes > budget && entries.size > 1) {
    const oldestKey = entries.keys().next().value as string | undefined;
    if (!oldestKey) break;
    const oldest = entries.get(oldestKey);
    entries.delete(oldestKey);
    if (oldest) totalBytes -= oldest.size;
  }
}

/** Test/support hook; also useful if a future "clear render cache" UI is added. */
export function clearSegmentCache(): void {
  entries.clear();
  totalBytes = 0;
}
