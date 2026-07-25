// Frame sampling via <video> + <canvas> (validated by spikes/vision-descriptions).
// No ffmpeg needed for stills — lighter, and this is how the analyze pass and
// ingest poster thumbnails get their frames.

import { EDITOR_DEFAULTS } from "../config/editorDefaults";

export interface VideoMeta {
  durationSec: number;
  width: number;
  height: number;
}

export interface SampledFrame {
  /** For <img> previews. */
  dataUrl: string;
  /** Stripped base64 (no data: prefix) for the Claude vision API. */
  base64: string;
}

function loadVideo(src: Blob): Promise<{ video: HTMLVideoElement; revoke: () => void }> {
  const url = URL.createObjectURL(src);
  const video = document.createElement("video");
  video.src = url;
  video.muted = true;
  video.preload = "auto";
  return new Promise((resolve, reject) => {
    video.onloadedmetadata = () => resolve({ video, revoke: () => URL.revokeObjectURL(url) });
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("could not load video"));
    };
  });
}

export async function probeVideo(src: Blob): Promise<VideoMeta> {
  const { video, revoke } = await loadVideo(src);
  const meta = { durationSec: video.duration || 0, width: video.videoWidth, height: video.videoHeight };
  revoke();
  return meta;
}

// --- Stills (ADR-0012) -----------------------------------------------------
// The <img> mirror of loadVideo/probeVideo/sampleFrames. A Still has no natural
// length, so probeStill reports the synthetic one and every consumer downstream
// reads a real number where a <video> would have given it 0.

function loadImage(src: Blob): Promise<{ img: HTMLImageElement; revoke: () => void }> {
  const url = URL.createObjectURL(src);
  const img = new Image();
  return new Promise((resolve, reject) => {
    img.onload = () => resolve({ img, revoke: () => URL.revokeObjectURL(url) });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("could not load image"));
    };
    img.src = url;
  });
}

/** probeVideo's counterpart for a Still: real dimensions, synthetic duration. */
export async function probeStill(src: Blob): Promise<VideoMeta> {
  const { img, revoke } = await loadImage(src);
  const meta = {
    durationSec: EDITOR_DEFAULTS.STILL_CLIP_DURATION_SEC,
    width: img.naturalWidth,
    height: img.naturalHeight,
  };
  revoke();
  return meta;
}

/**
 * The Still's one frame, downscaled the same way sampleFrames downscales a
 * video's — used for its poster thumbnail and as the single frame Claude
 * describes it from.
 */
export async function stillFrame(src: Blob, maxEdge = 768): Promise<SampledFrame> {
  const { img, revoke } = await loadImage(src);
  try {
    const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d canvas context");
    ctx.drawImage(img, 0, 0, w, h);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
    return { dataUrl, base64: dataUrl.split(",")[1] };
  } finally {
    revoke();
  }
}

function seek(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(new Error("seek failed")); };
    const cleanup = () => {
      video.removeEventListener("seeked", done);
      video.removeEventListener("error", fail);
    };
    video.addEventListener("seeked", done);
    video.addEventListener("error", fail);
    video.currentTime = Math.min(t, Math.max(0, (video.duration || 0) - 0.05));
  });
}

/**
 * Sample `count` evenly-spaced frames, downscaled so the long edge ≤ maxEdge.
 * ADR-0001: ~8 frames is the floor (peak-aware sampling is a later refinement);
 * vision doesn't need full 1080p and smaller frames are cheaper tokens.
 */
export async function sampleFrames(src: Blob, count: number, maxEdge = 768): Promise<SampledFrame[]> {
  const { video, revoke } = await loadVideo(src);
  try {
    const scale = Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight));
    const w = Math.round(video.videoWidth * scale);
    const h = Math.round(video.videoHeight * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d canvas context");

    const frames: SampledFrame[] = [];
    for (let i = 0; i < count; i++) {
      const t = (video.duration || 0) * ((i + 0.5) / count);
      await seek(video, t);
      ctx.drawImage(video, 0, 0, w, h);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
      frames.push({ dataUrl, base64: dataUrl.split(",")[1] });
    }
    return frames;
  } finally {
    revoke();
  }
}

/** Grab one frame at a specific time (seconds) — used to represent a beat for AI grading. */
export async function sampleFrameAt(src: Blob, timeSec: number, maxEdge = 768): Promise<SampledFrame> {
  const { video, revoke } = await loadVideo(src);
  try {
    const scale = Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight));
    const w = Math.round(video.videoWidth * scale);
    const h = Math.round(video.videoHeight * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d canvas context");
    const t = Math.max(0, Math.min(video.duration || 0, timeSec));
    await seek(video, t);
    ctx.drawImage(video, 0, 0, w, h);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
    return { dataUrl, base64: dataUrl.split(",")[1] };
  } finally {
    revoke();
  }
}
