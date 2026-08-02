// App-wide Music library. Audio files live in MUSIC_DIR and projects retain a
// filename reference; callers can fetch a runtime File when decoding/exporting.

export async function fetchMusicList(): Promise<string[]> {
  try {
    const response = await fetch("/api/music/list");
    if (!response.ok) return [];
    const data = (await response.json()) as { files?: string[] };
    return data.files ?? [];
  } catch {
    return [];
  }
}

export function musicFileUrl(fileName: string): string {
  return `/api/music/file?name=${encodeURIComponent(fileName)}`;
}

export async function fetchMusicFile(fileName: string): Promise<File> {
  // Replace can overwrite an existing filename. Analysis must receive the new
  // bytes, never a browser-cached response for the previous track.
  const response = await fetch(musicFileUrl(fileName), { cache: "no-store" });
  if (!response.ok) throw new Error(`Music file not found in the app library: ${fileName}`);
  const blob = await response.blob();
  return new File([blob], fileName, { type: blob.type || "audio/mpeg" });
}

/** Persist audio-only bytes in MUSIC_DIR and return the safe stored filename. */
export async function uploadMusic(file: File): Promise<string> {
  const response = await fetch(`/api/music/upload?name=${encodeURIComponent(file.name)}`, {
    method: "POST",
    headers: { "content-type": file.type || "application/octet-stream" },
    body: file,
  });
  const data = (await response.json().catch(() => ({}))) as { name?: string; error?: string };
  if (!response.ok || data.error) throw new Error(data.error ?? `Music library upload failed (${response.status})`);
  return data.name ?? file.name;
}
