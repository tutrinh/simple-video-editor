import { synthesizeVoiceover as kokoroSynth, type Voice } from "./kokoroTts";
import { synthesizeEleven, DEFAULT_ELEVEN_VOICE, type WordTiming } from "./elevenLabs";

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

export async function synthesizeVoiceover(text: string, opts: TtsOptions): Promise<Narration> {
  const speed = opts.speed ?? 1;
  const timeoutMs = 15000;

  const promise = (async (): Promise<Narration> => {
    if (opts.engine === "elevenlabs") {
      const r = await synthesizeEleven(text, {
        voiceId: opts.elevenVoiceId ?? DEFAULT_ELEVEN_VOICE,
        speed,
        model: opts.elevenModel,
        stability: opts.elevenStability,
        style: opts.elevenStyle,
      });
      return { data: r.data, ext: "mp3", durationSec: r.durationSec, words: r.words };
    }
    const { wav, durationSec } = await kokoroSynth(text, opts.voice, speed);
    return { data: wav, ext: "wav", durationSec };
  })();

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("Voiceover synthesis timed out after 15 seconds")), timeoutMs)
  );

  return Promise.race([promise, timeoutPromise]);
}
