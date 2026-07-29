export type TitleScope = "intro" | "entire" | "range";

export interface TitleTiming {
  scope: TitleScope;
  introSec?: number;
  startSec?: number;
  durationSec?: number;
  fadeOut?: boolean;
}

export interface TitleWindow {
  startSec: number;
  endSec: number;
}

const DEFAULT_DURATION_SEC = 3;
const MIN_DURATION_SEC = 0.1;

export function titleWindow(
  timing: TitleTiming,
  totalDurationSec = Number.POSITIVE_INFINITY,
): TitleWindow {
  const total = Math.max(0, totalDurationSec);

  if (timing.scope === "entire") {
    return { startSec: 0, endSec: total };
  }

  const startSec = timing.scope === "range"
    ? Math.max(0, timing.startSec ?? 0)
    : 0;
  const requestedDuration = timing.scope === "range"
    ? timing.durationSec
    : timing.introSec;
  const durationSec = Math.max(
    MIN_DURATION_SEC,
    requestedDuration ?? DEFAULT_DURATION_SEC,
  );

  return {
    startSec: Math.min(startSec, total),
    endSec: Math.min(startSec + durationSec, total),
  };
}

export function titleVisibilityAt(
  timing: TitleTiming,
  elapsedSec: number,
  totalDurationSec = Number.POSITIVE_INFINITY,
): { visible: boolean; opacity: number; localElapsedSec: number } {
  const window = titleWindow(timing, totalDurationSec);
  const localElapsedSec = elapsedSec - window.startSec;
  const durationSec = window.endSec - window.startSec;
  const visible = elapsedSec >= window.startSec && elapsedSec < window.endSec;

  if (!visible || durationSec <= 0) {
    return { visible: false, opacity: 0, localElapsedSec };
  }

  if (timing.fadeOut === false) {
    return { visible: true, opacity: 1, localElapsedSec };
  }

  // Intro and timed titles retain the existing gentle fade at the end by default.
  const fadeSec = Math.min(0.8, durationSec / 2);
  const opacity = elapsedSec > window.endSec - fadeSec
    ? Math.max(0, (window.endSec - elapsedSec) / fadeSec)
    : 1;

  return { visible: true, opacity, localElapsedSec };
}
