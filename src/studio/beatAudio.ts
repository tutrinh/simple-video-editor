import type { Beat, Cut, SplitScreenSlot } from "../domain/types";

type BeatAudioCut = Pick<Cut, "beatAudioMasterVolume" | "beatAudioMuted">;
type BeatAudioBeat = Pick<Beat, "volume" | "muted">;

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
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
