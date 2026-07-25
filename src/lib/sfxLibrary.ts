// Client for the SFX sound library. Sounds live in the project's audio/ directory,
// served by the dev proxy at /api/audio (list / file / upload — see vite.config.ts).
// SFX segments reference a sound by filename; bytes are fetched on demand.

export async function fetchSfxList(): Promise<string[]> {
  try {
    const res = await fetch("/api/audio/list");
    if (!res.ok) return [];
    const data = (await res.json()) as { files?: string[] };
    return data.files ?? [];
  } catch {
    return [];
  }
}

/** Streamable URL for a sound (used by the picker's <audio> preview). */
export function sfxFileUrl(fileName: string): string {
  return `/api/audio/file?name=${encodeURIComponent(fileName)}`;
}

export async function fetchSfxBytes(fileName: string): Promise<ArrayBuffer> {
  const res = await fetch(sfxFileUrl(fileName));
  if (!res.ok) throw new Error(`SFX file not found: ${fileName}`);
  return res.arrayBuffer();
}

/** Upload a sound into the audio/ directory; returns the stored filename. */
export async function uploadSfx(file: File): Promise<string> {
  const res = await fetch(`/api/audio/upload?name=${encodeURIComponent(file.name)}`, {
    method: "POST",
    headers: { "content-type": file.type || "application/octet-stream" },
    body: file,
  });
  const data = (await res.json().catch(() => ({}))) as { name?: string; error?: string };
  if (!res.ok || data.error) throw new Error(data.error ?? `Upload failed (${res.status})`);
  return data.name ?? file.name;
}

// One shared AudioContext + decoded-buffer cache, reused for both duration probing
// (on add) and live preview scheduling (FinalPreview), so a sound is decoded once.
let sharedCtx: AudioContext | null = null;
export function sfxAudioContext(): AudioContext {
  if (!sharedCtx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    sharedCtx = new AC();
  }
  return sharedCtx;
}

const bufferCache = new Map<string, Promise<AudioBuffer>>();

/** Fetch + decode a sound to an AudioBuffer (cached in the shared context). */
export function loadSfxBuffer(fileName: string): Promise<AudioBuffer> {
  let p = bufferCache.get(fileName);
  if (!p) {
    p = (async () => {
      const bytes = await fetchSfxBytes(fileName);
      return sfxAudioContext().decodeAudioData(bytes);
    })();
    bufferCache.set(fileName, p);
  }
  return p;
}

/** The sound's true length in seconds (0 if it can't be decoded). */
export async function sfxDuration(fileName: string): Promise<number> {
  try {
    return (await loadSfxBuffer(fileName)).duration;
  } catch {
    return 0;
  }
}
