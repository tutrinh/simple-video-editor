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

export async function synthesizeEleven(text: string, voiceId: string, speed = 1): Promise<{ data: Uint8Array; durationSec: number }> {
  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, voiceId, speed }),
  });
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
  const buf = await res.arrayBuffer();
  return { data: new Uint8Array(buf), durationSec: await mp3Duration(buf) };
}
