// --- Purpose -------------------------------------------------------------
// Throwaway spike for ADR-0001. Question: sample a few frames from a clip, send
// them to a Claude vision model, and see whether the returned Clip Description
// is concrete and distinct enough to build a Story from — using only text.
//
// Frame grab uses <video> + <canvas> (no ffmpeg needed for stills). The API is
// called directly from the browser with the dangerous-direct-browser-access
// header — dev-only; a real app would proxy the key.
// -------------------------------------------------------------------------

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const runBtn = $("run") as HTMLButtonElement;
const statusEl = $("status") as HTMLSpanElement;
const resultsEl = $("results") as HTMLDivElement;

// Pre-fill the key from VITE_ANTHROPIC_KEY if you launched with it in the env:
//   VITE_ANTHROPIC_KEY=sk-ant-... npm run dev
// Keeps the secret out of the UI and out of any chat transcript.
const envKey = import.meta.env.VITE_ANTHROPIC_KEY;
if (envKey) {
  ($("key") as HTMLInputElement).value = envKey;
  statusEl.textContent = "key loaded from env";
}

const MAX_EDGE = 768; // downscale frames — vision doesn't need full 1080p, and it's cheaper tokens

// The one prompt under test. If descriptions come back vague, this is the first
// thing to sharpen — but a good model should already produce something usable.
const PROMPT = `You are analyzing ONE short video clip, shown to you as a few frames sampled across its duration. The clip may have no speech or meaningful audio — judge only from what you see.

Write a Clip Description with exactly these parts:
1. SUBJECT & ACTION: what/who is on screen and what is happening (1-2 sentences, concrete and specific).
2. SETTING & MOOD: where it is and the feeling it conveys (1 sentence).
3. USABILITY (1-5): how strong this is as a beat in a short story montage, with a 6-word reason.

Be specific enough that an editor who never sees the footage could sequence this clip from your words alone.`;

interface Frame {
  dataUrl: string; // for the <img> preview
  base64: string; // stripped, for the API
}

function seek(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onSeeked = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error("seek failed")); };
    const cleanup = () => {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
    };
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", onError);
    video.currentTime = Math.min(t, Math.max(0, video.duration - 0.05));
  });
}

async function grabFrames(file: File, count: number): Promise<Frame[]> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.src = url;
  video.muted = true;
  video.preload = "auto";

  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("could not load video"));
  });

  const scale = Math.min(1, MAX_EDGE / Math.max(video.videoWidth, video.videoHeight));
  const w = Math.round(video.videoWidth * scale);
  const h = Math.round(video.videoHeight * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  const frames: Frame[] = [];
  for (let i = 0; i < count; i++) {
    const t = (video.duration || 0) * ((i + 0.5) / count);
    await seek(video, t);
    ctx.drawImage(video, 0, 0, w, h);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
    frames.push({ dataUrl, base64: dataUrl.split(",")[1] });
  }

  URL.revokeObjectURL(url);
  return frames;
}

interface ClaudeUsage { input_tokens: number; output_tokens: number }
interface ClaudeResponse {
  content?: { type: string; text?: string }[];
  usage?: ClaudeUsage;
  error?: { message: string };
}

async function describe(frames: Frame[], model: string, key: string): Promise<{ text: string; usage?: ClaudeUsage }> {
  const content: unknown[] = frames.map((f) => ({
    type: "image",
    source: { type: "base64", media_type: "image/jpeg", data: f.base64 },
  }));
  content.push({ type: "text", text: PROMPT });

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({ model, max_tokens: 400, messages: [{ role: "user", content }] }),
  });

  const data = (await res.json()) as ClaudeResponse;
  if (!res.ok || data.error) throw new Error(data.error?.message || `HTTP ${res.status}`);
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  return { text: text || "(no text returned)", usage: data.usage };
}

async function run() {
  const key = ($("key") as HTMLInputElement).value.trim();
  const model = ($("model") as HTMLSelectElement).value;
  const count = Math.max(1, Math.min(8, Number(($("frames") as HTMLInputElement).value) || 4));
  const clips = ($("clips") as HTMLInputElement).files;

  if (!key) { statusEl.textContent = "paste an API key first"; return; }
  if (!clips || clips.length === 0) { statusEl.textContent = "pick at least one clip"; return; }

  runBtn.disabled = true;
  resultsEl.innerHTML = "";

  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    statusEl.textContent = `clip ${i + 1} of ${clips.length}…`;

    const card = document.createElement("div");
    card.className = "clip";
    card.innerHTML = `<h3>${clip.name}</h3>`;
    resultsEl.appendChild(card);

    try {
      const t0 = performance.now();
      const frames = await grabFrames(clip, count);

      const framesEl = document.createElement("div");
      framesEl.className = "frames";
      for (const f of frames) {
        const img = document.createElement("img");
        img.src = f.dataUrl;
        framesEl.appendChild(img);
      }
      card.appendChild(framesEl);

      const { text, usage } = await describe(frames, model, key);
      const secs = ((performance.now() - t0) / 1000).toFixed(1);

      const desc = document.createElement("div");
      desc.className = "desc";
      desc.textContent = text;
      card.appendChild(desc);

      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = `${model} · ${count} frames · ${secs}s` +
        (usage ? ` · ${usage.input_tokens} in / ${usage.output_tokens} out tokens` : "");
      card.appendChild(meta);
    } catch (err) {
      const e = document.createElement("div");
      e.className = "desc err";
      e.textContent = "FAILED: " + (err instanceof Error ? err.message : String(err));
      card.appendChild(e);
    }
  }

  statusEl.textContent = "done — now read the descriptions: distinct and concrete enough to sequence a story?";
  runBtn.disabled = false;
}

runBtn.addEventListener("click", run);
