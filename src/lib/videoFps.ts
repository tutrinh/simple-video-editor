/**
 * Measuring a source's own frame rate.
 *
 * The browser exposes no frame-rate property — `HTMLVideoElement` reports size
 * and duration and nothing else — so the only way to learn it without parsing
 * the container is to watch frames go past. `requestVideoFrameCallback` reports
 * a `mediaTime` and a running `presentedFrames`, and the rate is the slope
 * between two samples of those.
 *
 * It is best-effort by design: an unsupported browser, a still, or a clip that
 * will not start playing all return undefined, and every caller treats a missing
 * rate as simply unknown.
 */

/**
 * The frame rates imported footage is expected to arrive at.
 *
 * A measurement is reported as whichever of these it is nearest, with no
 * tolerance gate: they are far enough apart — the closest pair is 24 and 30, a
 * 25% step — that ordinary measurement error cannot confuse two of them, and a
 * raw 29.94 helps nobody. Broadcast fractional rates (23.976, 29.97, 59.94) are
 * deliberately absent; if footage at those rates ever needs distinguishing, they
 * go here and the nearest-match below keeps working unchanged.
 */
export const KNOWN_RATES = [24, 30, 60, 120] as const;

/** Report a measured rate as the nearest rate footage actually arrives at. */
export function snapFps(measured: number): number {
  if (!Number.isFinite(measured) || measured <= 0) return measured;
  let best: number = KNOWN_RATES[0];
  let bestError = Infinity;
  for (const rate of KNOWN_RATES) {
    // Relative, not absolute: 45 sits midway between 24 and 60 in absolute
    // terms but is proportionally much nearer 60, which is the better guess.
    const error = Math.abs(rate - measured) / rate;
    if (error < bestError) {
      bestError = error;
      best = rate;
    }
  }
  return best;
}

/** How a frame rate is written for the Author: "60", "29.97", "23.98". */
export function formatFps(fps: number): string {
  if (!Number.isFinite(fps) || fps <= 0) return "";
  const rounded = Math.round(fps * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

/**
 * Measure a source file's frame rate from scratch. Used to backfill Clips that
 * were imported before frame rate was recorded; ingest measures the element it
 * already has instead. Always reads the ORIGINAL file, never a normalized copy,
 * because it is the source's own rate the Author is being shown.
 */
export async function measureBlobFps(
  src: Blob,
  options: MeasureFpsOptions = {},
): Promise<number | undefined> {
  if (typeof document === "undefined") return undefined;
  const url = URL.createObjectURL(src);
  const video = document.createElement("video");
  video.src = url;
  video.muted = true;
  video.preload = "auto";
  try {
    const ready = await new Promise<boolean>((resolve) => {
      video.onloadedmetadata = () => resolve(true);
      video.onerror = () => resolve(false);
    });
    if (!ready) return undefined;
    return await measureVideoFps(video, options);
  } catch {
    return undefined;
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

interface FrameMeta {
  mediaTime: number;
  presentedFrames: number;
}

type FrameCallbackVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta: FrameMeta) => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

export interface MeasureFpsOptions {
  /** Frames to let pass before trusting the slope. */
  minFrames?: number;
  /** Source seconds that must elapse before trusting the slope. */
  minMediaSpanSec?: number;
  /** Give up after this long, so ingest is never held hostage by one file. */
  timeoutMs?: number;
}

/**
 * Measure `video`'s frame rate by playing it briefly and reading the slope of
 * `presentedFrames` against `mediaTime`. Resolves undefined when it cannot be
 * determined. Leaves the element paused and back at its original position.
 */
export async function measureVideoFps(
  video: HTMLVideoElement,
  options: MeasureFpsOptions = {},
): Promise<number | undefined> {
  const target = video as FrameCallbackVideo;
  if (typeof target.requestVideoFrameCallback !== "function") return undefined;

  const minFrames = options.minFrames ?? 8;
  const minSpan = options.minMediaSpanSec ?? 0.15;
  const timeoutMs = options.timeoutMs ?? 1200;

  const wasMuted = video.muted;
  const startTime = video.currentTime;
  video.muted = true;
  video.playsInline = true;

  // `requestVideoFrameCallback` fires when a frame is presented to the
  // compositor, and a <video> that is not in the document may never present one
  // — so a detached element can play to completion without a single callback.
  // Park it off-screen for the measurement and take it back out afterwards.
  const detached = !video.isConnected;
  if (detached && typeof document !== "undefined") {
    Object.assign(video.style, {
      position: "fixed",
      left: "-9999px",
      top: "0",
      width: "2px",
      height: "2px",
      opacity: "0",
      pointerEvents: "none",
    });
    document.body.appendChild(video);
  }

  return new Promise<number | undefined>((resolve) => {
    let settled = false;
    let handle: number | undefined;
    let first: FrameMeta | null = null;

    const finish = (fps?: number) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      if (handle !== undefined) target.cancelVideoFrameCallback?.(handle);
      try {
        video.pause();
        video.currentTime = startTime;
      } catch {
        // An errored element cannot be rewound; nothing to restore.
      }
      video.muted = wasMuted;
      if (detached && video.isConnected) video.remove();
      resolve(fps !== undefined && Number.isFinite(fps) && fps > 0 ? snapFps(fps) : undefined);
    };

    const timer = window.setTimeout(() => finish(undefined), timeoutMs);

    const onFrame = (_now: number, meta: FrameMeta) => {
      if (settled) return;
      if (!first) {
        // The first callback establishes the origin — a slope needs two points,
        // and presentedFrames may already be non-zero by the time we attach.
        first = { mediaTime: meta.mediaTime, presentedFrames: meta.presentedFrames };
      } else {
        const frames = meta.presentedFrames - first.presentedFrames;
        const span = meta.mediaTime - first.mediaTime;
        if (frames >= minFrames && span >= minSpan) return finish(frames / span);
      }
      handle = target.requestVideoFrameCallback?.(onFrame);
    };

    handle = target.requestVideoFrameCallback?.(onFrame);
    const started = video.play();
    if (started && typeof started.catch === "function") started.catch(() => finish(undefined));
  });
}
