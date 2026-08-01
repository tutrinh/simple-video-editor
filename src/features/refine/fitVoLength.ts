import type { VoSegment } from "../../domain/types";

// "Fit length to voice": synthesize a VO segment's narration and snap the segment's
// timeline length to the exact spoken duration, so the caption window matches what is
// actually heard. Extracted from the Inspector so the timeline's `f` shortcut and the
// Inspector button run identical logic.

/** Floor for a fitted segment; also the value a failed read collapses to. */
export const MIN_FIT_VO_DURATION_SEC = 0.3;

export type FitVoResult =
  | { ok: true; segment: VoSegment }
  | { ok: false; error: string };

/**
 * Returns the resized segment, an error to surface, or null when there is nothing to
 * fit (an empty segment). Note that a narration measuring exactly the floor is treated
 * as an unreadable duration rather than a valid 0.3s fit — preserved from the original
 * Inspector behaviour, since in practice it means the engine returned nothing.
 */
export async function fitVoSegmentToVoice(
  segment: VoSegment,
  synth: (text: string) => Promise<{ durationSec: number }>,
): Promise<FitVoResult | null> {
  const text = segment.text.trim();
  if (!text) return null;

  try {
    const narration = await synth(text);
    const durationSec = Math.max(
      MIN_FIT_VO_DURATION_SEC,
      Math.round((narration?.durationSec || 0) * 10) / 10,
    );
    if (durationSec > MIN_FIT_VO_DURATION_SEC) {
      return { ok: true, segment: { ...segment, durationSec } };
    }
    return { ok: false, error: "Couldn't read a duration from the voice." };
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : String(cause) };
  }
}
