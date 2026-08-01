import type { UserVoiceEffect } from "../domain/types";
import {
  clampUserVoiceEqDb,
  normalizeUserVoiceEffect,
  USER_VOICE_BASS_HZ,
  USER_VOICE_TREBLE_HZ,
  userVoiceEffectBand,
  userVoiceEqFilterChain,
} from "./userVoiceEq";

// Tone and character for AI voiceover. The shelves and the band-limiting effects are the
// same ones the recorded User VO track uses — same frequencies, same ±12 dB clamp, same
// character presets — so the two voices shape identically and a project mixes predictably.
//
// It does NOT reuse createUserVoiceEqGraph: that graph also owns the output gain and
// forces `audio.volume = 1`, which would fight the volume and caption-ducking logic that
// already governs AI VO playback. Here the filters are the only thing in the path; level
// stays with the existing `audio.volume`.

/** Neutral pass-through values for the filters, used when nothing is dialled in. */
const OPEN_HIGHPASS_HZ = 20;
const OPEN_LOWPASS_HZ = 20_000;

export interface VoToneGraph {
  set(bassDb: number | undefined, trebleDb: number | undefined, effect: UserVoiceEffect | undefined): void;
  destroy(): void;
}

/** True when the settings ask for any shaping at all — a shelf moved, or a character. */
export function hasVoTone(
  bassDb: number | undefined,
  trebleDb: number | undefined,
  effect?: UserVoiceEffect,
): boolean {
  return (
    clampUserVoiceEqDb(bassDb) !== 0
    || clampUserVoiceEqDb(trebleDb) !== 0
    || normalizeUserVoiceEffect(effect) !== "none"
  );
}

/**
 * The ffmpeg chain for the export mix. Delegates to the User VO builder so the exported
 * filters are identical to the preview's, character band included.
 */
export function voToneFilterChain(
  bassDb: number | undefined,
  trebleDb: number | undefined,
  effect?: UserVoiceEffect,
): string {
  return userVoiceEqFilterChain(bassDb, trebleDb, normalizeUserVoiceEffect(effect));
}

/**
 * Route an element through the character band and the two shelves, in the order the
 * ffmpeg chain applies them: band-limit first, then shape what is left.
 *
 * `createMediaElementSource` may only be called once per element, so this must be created
 * at most once per audio element and destroyed with it. Returns null when Web Audio is
 * unavailable, so callers fall back to plain untouched playback rather than losing the
 * narration entirely.
 */
export function createVoToneGraph(
  audio: HTMLAudioElement,
  context: AudioContext,
): VoToneGraph | null {
  try {
    const source = context.createMediaElementSource(audio);
    const highpass = context.createBiquadFilter();
    const lowpass = context.createBiquadFilter();
    const bass = context.createBiquadFilter();
    const treble = context.createBiquadFilter();

    highpass.type = "highpass";
    highpass.frequency.value = OPEN_HIGHPASS_HZ;
    lowpass.type = "lowpass";
    lowpass.frequency.value = OPEN_LOWPASS_HZ;
    bass.type = "lowshelf";
    bass.frequency.value = USER_VOICE_BASS_HZ;
    treble.type = "highshelf";
    treble.frequency.value = USER_VOICE_TREBLE_HZ;

    source.connect(highpass);
    highpass.connect(lowpass);
    lowpass.connect(bass);
    bass.connect(treble);
    treble.connect(context.destination);

    return {
      set(bassDb, trebleDb, effect) {
        const band = userVoiceEffectBand(effect);
        highpass.frequency.value = band?.highpassHz ?? OPEN_HIGHPASS_HZ;
        lowpass.frequency.value = band?.lowpassHz ?? OPEN_LOWPASS_HZ;
        bass.gain.value = clampUserVoiceEqDb(bassDb);
        treble.gain.value = clampUserVoiceEqDb(trebleDb);
      },
      destroy() {
        try {
          source.disconnect();
          highpass.disconnect();
          lowpass.disconnect();
          bass.disconnect();
          treble.disconnect();
        } catch {
          /* already torn down with the context */
        }
      },
    };
  } catch {
    return null;
  }
}
