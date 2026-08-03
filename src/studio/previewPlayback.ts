export interface PreviewMedia {
  play: () => Promise<void>;
  pause: () => void;
}

export interface RateControlledPreviewMedia {
  playbackRate: number;
  defaultPlaybackRate: number;
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

/**
 * Keep both rate fields aligned. Browsers may restore `playbackRate` from
 * `defaultPlaybackRate` while a newly assigned source loads, so setting only
 * the live value makes slow motion depend on metadata timing.
 */
export function applyPreviewSpeed(media: RateControlledPreviewMedia[], speed: number) {
  const usableSpeed = Number.isFinite(speed) && speed > 0 ? speed : 1;
  media.forEach((item) => {
    item.defaultPlaybackRate = usableSpeed;
    item.playbackRate = usableSpeed;
  });
}
