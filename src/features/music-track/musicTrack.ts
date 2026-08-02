import type { Beat, MusicCueMarker, MusicTrack } from "../../domain/types";
import { runIsolated, type EnginePhase } from "../../lib/ffmpegEngine";
import { resizeBeat } from "../../domain/beatDuration";

const VIDEO_EXTENSIONS = /\.(mp4|mov|m4v|webm|mkv|avi)$/i;
const SUPPORTED_EXTENSIONS = /\.(aac|flac|m4a|mp3|mp4|mov|m4v|oga|ogg|opus|wav|webm|mkv|avi)$/i;

export interface MusicAnalysis {
  durationSec: number;
  waveform: number[];
  cueMarkers: MusicCueMarker[];
}

export type MusicImportProgress =
  | { phase: "extracting"; progress: number }
  | { phase: "analyzing"; progress: number };

/** Effective gain shared by preview and export; mute never destroys the saved level. */
export function musicTrackGain(track: Pick<MusicTrack, "volume" | "muted">): number {
  return track.muted ? 0 : track.volume;
}

export function isSupportedMusicImport(file: Pick<File, "name" | "type">): boolean {
  return file.type.startsWith("audio/") || file.type.startsWith("video/") || SUPPORTED_EXTENSIONS.test(file.name);
}

export function isVideoMusicImport(file: Pick<File, "name" | "type">): boolean {
  return file.type.startsWith("video/") || (!file.type.startsWith("audio/") && VIDEO_EXTENSIONS.test(file.name));
}

/** Resize one selected Beat so its timeline end lands on an absolute music cue. */
export function snapBeatEndToMusicCue(
  beat: Beat,
  clipDurationSec: number,
  beatStartSec: number,
  cueTimeSec: number,
): Beat | null {
  const requestedDuration = cueTimeSec - beatStartSec;
  if (requestedDuration < 0.1) return null;
  return resizeBeat(beat, clipDurationSec, requestedDuration, "custom");
}

function waveformPeaks(channels: readonly Float32Array[], binCount: number): number[] {
  const length = channels[0]?.length ?? 0;
  if (!length || binCount <= 0) return [];
  const bins = Math.min(binCount, length);
  return Array.from({ length: bins }, (_, bin) => {
    const start = Math.floor((bin / bins) * length);
    const end = Math.max(start + 1, Math.floor(((bin + 1) / bins) * length));
    let peak = 0;
    for (const channel of channels) {
      for (let index = start; index < Math.min(end, channel.length); index++) {
        peak = Math.max(peak, Math.abs(channel[index] ?? 0));
      }
    }
    return Math.min(1, peak);
  });
}

/** Pure analysis seam: PCM in, compact waveform and edit cues out. */
export function analyzeMusicChannels(
  channels: readonly Float32Array[],
  sampleRate: number,
  waveformBins = 512,
): MusicAnalysis {
  const sampleLength = channels[0]?.length ?? 0;
  if (!sampleLength || !Number.isFinite(sampleRate) || sampleRate <= 0) {
    return { durationSec: 0, waveform: [], cueMarkers: [] };
  }

  const frameSize = Math.max(32, Math.round(sampleRate * 0.023));
  const hopSize = Math.max(16, Math.floor(frameSize / 2));
  const energies: number[] = [];
  for (let start = 0; start < sampleLength; start += hopSize) {
    const end = Math.min(sampleLength, start + frameSize);
    let sumSquares = 0;
    let count = 0;
    for (const channel of channels) {
      for (let index = start; index < end; index++) {
        const sample = channel[index] ?? 0;
        sumSquares += sample * sample;
        count++;
      }
    }
    energies.push(count ? Math.sqrt(sumSquares / count) : 0);
  }

  const novelty = energies.map((energy, index) => {
    const historyStart = Math.max(0, index - 10);
    const history = energies.slice(historyStart, index);
    const baseline = history.length ? history.reduce((sum, value) => sum + value, 0) / history.length : energy;
    return Math.max(0, energy - baseline);
  });
  const maxNovelty = novelty.reduce((maximum, value) => Math.max(maximum, value), 0);
  const minGapFrames = Math.max(1, Math.round((0.18 * sampleRate) / hopSize));
  const candidates: Array<{ frame: number; novelty: number }> = [];
  for (let index = 1; index < novelty.length - 1; index++) {
    const start = Math.max(0, index - 14);
    const end = Math.min(novelty.length, index + 15);
    const window = novelty.slice(start, end);
    const mean = window.reduce((sum, value) => sum + value, 0) / Math.max(1, window.length);
    const variance = window.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, window.length);
    const threshold = mean + Math.sqrt(variance) * 0.75;
    if (novelty[index] >= novelty[index - 1] && novelty[index] > novelty[index + 1] && novelty[index] > threshold && novelty[index] > maxNovelty * 0.08) {
      const previous = candidates[candidates.length - 1];
      if (previous && index - previous.frame < minGapFrames) {
        if (novelty[index] > previous.novelty) candidates[candidates.length - 1] = { frame: index, novelty: novelty[index] };
      } else {
        candidates.push({ frame: index, novelty: novelty[index] });
      }
    }
  }

  return {
    durationSec: sampleLength / sampleRate,
    waveform: waveformPeaks(channels, waveformBins),
    cueMarkers: candidates.map(({ frame, novelty: value }) => ({
      timeSec: Math.round(((frame * hopSize) / sampleRate) * 100) / 100,
      strength: maxNovelty > 0 ? Math.round((value / maxNovelty) * 1000) / 1000 : 0,
    })),
  };
}

