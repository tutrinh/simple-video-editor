import { KokoroTTS } from "kokoro-js";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
let ttsPromise: Promise<KokoroTTS> | null = null;

function getModel(): Promise<KokoroTTS> {
  if (!ttsPromise) {
    ttsPromise = KokoroTTS.from_pretrained(MODEL_ID, {
      dtype: "q8",
      device: "wasm",
    }).catch((err) => {
      ttsPromise = null;
      throw err;
    });
  }
  return ttsPromise;
}

self.onmessage = async (e: MessageEvent) => {
  const { type, id, text, voice, speed } = e.data ?? {};
  if (type === "synthesize") {
    try {
      const tts = await getModel();
      const audio = await tts.generate(text, { voice, speed });
      const wavBuf = audio.toWav();
      const durationSec = audio.audio.length / audio.sampling_rate;
      postMessage(
        { type: "result", id, wav: wavBuf, durationSec },
        { transfer: [wavBuf] },
      );
    } catch (err) {
      self.postMessage({
        type: "error",
        id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
};
