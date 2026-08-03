import { useEffect, useRef, useState } from "react";
import type { UserVoiceEffect, UserVoiceSegment, VoSegment } from "../domain/types";
import { getClipBlobUrl } from "../lib/blobUrlCache";
import { activeVoSegment } from "../lib/pacing";
import { synthesizeVoiceover, type TtsOptions } from "../lib/tts";
import { captionVoiceGainAtTime } from "./userVoicePriority";
import { createVoToneGraph, hasVoTone, type VoToneGraph } from "./voTone";

interface Options {
  segments?: VoSegment[];
  userVoiceSegments?: UserVoiceSegment[];
  elapsedSec: number;
  playing: boolean;
  enabled: boolean;
  muted: boolean;
  synthesis: TtsOptions;
  volume: number;
  bassDb?: number;
  trebleDb?: number;
  effect?: UserVoiceEffect;
}

/** Play the generated VO lane against an externally-owned preview clock. */
export function useGeneratedVoicePlayback({
  segments,
  userVoiceSegments,
  elapsedSec,
  playing,
  enabled,
  muted,
  synthesis,
  volume,
  bassDb,
  trebleDb,
  effect,
}: Options) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const elapsedRef = useRef(elapsedSec);
  const playingRef = useRef(playing);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const toneRef = useRef<VoToneGraph | null>(null);
  const active = activeVoSegment(segments, elapsedSec);

  elapsedRef.current = elapsedSec;
  playingRef.current = playing;

  function setAudioLevel(audio: HTMLAudioElement, segment: VoSegment) {
    audio.volume = Math.min(1, Math.max(0,
      volume
      * (segment.volume ?? 1)
      * captionVoiceGainAtTime(userVoiceSegments ?? [], elapsedRef.current),
    ));
  }

  useEffect(() => {
    if (!enabled || muted || !playing || !active?.text.trim()) return;
    let cancelled = false;
    let audio: HTMLAudioElement | null = null;
    setLoading(true);
    setError("");

    synthesizeVoiceover(active.text.trim(), synthesis)
      .then((narration) => {
        if (cancelled || !playingRef.current) return;
        const now = elapsedRef.current;
        if (now < active.startTimeSec || now >= active.startTimeSec + active.durationSec) return;
        const blob = new Blob([new Uint8Array(narration.data)], {
          type: narration.ext === "mp3" ? "audio/mpeg" : "audio/wav",
        });
        const url = getClipBlobUrl(blob);
        if (!url) return;
        audio = new Audio(url);
        audioRef.current = audio;
        setAudioLevel(audio, active);

        if (hasVoTone(bassDb, trebleDb, effect)) {
          const AudioContextCtor = window.AudioContext
            ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
          if (AudioContextCtor) {
            try {
              contextRef.current ??= new AudioContextCtor();
              toneRef.current = createVoToneGraph(audio, contextRef.current);
              toneRef.current?.set(bassDb, trebleDb, effect);
              void contextRef.current.resume().catch(() => {});
            } catch {
              // Plain audio remains available when Web Audio is unavailable.
            }
          }
        }

        const start = () => {
          if (!audio || cancelled || !playingRef.current) return;
          const offset = Math.max(0, elapsedRef.current - active.startTimeSec);
          try { audio.currentTime = offset; } catch { /* metadata not ready yet */ }
          void audio.play().catch(() => {});
        };
        audio.addEventListener("loadedmetadata", start, { once: true });
        start();
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      if (audio) {
        audio.pause();
        audio.src = "";
      }
      if (audioRef.current === audio) audioRef.current = null;
      toneRef.current?.destroy();
      toneRef.current = null;
    };
    // Recreate only when the active narration asset or authored sound changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id, active?.text, enabled, muted, playing, synthesis.engine, synthesis.voice, synthesis.elevenVoiceId, synthesis.elevenModel, synthesis.elevenStability, synthesis.elevenStyle, synthesis.speed, bassDb, trebleDb, effect]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !active) return;
    setAudioLevel(audio, active);
    if (toneRef.current || hasVoTone(bassDb, trebleDb, effect)) toneRef.current?.set(bassDb, trebleDb, effect);
  }, [active, elapsedSec, userVoiceSegments, volume, bassDb, trebleDb, effect]);

  useEffect(() => () => {
    toneRef.current?.destroy();
    void contextRef.current?.close().catch(() => {});
    contextRef.current = null;
  }, []);

  return { loading, error };
}
