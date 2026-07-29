import type { UserVoiceSegment } from "../domain/types";

const AUDIO_EXTENSIONS = /\.(aac|flac|m4a|mp3|mp4|oga|ogg|opus|wav|webm)$/i;

export function isSupportedUserVoiceFile(file: File): boolean {
  return file.type.startsWith("audio/") || AUDIO_EXTENSIONS.test(file.name);
}

export function importedUserVoiceName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "").trim() || "Imported voice";
}

export function makeImportedUserVoiceSegment(
  file: File,
  sourceDurationSec: number,
  startTimeSec: number,
  cutDurationSec: number,
  id: string,
): UserVoiceSegment {
  const sourceDuration = Math.max(0.1, sourceDurationSec);
  const start = Math.max(0, Math.min(startTimeSec, Math.max(0, cutDurationSec - 0.1)));
  const duration = Math.max(0.1, Math.min(sourceDuration, cutDurationSec - start));
  return {
    id,
    name: importedUserVoiceName(file.name),
    file,
    startTimeSec: Math.round(start * 10) / 10,
    durationSec: Math.round(duration * 100) / 100,
    sourceDurationSec: sourceDuration,
    sourceStartSec: 0,
    volume: 1,
    levelDb: 0,
    bassDb: 0,
    trebleDb: 0,
  };
}

/** Reads duration without decoding the whole audio file into memory. */
export function readAudioFileDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    const cleanup = () => {
      audio.removeAttribute("src");
      audio.load();
      URL.revokeObjectURL(url);
    };
    const fail = () => {
      cleanup();
      reject(new Error(`Could not read the duration of ${file.name}.`));
    };
    audio.preload = "metadata";
    audio.addEventListener("loadedmetadata", () => {
      const duration = audio.duration;
      cleanup();
      if (Number.isFinite(duration) && duration > 0) resolve(duration);
      else reject(new Error(`Could not read the duration of ${file.name}.`));
    }, { once: true });
    audio.addEventListener("error", fail, { once: true });
    audio.src = url;
  });
}
