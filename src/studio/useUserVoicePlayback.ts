import { useEffect, useRef } from "react";
import type { UserVoiceSegment } from "../domain/types";
import { getClipBlobUrl } from "../lib/blobUrlCache";
import { createUserVoiceEqGraph, userVoiceAudioSettings, userVoiceLinearGain, type UserVoiceEqGraph } from "./userVoiceEq";

interface ActiveVoice {
  audio: HTMLAudioElement;
  graph: UserVoiceEqGraph | null;
}

/** Keeps overlapping User VO recordings synchronized to an absolute Cut clock. */
export function useUserVoicePlayback(
  segments: UserVoiceSegment[] | undefined,
  elapsedSec: number,
  playing: boolean,
) {
  const voicesRef = useRef<Map<string, ActiveVoice>>(new Map());
  const audioContextRef = useRef<AudioContext | null>(null);

  function disposeVoice(voice: ActiveVoice) {
    voice.audio.pause();
    voice.graph?.destroy();
    voice.audio.src = "";
  }

  useEffect(() => {
    const voices = voicesRef.current;
    const segmentIds = new Set((segments ?? []).map((segment) => segment.id));
    for (const [id, voice] of voices) {
      if (!segmentIds.has(id)) {
        disposeVoice(voice);
        voices.delete(id);
      }
    }

    if (!playing) {
      voices.forEach(({ audio }) => audio.pause());
      return;
    }

    if (!audioContextRef.current && typeof AudioContext !== "undefined") {
      audioContextRef.current = new AudioContext();
    }
    void audioContextRef.current?.resume();

    for (const segment of segments ?? []) {
      const inWindow = elapsedSec >= segment.startTimeSec
        && elapsedSec < segment.startTimeSec + segment.durationSec;
      const existing = voices.get(segment.id);
      if (!inWindow) {
        if (existing) {
          disposeVoice(existing);
          voices.delete(segment.id);
        }
        continue;
      }

      const offset = (segment.sourceStartSec ?? 0) + elapsedSec - segment.startTimeSec;
      const settings = userVoiceAudioSettings(segment);
      if (!existing) {
        const source = getClipBlobUrl(segment.file);
        if (!source) continue;
        const audio = new Audio(source);
        let graph: UserVoiceEqGraph | null = null;
        if (audioContextRef.current) {
          try {
            graph = createUserVoiceEqGraph(audio, audioContextRef.current);
            graph.set(settings);
          } catch {
            audio.volume = Math.min(1, userVoiceLinearGain(settings));
          }
        } else {
          audio.volume = Math.min(1, userVoiceLinearGain(settings));
        }
        voices.set(segment.id, { audio, graph });
        const begin = () => {
          try { audio.currentTime = offset; } catch {}
          audio.play().catch(() => {});
        };
        if (audio.readyState >= 1) begin();
        else audio.addEventListener("loadedmetadata", begin, { once: true });
      } else {
        if (existing.graph) existing.graph.set(settings);
        else existing.audio.volume = Math.min(1, userVoiceLinearGain(settings));
        if (Math.abs(existing.audio.currentTime - offset) > 0.25) {
          try { existing.audio.currentTime = offset; } catch {}
        }
        if (existing.audio.paused) existing.audio.play().catch(() => {});
      }
    }
  }, [elapsedSec, playing, segments]);

  useEffect(() => {
    const voices = voicesRef.current;
    return () => {
      voices.forEach(disposeVoice);
      voices.clear();
      void audioContextRef.current?.close();
      audioContextRef.current = null;
    };
  }, []);
}
