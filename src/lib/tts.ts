import { synthesizeVoiceover as kokoroSynth, type Voice } from "./kokoroTts";
import { synthesizeEleven, DEFAULT_ELEVEN_VOICE } from "./elevenLabs";

// One entry point for voiceover, dispatching to whichever engine is selected.
// Kokoro runs fully in-browser (deploy-safe, free); ElevenLabs goes through the
// dev proxy (higher quality, paid, needs a key). Both return the same shape.
export type TtsEngine = "kokoro" | "elevenlabs";

export interface Narration {
  data: Uint8Array;
  ext: "wav" | "mp3";
  durationSec: number;
}

export async function synthesizeVoiceover(
  text: string,
  opts: { engine: TtsEngine; voice?: Voice; elevenVoiceId?: string; speed?: number },
): Promise<Narration> {
  const speed = opts.speed ?? 1;
  const timeoutMs = 15000;

  const promise = (async (): Promise<Narration> => {
    if (opts.engine === "elevenlabs") {
      const r = await synthesizeEleven(text, opts.elevenVoiceId ?? DEFAULT_ELEVEN_VOICE, speed);
      return { data: r.data, ext: "mp3", durationSec: r.durationSec };
    }
    const { wav, durationSec } = await kokoroSynth(text, opts.voice, speed);
    return { data: wav, ext: "wav", durationSec };
  })();

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("Voiceover synthesis timed out after 15 seconds")), timeoutMs)
  );

  return Promise.race([promise, timeoutPromise]);
}
