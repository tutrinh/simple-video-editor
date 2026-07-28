export interface PreviewMedia {
  play: () => Promise<void>;
  pause: () => void;
}

export function activePreviewMedia<T extends PreviewMedia>(
  primary: T | null,
  splitActive: boolean,
  slots: Array<T | null>,
): T[] {
  if (!splitActive) return primary ? [primary] : [];
  return [...new Set(slots.filter((slot): slot is T => Boolean(slot)))];
}

export async function playPreviewMedia(media: PreviewMedia[]) {
  const results = await Promise.allSettled(media.map((item) => item.play()));
  return results[0]?.status === "fulfilled";
}

export function pausePreviewMedia(media: PreviewMedia[]) {
  media.forEach((item) => item.pause());
}
