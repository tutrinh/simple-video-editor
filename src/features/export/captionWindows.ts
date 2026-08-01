import type { VoSegment } from "../../domain/types";
import { stripAudioTags } from "../../lib/audioTags";

export interface ExportedCaptionWindow {
  text: string;
  startSec: number;
  endSec: number;
}

/**
 * Resolve VO captions into one exported Beat's local clock. FinalPreview and
 * StagePreview read the same VO segments through activeVoCaption; this function
 * is the export adapter for that domain contract.
 */
export function exportedCaptionWindows(
  segments: VoSegment[] | undefined,
  beatStartSec: number,
  beatDurationSec: number,
): ExportedCaptionWindow[] {
  const beatEndSec = beatStartSec + beatDurationSec;
  const windows: ExportedCaptionWindow[] = [];
  for (const segment of segments ?? []) {
    // Audio tags steer the synthesized delivery and are never spoken, so they must not
    // be burned in. A segment that is nothing but tags leaves no caption at all.
    const caption = stripAudioTags(segment.text).trim();
    if (!segment.captionVisible || !caption) continue;
    const segmentEndSec = segment.startTimeSec + segment.durationSec;
    if (segment.startTimeSec >= beatEndSec || segmentEndSec <= beatStartSec) continue;
    const startSec = Math.max(0, segment.startTimeSec - beatStartSec);
    const endSec = Math.min(beatDurationSec, segmentEndSec - beatStartSec);
    if (endSec > startSec + 0.01) windows.push({ text: caption, startSec, endSec });
  }
  return windows;
}