function extension(name: string): string {
  return name.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() || "bin";
}

async function extractAudio(file: File, onProgress?: (progress: MusicImportProgress) => void): Promise<File> {
  const inputName = `music-input.${extension(file.name)}`;
  const bytes = await runIsolated(
    [{ name: inputName, data: new Uint8Array(await file.arrayBuffer()) }],
    ["-i", inputName, "-vn", "-map", "0:a:0", "-ac", "2", "-ar", "44100", "-c:a", "pcm_s16le", "music.wav"],
    "music.wav",
    (progress: number, _phase?: EnginePhase) => onProgress?.({ phase: "extracting", progress }),
  );
  const base = file.name.replace(/\.[^.]+$/, "").trim() || "music";
  return new File([bytes], `${base}.wav`, { type: "audio/wav" });
}

async function decode(file: File): Promise<{ channels: Float32Array[]; sampleRate: number }> {
  if (typeof AudioContext === "undefined") throw new Error("Audio analysis is not supported in this browser.");
  const context = new AudioContext();
  try {
    const audio = await context.decodeAudioData(await file.arrayBuffer());
    return {
      channels: Array.from({ length: audio.numberOfChannels }, (_, index) => audio.getChannelData(index).slice()),
      sampleRate: audio.sampleRate,
    };
  } finally {
    await context.close();
  }
}

/** Deep module interface: import media and return one audio-only, analyzed track. */
export async function prepareMusicTrack(
  source: File,
  onProgress?: (progress: MusicImportProgress) => void,
): Promise<MusicTrack> {
  if (!isSupportedMusicImport(source)) throw new Error("Choose an audio file or a video with an audio stream.");
  const fromVideo = isVideoMusicImport(source);
  let audioFile = fromVideo ? await extractAudio(source, onProgress) : source;
  onProgress?.({ phase: "analyzing", progress: 0.1 });
  let decoded: { channels: Float32Array[]; sampleRate: number };
  try {
    decoded = await decode(audioFile);
  } catch (error) {
    if (fromVideo) throw new Error(`The video's audio could not be decoded: ${error instanceof Error ? error.message : String(error)}`);
    audioFile = await extractAudio(source, onProgress);
    decoded = await decode(audioFile);
  }
  const analysis = analyzeMusicChannels(decoded.channels, decoded.sampleRate);
  if (analysis.durationSec <= 0) throw new Error("No usable audio was found in this file.");
  onProgress?.({ phase: "analyzing", progress: 1 });
  return {
    id: `music-${crypto.randomUUID()}`,
    name: audioFile.name,
    file: audioFile,
    durationSec: analysis.durationSec,
    waveform: analysis.waveform,
    cueMarkers: analysis.cueMarkers,
    volume: 0.5,
    muted: false,
    sourceKind: fromVideo ? "video-audio" : "audio",
  };
}
