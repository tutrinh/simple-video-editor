import { synthesizeVoiceover as kokoroSynth, type Voice } from "./kokoroTts";
import { synthesizeEleven, DEFAULT_ELEVEN_VOICE, type WordTiming } from "./elevenLabs";
import { getOrCreateNarration } from "./narrationCache";

// One entry point for voiceover, dispatching to whichever engine is selected.
// Kokoro runs fully in-browser (deploy-safe, free); ElevenLabs goes through the
// dev proxy (higher quality, paid, needs a key). Both return the same shape.
export type TtsEngine = "kokoro" | "elevenlabs";

export interface Narration {
  data: Uint8Array;
  ext: "wav" | "mp3";
  durationSec: number;
  /** Per-word timings when available (ElevenLabs with-timestamps). */
  words?: WordTiming[];
  /** Whether the bytes came from the persistent narration-asset cache. */
  cacheHit?: boolean;
}

export interface TtsOptions {
  engine: TtsEngine;
  voice?: Voice;
  elevenVoiceId?: string;
  speed?: number;
  /** ElevenLabs model id (e.g. eleven_flash_v2_5, eleven_v3). */
  elevenModel?: string;
  /** ElevenLabs voice stability 0..1. */
  elevenStability?: number;
  /** ElevenLabs style exaggeration 0..1. */
  elevenStyle?: number;
}

export interface SynthesisControl {
  /** Explicitly spend a new generation and replace the matching cached asset. */
  forceRefresh?: boolean;
}

async function synthesizeUncached(text: string, opts: TtsOptions): Promise<Narration> {
  const speed = opts.speed ?? 1;
  if (opts.engine === "elevenlabs") {
    // Do not abandon a paid request behind a short client timeout. If the API
    // completes, its bytes must reach the persistent cache instead of being
    // discarded and charged for again on the next attempt.
    const r = await synthesizeEleven(text, {
      voiceId: opts.elevenVoiceId ?? DEFAULT_ELEVEN_VOICE,
      speed,
      model: opts.elevenModel,
      stability: opts.elevenStability,
      style: opts.elevenStyle,
    });
    return { data: r.data, ext: "mp3", durationSec: r.durationSec, words: r.words };
  }

  const promise = kokoroSynth(text, opts.voice, speed).then(({ wav, durationSec }) => ({
    data: wav,
    ext: "wav" as const,
    durationSec,
  }));

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("Voiceover synthesis timed out after 15 seconds")), 15000)
  );

  return Promise.race([promise, timeoutPromise]);
}

export async function synthesizeVoiceover(
  text: string,
  opts: TtsOptions,
  control: SynthesisControl = {},
): Promise<Narration> {
  return getOrCreateNarration(
    text,
    opts,
    () => synthesizeUncached(text, opts),
    control.forceRefresh ?? false,
  );
}
