// ElevenLabs TTS via the dev proxy (/api/tts) so the API key stays server-side
// (see ttsProxy in vite.config.ts). Returns MP3 bytes — ffmpeg.wasm decodes MP3
// fine — plus the exact duration, which the "narration drives beat length"
// feature needs (decoded here since MP3 carries no plain sample count).
export interface ElevenVoice {
  id: string;
  label: string;
}

// A few of ElevenLabs' stock voices. Swap/extend with IDs from your account.
export const ELEVEN_VOICES: ElevenVoice[] = [
  { id: "21m00Tcm4TlvDq8ikWAM", label: "Rachel (F)" },
  { id: "EXAVITQu4vr4xnSDxMaL", label: "Bella (F)" },
  { id: "AZnzlk1XvdvUeBnXmlld", label: "Domi (F)" },
  { id: "pNInz6obpgDQGcFmaJgB", label: "Adam (M)" },
  { id: "TxGEqnHWrfWFTfGW9XjX", label: "Josh (M)" },
  { id: "VR6AewLTigWG4xSOukaG", label: "Arnold (M)" },
];

export const DEFAULT_ELEVEN_VOICE = ELEVEN_VOICES[0].id;

/** Selectable ElevenLabs TTS models. v3 understands inline audio tags like
 *  [whispers] / [excited]; flash is the fast/cheap option for previews. */
export const ELEVEN_MODELS = [
  { id: "eleven_multilingual_v2", label: "Multilingual v2 — quality" },
  { id: "eleven_flash_v2_5", label: "Flash v2.5 — fast & cheap" },
  { id: "eleven_v3", label: "v3 — expressive · audio tags" },
] as const;
export const DEFAULT_ELEVEN_MODEL = ELEVEN_MODELS[0].id;

export interface ElevenSynthOptions {
  voiceId: string;
  speed?: number;
  model?: string;
  /** 0..1 — lower = more variable/expressive, higher = more stable/monotone. */
  stability?: number;
  /** 0..1 — style exaggeration (0 = off, faster). */
  style?: number;
}

/** A word with its start/end seconds, derived from ElevenLabs' character timings. */
export interface WordTiming {
  text: string;
  start: number;
  end: number;
}

/**
 * Fetch every voice on the connected ElevenLabs account (stock + custom/cloned) via
 * the dev proxy, so the picker reflects the whole library instead of the static list.
 * Falls back to ELEVEN_VOICES on any error (offline, no key, non-dev build).
 */
export async function fetchElevenVoices(): Promise<ElevenVoice[]> {
  try {
    const res = await fetch("/api/tts/voices");
    if (!res.ok) return ELEVEN_VOICES;
    const data = (await res.json()) as { voices?: ElevenVoice[] };
    return data.voices && data.voices.length > 0 ? data.voices : ELEVEN_VOICES;
  } catch {
    return ELEVEN_VOICES;
  }
}

async function mp3Duration(buf: ArrayBuffer): Promise<number> {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    const decoded = await ctx.decodeAudioData(buf.slice(0)); // slice: decode detaches its input
    ctx.close();
    return decoded.duration;
  } catch {
    return 0; // caller falls back to the beat's estimate
  }
}

let elevenQueue: Promise<unknown> = Promise.resolve();

function enqueueEleven<T>(fn: () => Promise<T>): Promise<T> {
  const next = elevenQueue.then(fn);
  elevenQueue = next.catch(() => {});
  return next;
}

async function fetchElevenWithRetry(text: string, opts: ElevenSynthOptions, retries = 3): Promise<Response> {
  let delay = 1000;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, voiceId: opts.voiceId, speed: opts.speed, model: opts.model, stability: opts.stability, style: opts.style }),
    });

    if (res.status === 429 && attempt < retries) {
      await new Promise((r) => setTimeout(r, delay));
      delay *= 2;
      continue;
    }
    return res;
  }
  throw new Error("ElevenLabs rate limit retries exhausted");
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

interface ElevenAlignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

/** Group ElevenLabs' per-character timings into per-word timings (split on spaces). */
function alignmentToWords(a: ElevenAlignment | null | undefined): WordTiming[] | undefined {
  if (!a?.characters?.length) return undefined;
  const words: WordTiming[] = [];
  let cur = "";
  let start = 0;
  for (let i = 0; i < a.characters.length; i++) {
    const ch = a.characters[i];
    if (/\s/.test(ch)) {
      if (cur) { words.push({ text: cur, start, end: a.character_end_times_seconds[i - 1] ?? start }); cur = ""; }
    } else {
      if (!cur) start = a.character_start_times_seconds[i] ?? 0;
      cur += ch;
    }
  }
  if (cur) words.push({ text: cur, start, end: a.character_end_times_seconds[a.characters.length - 1] ?? start });
  return words;
}

export async function synthesizeEleven(text: string, opts: ElevenSynthOptions): Promise<{ data: Uint8Array; durationSec: number; words?: WordTiming[] }> {
  return enqueueEleven(async () => {
    const res = await fetchElevenWithRetry(text, opts);
    if (!res.ok) {
      let msg = `ElevenLabs failed (${res.status})`;
      try {
        const j = (await res.json()) as { error?: string };
        if (j?.error) msg = j.error;
      } catch {
        /* non-JSON error body */
      }
      throw new Error(msg);
    }
    // The proxy returns the with-timestamps JSON: base64 MP3 + character alignment.
    const j = (await res.json()) as { audioBase64: string; alignment?: ElevenAlignment | null };
    const data = base64ToBytes(j.audioBase64);
    const words = alignmentToWords(j.alignment);
    // Exact duration from the last character's end time (falls back to decoding).
    const durationSec = words?.length ? words[words.length - 1].end : await mp3Duration(data.buffer as ArrayBuffer);
    return { data, durationSec, words };
  });
}
