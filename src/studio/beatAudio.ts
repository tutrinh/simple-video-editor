import type { Beat, Cut, SplitScreenSlot } from "../domain/types";

type BeatAudioCut = Pick<Cut, "beatAudioMasterVolume" | "beatAudioMuted">;
type BeatAudioBeat = Pick<Beat, "volume" | "muted">;

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export const BEAT_AUDIO_EDGE_FADE_SEC = 0.015;

/**
 * Keeps independently played/encoded Beat audio from entering or leaving on a
 * non-zero sample. The very short ramp removes boundary clicks without fading
 * continuous Cut-level music, narration, or sound effects.
 */
export function beatBoundaryGain(
  elapsedSec: number,
  durationSec: number,
  fadeSec = BEAT_AUDIO_EDGE_FADE_SEC,
): number {
  const duration = Number.isFinite(durationSec) ? Math.max(0, durationSec) : 0;
  if (duration === 0) return 0;
  const elapsed = Number.isFinite(elapsedSec)
    ? Math.min(duration, Math.max(0, elapsedSec))
    : 0;
  const fade = Math.min(Math.max(0, fadeSec), duration / 2);
  if (fade === 0) return 1;
  return clampUnit(Math.min(elapsed / fade, (duration - elapsed) / fade));
}

export function effectiveBeatVolume(beat: BeatAudioBeat, cut: BeatAudioCut): number {
  if (beat.muted || cut.beatAudioMuted) return 0;
  return clampUnit(beat.volume ?? 1) * clampUnit(cut.beatAudioMasterVolume ?? 1);
}

export function effectiveSplitScreenSlotVolume(
  slot: Pick<SplitScreenSlot, "volume">,
  slotIndex: number,
  beat: BeatAudioBeat,
  cut: BeatAudioCut,
): number {
  if (beat.muted || cut.beatAudioMuted) return 0;
  const slotVolume = slot.volume ?? (slotIndex === 0 ? 1 : 0);
  return clampUnit(slotVolume)
    * clampUnit(beat.volume ?? 1)
    * clampUnit(cut.beatAudioMasterVolume ?? 1);
}
