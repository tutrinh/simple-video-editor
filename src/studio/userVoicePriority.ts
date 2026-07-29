export const CAPTION_VO_DUCK_GAIN = 0.15;

interface TimedAudioSegment {
  startTimeSec: number;
  durationSec: number;
}

export interface LocalOverlapWindow {
  startSec: number;
  endSec: number;
}

export function captionVoiceGainAtTime(
  userVoiceSegments: readonly TimedAudioSegment[],
  absoluteTimeSec: number,
): number {
  return userVoiceSegments.some((segment) =>
    absoluteTimeSec >= segment.startTimeSec
    && absoluteTimeSec < segment.startTimeSec + segment.durationSec
  )
    ? CAPTION_VO_DUCK_GAIN
    : 1;
}

export function captionVoiceOverlapWindows(
  captionStartSec: number,
  captionDurationSec: number,
  userVoiceSegments: readonly TimedAudioSegment[],
): LocalOverlapWindow[] {
  const captionEndSec = captionStartSec + Math.max(0, captionDurationSec);
  const windows = userVoiceSegments
    .map((segment) => ({
      startSec: Math.max(captionStartSec, segment.startTimeSec) - captionStartSec,
      endSec: Math.min(captionEndSec, segment.startTimeSec + segment.durationSec) - captionStartSec,
    }))
    .filter((window) => window.endSec > window.startSec)
    .sort((a, b) => a.startSec - b.startSec);

  const merged: LocalOverlapWindow[] = [];
  for (const window of windows) {
    const previous = merged[merged.length - 1];
    if (previous && window.startSec <= previous.endSec) {
      previous.endSec = Math.max(previous.endSec, window.endSec);
    } else {
      merged.push({ ...window });
    }
  }
  return merged;
}

/** FFmpeg filters use the caption segment's local clock before its absolute delay. */
export function captionVoiceDuckingFilterChain(
  baseGain: number,
  captionStartSec: number,
  captionDurationSec: number,
  userVoiceSegments: readonly TimedAudioSegment[],
): string {
  const normalizedBase = Math.min(1, Math.max(0, baseGain));
  const filters = [`volume=${normalizedBase.toFixed(4)}`];
  for (const window of captionVoiceOverlapWindows(
    captionStartSec,
    captionDurationSec,
    userVoiceSegments,
  )) {
    filters.push(
      `volume=${CAPTION_VO_DUCK_GAIN}:enable='between(t,${window.startSec.toFixed(3)},${window.endSec.toFixed(3)})'`,
    );
  }
  return filters.join(",");
}
