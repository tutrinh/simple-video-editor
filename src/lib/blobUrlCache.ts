/**
 * Permanent, stable Blob URL cache for media objects.
 * Prevents premature revocation of Blob URLs while HTML5 <video> elements are rendering.
 */
const blobUrlCache = new WeakMap<Blob, string>();

export function getClipBlobUrl(src: Blob | File | undefined | null): string | undefined {
  if (!src) return undefined;
  let cached = blobUrlCache.get(src);
  if (!cached) {
    try {
      cached = URL.createObjectURL(src);
      blobUrlCache.set(src, cached);
    } catch {
      return undefined;
    }
  }
  return cached;
}
