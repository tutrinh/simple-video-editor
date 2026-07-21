/**
 * Run `worker` over `items` with at most `limit` running at once.
 *
 * Used to normalize several clips concurrently without spawning an unbounded
 * number of ffmpeg engines — each 4K wasm transcode is memory-heavy (ADR-0002),
 * so the caller caps the width. Every item is processed exactly once; completion
 * order is not guaranteed. A worker rejection propagates (in-flight lanes finish
 * their current item first), so callers that must not abort should catch inside
 * the worker.
 */
export async function runPool<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  const n = items.length;
  const width = Math.max(1, Math.min(Math.floor(limit), n));
  if (n === 0) return;
  let next = 0;
  async function lane(): Promise<void> {
    while (next < n) {
      const i = next++;
      await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: width }, lane));
}
