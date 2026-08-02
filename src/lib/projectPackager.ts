import type { ProjectState } from "../state/projectReducer";
import type { Clip } from "../domain/types";
import { getClipBlobUrl } from "./blobUrlCache";
import { collectTitleFonts, stripTitleFonts, reinjectTitleFonts, promoteTitleFontsToAppLibrary } from "./titleFontPersist";
import { collectUserVoiceFiles, reinjectUserVoiceFiles, stripUserVoiceFiles } from "./userVoicePersist";
import { fetchMusicFile, uploadMusic } from "./musicLibrary";

interface VidstrPackage {
  version: 1;
  exportedAt: number;
  title: string;
  stateJson: string;
  media: Array<{
    clipId: string;
    fileName: string;
    fileType: string;
    fileDataUrl: string; // Base64 data URL for portability
    poster?: string;
  }>;
  /** Uploaded per-beat title fonts, keyed `<beatId>:<layerId>`, as data URLs. */
  titleFonts?: Array<{
    key: string;
    fileName?: string;
    fontType: string;
    fontDataUrl: string;
  }>;
  userVoice?: Array<{
    key: string;
    fileName: string;
    fileType: string;
    fileDataUrl: string;
  }>;
  musicTrack?: {
    fileName: string;
    fileType: string;
    fileDataUrl: string;
  };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl: string, fallbackType = "video/mp4"): Blob {
  const arr = dataUrl.split(",");
  const mimeMatch = arr[0].match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : fallbackType;
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}

export async function exportProjectFile(state: ProjectState): Promise<void> {
  const mediaList: VidstrPackage["media"] = [];

  for (const clip of state.clips) {
    const targetBlob = clip.file || clip.normalized;
    if (targetBlob) {
      const dataUrl = await blobToDataUrl(targetBlob);
      mediaList.push({
        clipId: clip.id,
        fileName: clip.name || `${clip.id}.mp4`,
        fileType: targetBlob.type || "video/mp4",
        fileDataUrl: dataUrl,
        poster: clip.poster,
      });
    }
  }

  // Uploaded per-beat title fonts → portable data URLs (parallel to clip media).
  const titleFonts: NonNullable<VidstrPackage["titleFonts"]> = [];
  for (const { key, file } of collectTitleFonts(state)) {
    titleFonts.push({ key, fileName: file.name, fontType: file.type || "font/ttf", fontDataUrl: await blobToDataUrl(file) });
  }
  const userVoice: NonNullable<VidstrPackage["userVoice"]> = [];
  for (const { key, file } of collectUserVoiceFiles(state)) {
    userVoice.push({
      key,
      fileName: file.name,
      fileType: file.type || "audio/webm",
      fileDataUrl: await blobToDataUrl(file),
    });
  }

  const stripped = stripUserVoiceFiles(stripTitleFonts(state));
  const serializableClips = stripped.clips.map(({ file, normalized, ...rest }) => rest);
  const serializableMusicTrack = stripped.musicTrack
    ? (({ file: _file, ...track }) => track)(stripped.musicTrack)
    : undefined;
  const serializableState = { ...stripped, clips: serializableClips, musicTrack: serializableMusicTrack };
  // New app-owned tracks travel as filename references. Only legacy
  // project-owned tracks still need embedded bytes for migration.
  const musicTrack = state.musicTrack?.file && !state.musicTrack.fileName ? {
    fileName: state.musicTrack.file.name,
    fileType: state.musicTrack.file.type || "audio/wav",
    fileDataUrl: await blobToDataUrl(state.musicTrack.file),
  } : undefined;

  const pkg: VidstrPackage = {
    version: 1,
    exportedAt: Date.now(),
    title: state.title || "Untitled project",
    stateJson: JSON.stringify(serializableState),
    media: mediaList,
    ...(titleFonts.length ? { titleFonts } : {}),
    ...(userVoice.length ? { userVoice } : {}),
    ...(musicTrack ? { musicTrack } : {}),
  };

  const jsonString = JSON.stringify(pkg, null, 2);
  const packageBlob = new Blob([jsonString], { type: "application/json" });
  const downloadUrl = URL.createObjectURL(packageBlob);

  const a = document.createElement("a");
  a.href = downloadUrl;
  const safeTitle = (state.title || "project").replace(/[^a-z0-9_-]/gi, "_").toLowerCase();
  a.download = `${safeTitle}.vidstr`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(downloadUrl), 5000);
}

export async function importProjectFile(file: File): Promise<ProjectState> {
  const text = await file.text();
  const pkg: VidstrPackage = JSON.parse(text);

  if (!pkg.version || !pkg.stateJson) {
    throw new Error("Invalid .vidstr project package file");
  }

  const parsedState: ProjectState = JSON.parse(pkg.stateJson);
  const mediaMap = new Map(pkg.media.map((m) => [m.clipId, m]));

  const rehydratedClips: Clip[] = parsedState.clips.map((clip) => {
    const mediaInfo = mediaMap.get(clip.id);
    if (!mediaInfo) return clip;

    const fileBlob = dataUrlToBlob(mediaInfo.fileDataUrl, mediaInfo.fileType);
    const clipFile = new File([fileBlob], mediaInfo.fileName, { type: mediaInfo.fileType });

    getClipBlobUrl(clipFile);

    return {
      ...clip,
      file: clipFile,
      // A Still is never "normalized" — sourceName() would otherwise be free to
      // hand ffmpeg an image under an .mp4 name (ADR-0012).
      ...(clip.kind === "still" ? {} : { normalized: fileBlob }),
      poster: mediaInfo.poster || clip.poster,
    };
  });

  const fontMap = new Map<string, Blob>();
  for (const f of pkg.titleFonts ?? []) {
    const blob = dataUrlToBlob(f.fontDataUrl, f.fontType || "font/ttf");
    const fallbackExt = (f.fontType || "").includes("otf") ? ".otf" : ".ttf";
    fontMap.set(f.key, new File([blob], f.fileName || `imported-font${fallbackExt}`, { type: f.fontType || blob.type }));
  }
  const voiceMap = new Map<string, Blob>();
  for (const voice of pkg.userVoice ?? []) {
    const blob = dataUrlToBlob(voice.fileDataUrl, voice.fileType || "audio/webm");
    voiceMap.set(voice.key, new File([blob], voice.fileName, { type: voice.fileType || blob.type }));
  }

  let musicFile: File | undefined;
  let musicFileName = parsedState.musicTrack?.fileName;
  if (parsedState.musicTrack && musicFileName) {
    try { musicFile = await fetchMusicFile(musicFileName); } catch { /* legacy package fallback below */ }
  }
  if (parsedState.musicTrack && !musicFile && pkg.musicTrack) {
    const blob = dataUrlToBlob(pkg.musicTrack.fileDataUrl, pkg.musicTrack.fileType || "audio/wav");
    musicFile = new File([blob], pkg.musicTrack.fileName, { type: pkg.musicTrack.fileType || blob.type });
    try { musicFileName = await uploadMusic(musicFile); } catch { /* package remains usable in memory */ }
  }

  const rehydrated = reinjectUserVoiceFiles(reinjectTitleFonts(
    {
      ...parsedState,
      clips: rehydratedClips,
      musicTrack: parsedState.musicTrack && musicFile
        ? { ...parsedState.musicTrack, file: musicFile, ...(musicFileName ? { fileName: musicFileName } : {}) }
        : undefined,
    },
    fontMap,
  ), voiceMap);
  return promoteTitleFontsToAppLibrary(rehydrated);
}
