import type { ProjectState } from "../state/projectReducer";
import type { Clip } from "../domain/types";
import { getClipBlobUrl } from "./blobUrlCache";

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

  const serializableClips = state.clips.map(({ file, normalized, ...rest }) => rest);
  const serializableState = { ...state, clips: serializableClips };

  const pkg: VidstrPackage = {
    version: 1,
    exportedAt: Date.now(),
    title: state.title || "Untitled project",
    stateJson: JSON.stringify(serializableState),
    media: mediaList,
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
      normalized: fileBlob,
      poster: mediaInfo.poster || clip.poster,
    };
  });

  return {
    ...parsedState,
    clips: rehydratedClips,
  };
}
