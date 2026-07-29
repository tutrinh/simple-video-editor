import type { KokoroTTS } from "kokoro-js";

// In-browser neural TTS (Kokoro-82M via ONNX/transformers.js). Unlike the dev
// `say` proxy, this runs fully client-side, so voiceover survives a static
// deploy. The ~80MB q8 model downloads once and is cached by the browser.
const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

type GenerateOptions = NonNullable<Parameters<KokoroTTS["generate"]>[1]>;
export type Voice = NonNullable<GenerateOptions["voice"]>;

export interface VoiceOption {
  id: Voice;
  /** Display name of the voice/character. */
  name: string;
  /** Accent · gender bucket, for grouping in the picker. */
  group: string;
}

/** The full Kokoro voice roster (28), grouped by accent and gender. */
export const VOICES: VoiceOption[] = [
  // American · Female
  ...(["heart", "bella", "nova", "sarah", "sky", "alloy", "aoede", "jessica", "kore", "nicole", "river"] as const).map(
    (n) => ({ id: `af_${n}` as Voice, name: cap(n), group: "American · Female" }),
  ),
  // American · Male
  ...(["michael", "adam", "echo", "eric", "fenrir", "liam", "onyx", "puck", "santa"] as const).map(
    (n) => ({ id: `am_${n}` as Voice, name: cap(n), group: "American · Male" }),
  ),
  // British · Female
  ...(["emma", "isabella", "alice", "lily"] as const).map(
    (n) => ({ id: `bf_${n}` as Voice, name: cap(n), group: "British · Female" }),
  ),
  // British · Male
  ...(["george", "daniel", "fable", "lewis"] as const).map(
    (n) => ({ id: `bm_${n}` as Voice, name: cap(n), group: "British · Male" }),
  ),
];

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export interface LoadProgress {
  status: string;
  file?: string;
  progress?: number;
}

let ttsPromise: Promise<KokoroTTS> | null = null;

/**
 * Load (once) and cache the model. Safe to call repeatedly; shares one load.
 * kokoro-js (+ transformers.js/onnxruntime, ~tens of MB) is dynamically imported
 * so it lands in a lazy chunk fetched only when voiceover is used — the main app
 * bundle stays light.
 */
export function loadVoiceModel(onProgress?: (p: LoadProgress) => void): Promise<KokoroTTS> {
  if (!ttsPromise) {
    ttsPromise = import("kokoro-js")
      .then(({ KokoroTTS }) =>
        KokoroTTS.from_pretrained(MODEL_ID, {
          dtype: "q8",
          device: "wasm",
          progress_callback: (p: LoadProgress) => onProgress?.(p),
        }),
      )
      .catch((e) => {
        ttsPromise = null; // let a later attempt retry a failed download
        throw e;
      });
  }
  return ttsPromise;
}

export interface Narration {
  /** WAV bytes, ready to write into the ffmpeg FS. */
  wav: Uint8Array;
  /** Exact spoken length in seconds (from the raw sample count). */
  durationSec: number;
}

let workerInstance: Worker | null = null;
const pendingRequests = new Map<
  string,
  { resolve: (val: Narration) => void; reject: (err: Error) => void }
>();

function getWorker(): Worker | null {
  if (typeof window === "undefined" || typeof Worker === "undefined") return null;
  if (!workerInstance) {
    try {
      workerInstance = new Worker(new URL("../workers/kokoroWorker.ts", import.meta.url), {
        type: "module",
      });
      workerInstance.onmessage = (e: MessageEvent) => {
        const { type, id, wav, durationSec, error } = e.data ?? {};
        const pending = pendingRequests.get(id);
        if (!pending) return;
        pendingRequests.delete(id);
        if (type === "result") {
          pending.resolve({
            wav: new Uint8Array(wav),
            durationSec,
          });
        } else {
          pending.reject(new Error(error || "Worker synthesis failed"));
        }
      };
      workerInstance.onerror = (err) => {
        console.warn("Kokoro TTS worker error:", err);
      };
    } catch {
      workerInstance = null;
    }
  }
  return workerInstance;
}

/** Synthesize one line of narration to WAV bytes plus its exact duration.
 *  `speed` < 1 slows the read (1 = natural); pairs with the same knob on the
 *  ElevenLabs path so voiceover pacing is engine-agnostic. */
export async function synthesizeVoiceover(text: string, voice: Voice = "af_heart", speed = 1): Promise<Narration> {
  const worker = getWorker();
  if (worker) {
    const id = `req_${Math.random().toString(36).slice(2, 9)}`;
    return new Promise<Narration>((resolve, reject) => {
      pendingRequests.set(id, { resolve, reject });
      worker.postMessage({ type: "synthesize", id, text, voice, speed });
    });
  }

  // Fallback for node/vitest environments without Web Workers
  const tts = await loadVoiceModel();
  const audio = await tts.generate(text, { voice, speed });
  return {
    wav: new Uint8Array(audio.toWav()),
    durationSec: audio.audio.length / audio.sampling_rate,
  };
}

