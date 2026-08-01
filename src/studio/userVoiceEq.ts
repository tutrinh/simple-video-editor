import type { UserVoiceEffect, UserVoiceSegment } from "../domain/types";

export const USER_VOICE_EQ_MIN_DB = -12;
export const USER_VOICE_EQ_MAX_DB = 12;
export const USER_VOICE_LEVEL_MIN_DB = -24;
export const USER_VOICE_LEVEL_MAX_DB = 12;
export const USER_VOICE_VOLUME_MAX = 1.5;
export const USER_VOICE_BASS_HZ = 200;
export const USER_VOICE_TREBLE_HZ = 3_000;

const USER_VOICE_EFFECT_BANDS: Record<UserVoiceEffect, { highpassHz: number; lowpassHz: number } | null> = {
  none: null,
  "vintage-phone": { highpassHz: 280, lowpassHz: 3_600 },
  "walkie-talkie": { highpassHz: 450, lowpassHz: 2_600 },
  "old-radio": { highpassHz: 150, lowpassHz: 5_000 },
  megaphone: { highpassHz: 650, lowpassHz: 4_500 },
  intercom: { highpassHz: 350, lowpassHz: 3_000 },
  muffled: { highpassHz: 40, lowpassHz: 1_200 },
  underwater: { highpassHz: 20, lowpassHz: 700 },
};

/** The band-limiting pair behind a character effect, or null for clean audio. */
export function userVoiceEffectBand(
  effect: UserVoiceEffect | undefined,
): { highpassHz: number; lowpassHz: number } | null {
  return USER_VOICE_EFFECT_BANDS[normalizeUserVoiceEffect(effect)];
}

export const USER_VOICE_EFFECT_OPTIONS: readonly { value: UserVoiceEffect; label: string }[] = [
  { value: "none", label: "Clean" },
  { value: "vintage-phone", label: "Vintage Phone" },
  { value: "walkie-talkie", label: "Walkie-Talkie" },
  { value: "old-radio", label: "Old Radio" },
  { value: "megaphone", label: "Megaphone" },
  { value: "intercom", label: "Intercom" },
  { value: "muffled", label: "Muffled / Next Room" },
  { value: "underwater", label: "Underwater" },
] as const;

export interface UserVoiceAudioSettings {
  volume: number;
  levelDb: number;
  bassDb: number;
  trebleDb: number;
  voiceEffect: UserVoiceEffect;
}

export interface UserVoiceEqGraph {
  set(settings: UserVoiceAudioSettings): void;
  destroy(): void;
}

export function clampUserVoiceEqDb(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(USER_VOICE_EQ_MAX_DB, Math.max(USER_VOICE_EQ_MIN_DB, value!));
}

export function clampUserVoiceLevelDb(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(USER_VOICE_LEVEL_MAX_DB, Math.max(USER_VOICE_LEVEL_MIN_DB, value!));
}

export function clampUserVoiceVolume(value: number | undefined): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(USER_VOICE_VOLUME_MAX, Math.max(0, value!));
}

export function normalizeUserVoiceEffect(value: UserVoiceEffect | undefined): UserVoiceEffect {
  return value && value in USER_VOICE_EFFECT_BANDS ? value : "none";
}

export function dbToLinear(db: number): number {
  return 10 ** (db / 20);
}

export function userVoiceLinearGain(settings: UserVoiceAudioSettings): number {
  return clampUserVoiceVolume(settings.volume) * dbToLinear(clampUserVoiceLevelDb(settings.levelDb));
}

export function userVoiceAudioSettings(
  segment: Pick<UserVoiceSegment, "volume" | "levelDb" | "bassDb" | "trebleDb" | "voiceEffect">,
): UserVoiceAudioSettings {
  return {
    volume: clampUserVoiceVolume(segment.volume),
    levelDb: clampUserVoiceLevelDb(segment.levelDb),
    bassDb: clampUserVoiceEqDb(segment.bassDb),
    trebleDb: clampUserVoiceEqDb(segment.trebleDb),
    voiceEffect: normalizeUserVoiceEffect(segment.voiceEffect),
  };
}

/** FFmpeg equivalent of the browser's low/high-shelf preview filters. */
export function userVoiceEqFilterChain(
  bassDb: number | undefined,
  trebleDb: number | undefined,
  voiceEffect: UserVoiceEffect | undefined = "none",
): string {
  const bass = clampUserVoiceEqDb(bassDb);
  const treble = clampUserVoiceEqDb(trebleDb);
  const band = USER_VOICE_EFFECT_BANDS[normalizeUserVoiceEffect(voiceEffect)];
  const character = band ? `highpass=f=${band.highpassHz},lowpass=f=${band.lowpassHz},` : "";
  return `${character}bass=f=${USER_VOICE_BASS_HZ}:g=${bass},treble=f=${USER_VOICE_TREBLE_HZ}:g=${treble}`;
}

export function createUserVoiceEqGraph(
  audio: HTMLAudioElement,
  context: AudioContext,
): UserVoiceEqGraph {
  const source = context.createMediaElementSource(audio);
  const highpass = context.createBiquadFilter();
  const lowpass = context.createBiquadFilter();
  const bass = context.createBiquadFilter();
  const treble = context.createBiquadFilter();
  const gain = context.createGain();

  highpass.type = "highpass";
  highpass.frequency.value = 20;
  lowpass.type = "lowpass";
  lowpass.frequency.value = 20_000;
  bass.type = "lowshelf";
  bass.frequency.value = USER_VOICE_BASS_HZ;
  treble.type = "highshelf";
  treble.frequency.value = USER_VOICE_TREBLE_HZ;
  source.connect(highpass);
  highpass.connect(lowpass);
  lowpass.connect(bass);
  bass.connect(treble);
  treble.connect(gain);
  gain.connect(context.destination);
  audio.volume = 1;

  return {
    set(settings) {
      const normalized = userVoiceAudioSettings(settings);
      const band = USER_VOICE_EFFECT_BANDS[normalized.voiceEffect];
      audio.volume = 1;
      highpass.frequency.value = band?.highpassHz ?? 20;
      lowpass.frequency.value = band?.lowpassHz ?? 20_000;
      bass.gain.value = normalized.bassDb;
      treble.gain.value = normalized.trebleDb;
      gain.gain.value = userVoiceLinearGain(normalized);
    },
    destroy() {
      source.disconnect();
      highpass.disconnect();
      lowpass.disconnect();
      bass.disconnect();
      treble.disconnect();
      gain.disconnect();
    },
  };
}
