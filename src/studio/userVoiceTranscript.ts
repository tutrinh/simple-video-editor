import type { UserVoiceSegment } from "../domain/types";

import type { TranscriptWord } from "../domain/types";
export type { TranscriptWord } from "../domain/types";
export interface DeliveryMetrics { wordCount: number; wordsPerMinute: number; fillerCount: number; fillerWords: string[]; }
export interface TranscriptCaptionWindow { text: string; startSec: number; endSec: number; }

const FILLERS = new Set(["um", "uh", "erm", "like", "basically", "literally", "actually"]);

export function timeTranscript(text: string, durationSec: number): TranscriptWord[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const duration = Math.max(0.1, durationSec);
  const weights = words.map((word) => Math.max(1, word.replace(/[^a-z0-9]/gi, "").length));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = 0;
  return words.map((word, index) => {
    const startSec = cursor;
    cursor += duration * (weights[index] / totalWeight);
    return { text: word, startSec, endSec: index === words.length - 1 ? duration : cursor };
  });
}

export function deliveryMetrics(text: string, durationSec: number): DeliveryMetrics {
  const words = text.toLowerCase().match(/[a-z']+/g) ?? [];
  const fillers = words.filter((word) => FILLERS.has(word));
  return { wordCount: words.length, wordsPerMinute: durationSec > 0 ? Math.round(words.length / durationSec * 60) : 0, fillerCount: fillers.length, fillerWords: [...new Set(fillers)] };
}

export function userVoiceCaptionWindows(segments: UserVoiceSegment[] | undefined, beatStartSec: number, beatDurationSec: number, wordsPerCaption = 5): TranscriptCaptionWindow[] {
  const beatEnd = beatStartSec + beatDurationSec;
  const windows: TranscriptCaptionWindow[] = [];
  for (const segment of segments ?? []) {
    if (!segment.captionVisible || !segment.transcript?.trim()) continue;
    const timed = segment.transcriptWords?.length ? segment.transcriptWords : timeTranscript(segment.transcript, segment.sourceDurationSec);
    for (let index = 0; index < timed.length; index += wordsPerCaption) {
      const group = timed.slice(index, index + wordsPerCaption);
      const trim = segment.sourceStartSec ?? 0;
      const absoluteStart = segment.startTimeSec + Math.max(0, group[0].startSec - trim);
      const absoluteEnd = Math.min(segment.startTimeSec + segment.durationSec, segment.startTimeSec + group.at(-1)!.endSec - trim);
      if (absoluteStart >= beatEnd || absoluteEnd <= beatStartSec) continue;
      windows.push({ text: group.map((word) => word.text).join(" "), startSec: Math.max(0, absoluteStart - beatStartSec), endSec: Math.min(beatDurationSec, absoluteEnd - beatStartSec) });
    }
  }
  return windows.filter((window) => window.endSec > window.startSec + 0.01);
}

export function activeUserVoiceCaption(segments: UserVoiceSegment[] | undefined, cutTimeSec: number): string {
  for (const segment of segments ?? []) {
    if (!segment.captionVisible || !segment.transcript?.trim()) continue;
    const localTime = cutTimeSec - segment.startTimeSec + (segment.sourceStartSec ?? 0);
    if (localTime < 0 || localTime > segment.durationSec + (segment.sourceStartSec ?? 0)) continue;
    const timed = segment.transcriptWords?.length ? segment.transcriptWords : timeTranscript(segment.transcript, segment.sourceDurationSec);
    const activeIndex = timed.findIndex((word) => localTime >= word.startSec && localTime < word.endSec);
    if (activeIndex >= 0) {
      const groupStart = Math.floor(activeIndex / 5) * 5;
      return timed.slice(groupStart, groupStart + 5).map((word) => word.text).join(" ");
    }
  }
  return "";
}

interface LiveTranscriber { start(): void; stop(): void; }

export function createLiveTranscriber(onTranscript: (text: string) => void): LiveTranscriber | null {
  const scope = globalThis as typeof globalThis & { SpeechRecognition?: new () => any; webkitSpeechRecognition?: new () => any };
  const Recognition = scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
  if (!Recognition) return null;
  const recognition = new Recognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = navigator.language || "en-US";
  let finalText = "";
  recognition.onresult = (event: any) => {
    let interim = "";
    for (let index = event.resultIndex; index < event.results.length; index++) {
      const value = String(event.results[index][0]?.transcript ?? "").trim();
      if (event.results[index].isFinal) finalText = `${finalText} ${value}`.trim();
      else interim = `${interim} ${value}`.trim();
    }
    onTranscript(`${finalText} ${interim}`.trim());
  };
  return { start: () => { try { recognition.start(); } catch {} }, stop: () => { try { recognition.stop(); } catch {} } };
}
