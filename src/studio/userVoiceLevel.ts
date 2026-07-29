import {
  clampUserVoiceLevelDb,
  clampUserVoiceVolume,
  USER_VOICE_LEVEL_MAX_DB,
  USER_VOICE_LEVEL_MIN_DB,
} from "./userVoiceEq";

export const USER_VOICE_AUTO_LEVEL_TARGET_DBFS = -18;
export const USER_VOICE_PEAK_CEILING_DBFS = -1;

export interface UserVoiceLevelAnalysis {
  rmsDbfs: number;
  peakDbfs: number;
}

interface UserVoiceFileAnalysis extends UserVoiceLevelAnalysis {
  channels: Float32Array[];
  sampleRate: number;
  waveform: number[];
}

const userVoiceAnalysisCache = new WeakMap<File, Promise<UserVoiceFileAnalysis>>();

function amplitudeToDbfs(amplitude: number): number {
  return amplitude > 0 ? 20 * Math.log10(amplitude) : -Infinity;
}

export function analyzeUserVoiceChannels(channels: readonly Float32Array[]): UserVoiceLevelAnalysis {
  let sumSquares = 0;
  let sampleCount = 0;
  let peak = 0;
  for (const channel of channels) {
    for (const sample of channel) {
      const magnitude = Math.abs(sample);
      peak = Math.max(peak, magnitude);
      sumSquares += sample * sample;
      sampleCount++;
    }
  }
  const rms = sampleCount > 0 ? Math.sqrt(sumSquares / sampleCount) : 0;
  return { rmsDbfs: amplitudeToDbfs(rms), peakDbfs: amplitudeToDbfs(peak) };
}

export function analyzeUserVoiceWindow(
  channels: readonly Float32Array[],
  sampleRate: number,
  sourceStartSec: number,
  durationSec: number,
): UserVoiceLevelAnalysis {
  const sampleLength = channels[0]?.length ?? 0;
  const startSample = Math.min(
    sampleLength,
    Math.max(0, Math.floor(sourceStartSec * sampleRate)),
  );
  const endSample = Math.min(
    sampleLength,
    Math.max(startSample + 1, Math.ceil((sourceStartSec + durationSec) * sampleRate)),
  );
  return analyzeUserVoiceChannels(
    channels.map((channel) => channel.subarray(startSample, endSample)),
  );
}

export function waveformPeaksForChannels(
  channels: readonly Float32Array[],
  binCount = 512,
): number[] {
  const sampleLength = channels[0]?.length ?? 0;
  if (sampleLength === 0 || binCount <= 0) return [];
  const peaks = Array.from({ length: Math.min(binCount, sampleLength) }, () => 0);
  for (let bin = 0; bin < peaks.length; bin++) {
    const start = Math.floor((bin / peaks.length) * sampleLength);
    const end = Math.max(start + 1, Math.floor(((bin + 1) / peaks.length) * sampleLength));
    let peak = 0;
    for (const channel of channels) {
      for (let sample = start; sample < Math.min(end, channel.length); sample++) {
        peak = Math.max(peak, Math.abs(channel[sample]));
      }
    }
    peaks[bin] = peak;
  }
  return peaks;
}

export function recommendedUserVoiceLevelDb(analysis: UserVoiceLevelAnalysis): number {
  if (!Number.isFinite(analysis.rmsDbfs) || !Number.isFinite(analysis.peakDbfs)) return 0;
  const gainForTarget = USER_VOICE_AUTO_LEVEL_TARGET_DBFS - analysis.rmsDbfs;
  const gainForPeakCeiling = USER_VOICE_PEAK_CEILING_DBFS - analysis.peakDbfs;
  const safeGain = Math.min(gainForTarget, gainForPeakCeiling);
  return clampUserVoiceLevelDb(Math.round(safeGain * 2) / 2);
}

export function estimatedUserVoicePeakDbfs(
  analysis: UserVoiceLevelAnalysis,
  levelDb: number,
  volume: number,
): number {
  const normalizedVolume = clampUserVoiceVolume(volume);
  const volumeDb = normalizedVolume > 0 ? 20 * Math.log10(normalizedVolume) : -Infinity;
  return analysis.peakDbfs + clampUserVoiceLevelDb(levelDb) + volumeDb;
}

async function readUserVoiceFileAnalysis(file: File): Promise<UserVoiceFileAnalysis> {
  const cached = userVoiceAnalysisCache.get(file);
  if (cached) return cached;
  if (typeof AudioContext === "undefined") throw new Error("Audio analysis is not supported in this browser.");
  const result = (async () => {
    const context = new AudioContext();
    try {
      const decoded = await context.decodeAudioData(await file.arrayBuffer());
      const channels = Array.from(
        { length: decoded.numberOfChannels },
        (_, index) => decoded.getChannelData(index),
      );
      return {
        ...analyzeUserVoiceChannels(channels),
        channels,
        sampleRate: decoded.sampleRate,
        waveform: waveformPeaksForChannels(channels),
      };
    } finally {
      await context.close();
    }
  })();
  userVoiceAnalysisCache.set(file, result);
  try {
    return await result;
  } catch (error) {
    userVoiceAnalysisCache.delete(file);
    throw error;
  }
}

export async function analyzeUserVoiceFile(
  file: File,
  sourceStartSec?: number,
  durationSec?: number,
): Promise<UserVoiceLevelAnalysis> {
  const analysis = await readUserVoiceFileAnalysis(file);
  if (sourceStartSec !== undefined && durationSec !== undefined) {
    return analyzeUserVoiceWindow(
      analysis.channels,
      analysis.sampleRate,
      sourceStartSec,
      durationSec,
    );
  }
  const { rmsDbfs, peakDbfs } = analysis;
  return { rmsDbfs, peakDbfs };
}

export async function readUserVoiceWaveform(file: File): Promise<number[]> {
  return (await readUserVoiceFileAnalysis(file)).waveform;
}

export const USER_VOICE_LEVEL_RANGE = {
  min: USER_VOICE_LEVEL_MIN_DB,
  max: USER_VOICE_LEVEL_MAX_DB,
} as const;
