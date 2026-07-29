import { useEffect, useMemo, useState } from "react";
import Waveform, { type WaveformTone } from "../design-system/Waveform";
import { clampUserVoiceVolume, dbToLinear } from "./userVoiceEq";
import { readUserVoiceWaveform } from "./userVoiceLevel";

interface Props {
  file: File;
  durationSec: number;
  sourceDurationSec: number;
  sourceStartSec?: number;
  volume: number;
  levelDb?: number;
  playheadSec?: number;
  variant: "timeline" | "inspector";
  onTrimChange?: (sourceStartSec: number, sourceEndSec: number) => void;
  onSeek?: (sourceTimeSec: number) => void;
}

export function waveformPeakTone(amplitude: number): WaveformTone {
  if (amplitude >= 1) return "danger";
  if (amplitude >= 10 ** (-3 / 20)) return "warning";
  return "safe";
}

export function downsampleWaveform(peaks: readonly number[], binCount: number): number[] {
  if (peaks.length === 0 || binCount <= 0) return [];
  const count = Math.min(binCount, peaks.length);
  return Array.from({ length: count }, (_, index) => {
    const start = Math.floor((index / count) * peaks.length);
    const end = Math.max(start + 1, Math.floor(((index + 1) / count) * peaks.length));
    let peak = 0;
    for (let sourceIndex = start; sourceIndex < end; sourceIndex++) {
      peak = Math.max(peak, peaks[sourceIndex] ?? 0);
    }
    return peak;
  });
}

export default function UserVoiceWaveform({
  file,
  durationSec,
  sourceDurationSec,
  sourceStartSec = 0,
  volume,
  levelDb = 0,
  playheadSec = 0,
  variant,
  onTrimChange,
  onSeek,
}: Props) {
  const [sourcePeaks, setSourcePeaks] = useState<number[]>([]);

  useEffect(() => {
    let current = true;
    setSourcePeaks([]);
    readUserVoiceWaveform(file)
      .then((peaks) => { if (current) setSourcePeaks(peaks); })
      .catch(() => { if (current) setSourcePeaks([]); });
    return () => { current = false; };
  }, [file]);

  const visiblePeaks = useMemo(() => {
    if (sourcePeaks.length === 0) return [];
    if (variant === "inspector") return downsampleWaveform(sourcePeaks, 88);
    const sourceDuration = Math.max(0.1, sourceDurationSec);
    const startIndex = Math.floor((Math.max(0, sourceStartSec) / sourceDuration) * sourcePeaks.length);
    const endIndex = Math.max(
      startIndex + 1,
      Math.ceil(((Math.max(0, sourceStartSec) + durationSec) / sourceDuration) * sourcePeaks.length),
    );
    return downsampleWaveform(
      sourcePeaks.slice(startIndex, Math.min(sourcePeaks.length, endIndex)),
      36,
    );
  }, [durationSec, sourceDurationSec, sourcePeaks, sourceStartSec, variant]);

  const gain = clampUserVoiceVolume(volume) * dbToLinear(levelDb);
  const sourceDuration = Math.max(0.1, sourceDurationSec);
  const sourceEndSec = Math.min(sourceDuration, Math.max(0, sourceStartSec) + durationSec);
  const playheadPct = Math.min(100, Math.max(0, (playheadSec / sourceDuration) * 100));
  const bars = visiblePeaks.map((peak) => {
    const amplitude = peak * gain;
    return { amplitude, tone: waveformPeakTone(amplitude) };
  });

  return (
    <Waveform
      bars={bars}
      variant={variant}
      ariaLabel={`Voice waveform${variant === "inspector" ? `, playhead ${playheadSec.toFixed(1)} seconds` : ""}`}
      playheadPct={playheadPct}
      trim={variant === "inspector" && onTrimChange && onSeek ? {
        startPct: (Math.max(0, sourceStartSec) / sourceDuration) * 100,
        endPct: (sourceEndSec / sourceDuration) * 100,
        minSpanPct: (0.1 / sourceDuration) * 100,
        onChange: (startPct, endPct) => onTrimChange(
          (startPct / 100) * sourceDuration,
          (endPct / 100) * sourceDuration,
        ),
        onSeek: (pct) => onSeek((pct / 100) * sourceDuration),
        onReset: (edge) => {
          if (edge === "in") onTrimChange(0, sourceEndSec);
          else onTrimChange(Math.max(0, sourceStartSec), sourceDuration);
        },
      } : undefined}
    />
  );
}
