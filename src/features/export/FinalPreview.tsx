import { useEffect, useMemo, useRef, useState } from "react";
import type { Aspect, Clip, Cut, Sticker } from "../../domain/types";
import type { TitleLayerSettings } from "../../state/ExportSettingsContext";
import { canvasDims, type TitleAnimation } from "./export";
import { activeVoSegment, activeVoCaption } from "../../lib/pacing";
import { activeUserVoiceCaption } from "../../studio/userVoiceTranscript";
import { cssFilterFor, beatRotationStyle, beatZoomStyle, isBeatZoomActive, kenBurnsStyleAt } from "../../studio/util";
import { activeStickers, renderStickersToCanvas, beatSpans, resolveStickers, resolveSfxSegments, stickerRenderKey } from "./stickerCanvas";

import { synthesizeVoiceover, type TtsEngine } from "../../lib/tts";
import { sfxFileUrl } from "../../lib/sfxLibrary";
import type { Voice } from "../../lib/kokoroTts";
import { getClipBlobUrl } from "../../lib/blobUrlCache";
import { getSplitLayoutCss, normalizeSplitConfig, getSlotTransformStyle } from "./splitScreenCanvas";

import { drawTitleLayerAsset, ensureTitleFontFace, titleFontKey, TITLE_ANIM } from "./titleCanvas";
import { getTitleFontBytes } from "./titleFonts";
import { drawCaptionBlock } from "./captionCanvas";
import { createVoToneGraph, hasVoTone, type VoToneGraph } from "../../studio/voTone";
import type { UserVoiceEffect } from "../../domain/types";
import { findFontById } from "../../lib/googleFonts";
import { previewFileForClip } from "../../studio/previewSource";
import { activePreviewMedia, applyPreviewSpeed, pausePreviewMedia, playPreviewMedia } from "../../studio/previewPlayback";
import { ControlButton } from "../../design-system/ControlPrimitives";
import ChevronLeftIcon from "../../design-system/icons/ChevronLeftIcon";
import ChevronRightIcon from "../../design-system/icons/ChevronRightIcon";
import PauseIcon from "../../design-system/icons/PauseIcon";
import PlayIcon from "../../design-system/icons/PlayIcon";
import ReplayIcon from "../../design-system/icons/ReplayIcon";
import { titleVisibilityAt, type TitleScope } from "./titleTiming";
import { useUserVoicePlayback } from "../../studio/useUserVoicePlayback";
import { captionVoiceGainAtTime } from "../../studio/userVoicePriority";
import { beatBoundaryGain, effectiveBeatVolume, effectiveSplitScreenSlotVolume } from "../../studio/beatAudio";
import { beatTiming, sourceOffsetAt, speedAtElapsed } from "../../domain/beatTiming";
import LedMatrixOverlay from "../effects/LedMatrixOverlay";
import { effectiveLedMatrixEffect } from "../effects/ledMatrix";
import PixelatePreview from "../effects/PixelatePreview";

// WYSIWYG preview of the finished reel: plays each beat's trimmed footage in
// order and composes the SAME layers the export burns in — styled captions, the
// timed title overlay, correct aspect — plus optional music/voiceover.
const ASPECT_RATIO = { "16:9": 16 / 9, "9:16": 9 / 16, "4:5": 4 / 5, "1:1": 1 } as const;
const PREVIEW_H = 360;
// Long enough to span several browser animation frames. Export can use the
// tighter PCM fade; HTMLMediaElement volume changes need a coarser envelope.
const PREVIEW_BEAT_AUDIO_EDGE_FADE_SEC = 0.05;

export interface PreviewTitleLayer {
  id: string;
  enabled: boolean;
  text: string;
  sizePx: number;
  letterSpacing?: number;
  arcDeg?: number;
  rotation?: number;
  shadow?: boolean;
  color: string;
  posX: number;
  posY: number;
  scope: TitleScope;
  introSec?: number;
  startSec?: number;
  durationSec?: number;
  fadeOut?: boolean;
  fontFamily?: string;
  fontWeight?: number;
  /** Font id + optional uploaded file — so the preview loads the SAME TTF bytes
   *  the export does and draws with the same shared canvas renderer (ADR-0008). */
  fontId: string;
  fontFile?: File | null;
  animation?: TitleAnimation;
  animDurationSec?: number;
  boxWidthPct?: number;
  lineHeight?: number;
  typewriterCursor?: boolean;
  maskMode?: "none" | "video";
  maskColor?: string;
}


export interface PreviewTitle {
  layers: PreviewTitleLayer[];
}

interface Props {
  active?: boolean;
  cut: Cut;
  clips: Clip[];
  captionScale: number;
  captionOpacity: number;
  captionLineHeight: number;
  /** Font id for captions; empty keeps the bundled caption face. */
  captionFontId?: string;
  /** Global VO tone in dB; 0 is neutral. */
  voiceoverBassDb?: number;
  voiceoverTrebleDb?: number;
  voiceoverEffect?: UserVoiceEffect;
  title: PreviewTitle | null;
  music: File | null;
  musicVolume: number;
  voiceover: boolean;
  /** Global narration gain used by export; per-segment volume and ducking stack on it. */
  voiceoverVolume?: number;
  ttsEngine?: TtsEngine;
  voice?: Voice;
  elevenVoiceId?: string;
  elevenModel?: string;
  elevenStability?: number;
  elevenStyle?: number;
  voiceoverSpeed?: number;
  /** Silent lead-in before the beat's narration starts (mirrors the export). */
  voiceoverLeadSec?: number;
  /** Enables Space to toggle playback while the surrounding editor is active. */
  enableSpacebarPlayback?: boolean;
  /** Currently selected beat ID in the parent editor workspace. */
  selectedBeatId?: string | null;
  /** Callback fired when the active playing beat changes in Cut view. */
  onActiveBeatChange?: (beatId: string, index: number) => void;
  /** Callback fired when playback starts or stops. */
  onPlayingChange?: (playing: boolean) => void;
  /** External transport command used by synchronized microphone recording. */
  transportCommand?: { id: number; action: "restart" | "pause" } | null;
  /** Keeps the visual transport running while silencing every preview source. */
  muteAllAudio?: boolean;
}

export default function FinalPreview({
  active = true,
  cut, clips, captionScale, captionOpacity, captionLineHeight, captionFontId, voiceoverBassDb, voiceoverTrebleDb, voiceoverEffect, title, music, musicVolume,
  voiceover, voiceoverVolume = 1,
  ttsEngine, voice, elevenVoiceId, elevenModel, elevenStability, elevenStyle, voiceoverSpeed,
  enableSpacebarPlayback = false,
  selectedBeatId,
  onActiveBeatChange,
  onPlayingChange,
  transportCommand,
  muteAllAudio = false,
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const slotVideoRefs = useRef<(HTMLVideoElement | null)[]>([]);
  const overlayVideoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const voCacheRef = useRef<Map<string, string>>(new Map());
  const generatedVoAudioRef = useRef<HTMLAudioElement | null>(null);
  // Bass/treble routing for AI VO. Created only when a segment actually asks for tone,
  // so the default (neutral) path plays through the plain element exactly as before —
  // routing every segment through Web Audio would risk a suspended context silencing it.
  const voToneCtxRef = useRef<AudioContext | null>(null);
  const voToneGraphRef = useRef<VoToneGraph | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [beatElapsed, setBeatElapsed] = useState(0); // seconds into the current beat
  const beatElapsedRef = useRef(0);
  const playingRef = useRef(false);

  const clipById = useMemo(() => new Map(clips.map((c) => [c.id, c])), [clips]);

  const beat = cut.beats[index];
  const currentBeatClip = beat ? clipById.get(beat.clipId) : null;
  const timing = beat ? beatTiming(beat, currentBeatClip?.durationSec) : null;
  const previewSpeed = currentBeatClip?.kind === "still" || !timing ? 1 : speedAtElapsed(timing, beatElapsed);
  const rampAudioMuted = Boolean(timing?.ramp);
  const [canvasW, canvasH] = canvasDims(cut.aspect);
  const ledMatrixEffect = effectiveLedMatrixEffect(beat?.ledMatrixEffect, cut.ledMatrixEffect);

  useEffect(() => { playingRef.current = playing; }, [playing]);

  useEffect(() => {
    onPlayingChange?.(playing);
  }, [playing, onPlayingChange]);

  // Sync internal index when selectedBeatId is changed by user clicking a beat in Timeline/ClipBin
  useEffect(() => {
    if (!selectedBeatId || cut.beats.length === 0) return;
    const targetIdx = cut.beats.findIndex((b) => b.id === selectedBeatId);
    if (targetIdx >= 0 && targetIdx !== index) {
      beatElapsedRef.current = 0;
      setBeatElapsed(0);
      setIndex(targetIdx);
      const b = cut.beats[targetIdx];
      const v = videoRef.current;
      if (v && b) {
        v.currentTime = b.inSec;
      }
    }
  }, [selectedBeatId, cut.beats]);

  useEffect(() => {
    const curBeat = cut.beats[index];
    if (curBeat && playing) {
      onActiveBeatChange?.(curBeat.id, index);
    }
  }, [index, cut.beats, playing, onActiveBeatChange]);

  // Cumulative start time of the current beat (for title "first Ns" timing).
  const beatStart = useMemo(() => {
    let t = 0;
    for (let i = 0; i < index && i < cut.beats.length; i++) {
      const item = cut.beats[i];
      t += beatTiming(item, clipById.get(item.clipId)?.durationSec).timelineSec;
    }
    return t;
  }, [clipById, cut.beats, index]);
  const elapsed = beatStart + beatElapsed;
  useUserVoicePlayback(cut.userVoiceSegments, elapsed, playing && !muteAllAudio);


  const activeOverlay = cut?.overlays?.find((o) => elapsed >= o.startTimeSec && elapsed < o.startTimeSec + o.durationSec) ?? null;
  const activeOverlayClip = activeOverlay ? clips.find((c) => c.id === activeOverlay.clipId) : null;
  const overlayBlobUrl = getClipBlobUrl(activeOverlayClip ? previewFileForClip(activeOverlayClip) : undefined);

  useEffect(() => {
    const el = overlayVideoRef.current;
    if (!el || !activeOverlay) return;
    const targetTime = (elapsed - activeOverlay.startTimeSec) + activeOverlay.inSec;
    if (Math.abs(el.currentTime - targetTime) > 0.15) {
      try { el.currentTime = targetTime; } catch {}
    }
    const volume = activeOverlay.volume ?? 0;
    el.volume = muteAllAudio ? 0 : volume;
    el.muted = muteAllAudio || volume === 0;
    if (playing && el.paused) {
      el.play().catch(() => {});
    } else if (!playing && !el.paused) {
      el.pause();
    }
  }, [elapsed, activeOverlay, playing, muteAllAudio]);

  const mainBeatBlobUrl = getClipBlobUrl(currentBeatClip ? previewFileForClip(currentBeatClip) : undefined);
  const splitActive = Boolean(beat?.splitScreen && beat.splitScreen.layout !== "none");

  const activeVideos = () => activePreviewMedia(videoRef.current, splitActive, slotVideoRefs.current);

  // Apply the Beat's authored Speed to every moving picture. Both fields are
  // intentional: a source load may restore playbackRate from defaultPlaybackRate.
  useEffect(() => {
    const media = activeVideos();
    const apply = () => applyPreviewSpeed(media, previewSpeed);
    apply();
    media.forEach((item) => item.addEventListener("loadedmetadata", apply));
    return () => media.forEach((item) => item.removeEventListener("loadedmetadata", apply));
  }, [index, previewSpeed, splitActive, beat?.splitScreen]);

  // The export drawer remains mounted to preserve its settings and generated
  // output. Closing it must still stop the transport and every media voice.
  useEffect(() => {
    if (active) return;
    playingRef.current = false;
    setPlaying(false);
    pausePreviewMedia(activeVideos());
    overlayVideoRef.current?.pause();
    audioRef.current?.pause();
    sfxVoicesRef.current.forEach((voice) => voice.pause());
  }, [active]);

  // Load the current beat's footage and seek to its in-point
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !beat || !mainBeatBlobUrl) return;
    const edgeGain = beatBoundaryGain(
      beatElapsedRef.current,
      timing?.timelineSec ?? 0,
      PREVIEW_BEAT_AUDIO_EDGE_FADE_SEC,
    );
    const vol = effectiveBeatVolume(beat, cut) * edgeGain;
    v.volume = muteAllAudio || rampAudioMuted ? 0 : vol;
    v.muted = muteAllAudio || rampAudioMuted || vol === 0;
    const onMeta = () => {
      applyPreviewSpeed(activeVideos(), previewSpeed);
      v.currentTime = beat.inSec;
      if (playingRef.current) v.play().catch(() => {});
    };
    if (v.readyState >= 1) {
      applyPreviewSpeed(activeVideos(), previewSpeed);
      v.currentTime = beat.inSec;
      if (playingRef.current) v.play().catch(() => {});
    } else {
      v.addEventListener("loadedmetadata", onMeta, { once: true });
    }
    return () => {
      v.removeEventListener("loadedmetadata", onMeta);
    };
  }, [index, beat, cut.beatAudioMasterVolume, cut.beatAudioMuted, mainBeatBlobUrl, muteAllAudio, previewSpeed, timing?.timelineSec, rampAudioMuted]);

  // Play/pause the loaded video in step with the transport.
  useEffect(() => {
    const media = activeVideos();
    if (playing) playPreviewMedia(media);
    else pausePreviewMedia(media);
  }, [playing, splitActive]);

  // Split slots have independent source in-points but share the Cut clock.
  // Keep every moving slot aligned with the current beat and transport state.
  useEffect(() => {
    if (!beat || !splitActive) return;
    const norm = normalizeSplitConfig(beat.splitScreen, currentBeatClip?.id ?? "", beat.inSec);
    norm.slots.forEach((slot, idx) => {
      const el = slotVideoRefs.current[idx];
      const slotClip = clips.find((clip) => clip.id === slot.clipId) ?? currentBeatClip;
      if (!el || slotClip?.kind === "still") return;
      const sourceOffset = timing ? sourceOffsetAt(timing, beatElapsed).offsetSec : beatElapsed;
      const targetTime = slot.inSec + sourceOffset;
      if (Math.abs(el.currentTime - targetTime) > 0.15) {
        try { el.currentTime = targetTime; } catch {}
      }
      const edgeGain = beatBoundaryGain(
        beatElapsed,
        timing?.timelineSec ?? 0,
        PREVIEW_BEAT_AUDIO_EDGE_FADE_SEC,
      );
      const volume = effectiveSplitScreenSlotVolume(slot, idx, beat, cut) * edgeGain;
      el.volume = muteAllAudio || rampAudioMuted ? 0 : volume;
      el.muted = muteAllAudio || rampAudioMuted || volume === 0;
      applyPreviewSpeed([el], previewSpeed);
      if (playing && el.paused) el.play().catch(() => {});
      else if (!playing && !el.paused) el.pause();
    });
  }, [beat, beatElapsed, clips, currentBeatClip, cut.beatAudioMasterVolume, cut.beatAudioMuted, playing, previewSpeed, splitActive, timing, muteAllAudio, rampAudioMuted]);

  // Keep DOM video element synchronized with beatElapsed when paused or loaded
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !beat || playing) return;
    const targetTime = beat.inSec + (timing ? sourceOffsetAt(timing, beatElapsed).offsetSec : beatElapsed);
    if (Math.abs(v.currentTime - targetTime) > 0.05) {
      try { v.currentTime = targetTime; } catch {}
    }
  }, [beat, beatElapsed, playing, timing]);

  // The beat clock: advance beatElapsed in real time, freeze the video once its
  // footage is spent, and move to the next beat when beatElapsed reaches the
  // beat's full on-screen duration.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const b = cut.beats[index];
      if (!b) { setPlaying(false); return; }
      const v = videoRef.current;
      const e = beatElapsedRef.current + dt;
      const bClip = clipById.get(b.clipId);
      const bTiming = beatTiming(b, bClip?.durationSec);
      const source = sourceOffsetAt(bTiming, e);
      if (v) {
        if (source.holding && !v.paused) v.pause();
        else if (!source.holding) {
          const target = b.inSec + source.offsetSec;
          if (Math.abs(v.currentTime - target) > 0.15) v.currentTime = target;
          applyPreviewSpeed([v], bClip?.kind === "still" ? 1 : speedAtElapsed(bTiming, e));
          if (v.paused && bClip?.kind !== "still") void v.play().catch(() => {});
        }
      }
      const total = Math.max(0.05, bTiming.timelineSec);
      if (v) {
        const edgeGain = beatBoundaryGain(
          Math.min(e, total),
          total,
          PREVIEW_BEAT_AUDIO_EDGE_FADE_SEC,
        );
        const volume = effectiveBeatVolume(b, cut) * edgeGain;
        const rampMuted = Boolean(bTiming.ramp);
        v.volume = muteAllAudio || rampMuted ? 0 : volume;
        v.muted = muteAllAudio || rampMuted || effectiveBeatVolume(b, cut) === 0;
      }
      if (e >= total) {
        if (index < cut.beats.length - 1) {
          beatElapsedRef.current = 0;
          setBeatElapsed(0);
          setIndex((x) => x + 1); // deps change → this effect restarts the loop
        } else {
          beatElapsedRef.current = total;
          setBeatElapsed(total);
          setPlaying(false);
        }
        return;
      }
      beatElapsedRef.current = e;
      setBeatElapsed(e);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, index, clipById, cut.beats, cut.beatAudioMasterVolume, cut.beatAudioMuted, muteAllAudio]);

  // Music bed source + volume.
  useEffect(() => {
    const a = audioRef.current;
    if (!a || !music) return;
    const url = getClipBlobUrl(music);
    if (!url) return;
    a.src = url;
    a.loop = true;
  }, [music]);
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = muteAllAudio ? 0 : Math.min(1, Math.max(0, musicVolume));
  }, [musicVolume, muteAllAudio]);
  useEffect(() => {
    const a = audioRef.current;
    if (!a || !music) return;
    if (playing && !muteAllAudio) a.play().catch(() => {});
    else a.pause();
  }, [playing, music, muteAllAudio]);

  // The VO segment whose window contains the current absolute time (audio plays
  // regardless of whether its caption is visible), decoupled from beats.
  const activeVo = activeVoSegment(cut.voSegments, elapsed);

  /**
   * Route the current narration element through the shelving filters. Safe to call more
   * than once for the same element: createMediaElementSource may only run once, so the
   * graph is kept and only its gains are updated afterwards.
   */
  function attachVoTone(audio: HTMLAudioElement, bassDb?: number, trebleDb?: number, effect?: UserVoiceEffect) {
    if (!voToneGraphRef.current) {
      if (!voToneCtxRef.current) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        try { voToneCtxRef.current = new Ctor(); } catch { return; }
      }
      voToneGraphRef.current = createVoToneGraph(audio, voToneCtxRef.current);
      if (!voToneGraphRef.current) return;
    }
    // A context created before any gesture starts suspended and would mute the voice.
    void voToneCtxRef.current?.resume().catch(() => {});
    voToneGraphRef.current.set(bassDb, trebleDb, effect);
  }

  // The tone context outlives individual segments so it is reused rather than rebuilt;
  // close it with the component.
  useEffect(() => () => {
    voToneGraphRef.current?.destroy();
    voToneGraphRef.current = null;
    void voToneCtxRef.current?.close().catch(() => {});
    voToneCtxRef.current = null;
  }, []);

  // Play the active VO segment's narration (Kokoro/ElevenLabs, synth cached),
  // seeking to how far into the segment we already are. Matches the export.
  useEffect(() => {
    if (!voiceover || !playing || muteAllAudio || !activeVo || !activeVo.text.trim()) return;
    const text = activeVo.text.trim();
    const startAt = activeVo.startTimeSec;
    const key = JSON.stringify({
      text,
      engine: ttsEngine ?? "kokoro",
      voice: voice ?? "af_heart",
      elevenVoiceId: elevenVoiceId ?? "",
      elevenModel: elevenModel ?? "",
      elevenStability: elevenStability ?? null,
      elevenStyle: elevenStyle ?? null,
      speed: voiceoverSpeed ?? 1,
    });
    let cancelled = false;
    let audio: HTMLAudioElement | null = null;

    (async () => {
      try {
        let url = voCacheRef.current.get(key);
        if (!url) {
          const narration = await synthesizeVoiceover(text, { engine: ttsEngine ?? "kokoro", voice, elevenVoiceId, speed: voiceoverSpeed, elevenModel, elevenStability, elevenStyle });
          if (cancelled) return;
          const blob = new Blob([new Uint8Array(narration.data)], { type: narration.ext === "mp3" ? "audio/mpeg" : "audio/wav" });
          url = getClipBlobUrl(blob);
          if (url) voCacheRef.current.set(key, url);
        }
        if (cancelled || !url) return;
        audio = new Audio(url);
        generatedVoAudioRef.current = audio;
        if (hasVoTone(voiceoverBassDb, voiceoverTrebleDb, voiceoverEffect)) {
          attachVoTone(audio, voiceoverBassDb, voiceoverTrebleDb, voiceoverEffect);
        }
        audio.volume = Math.min(1, Math.max(0,
          voiceoverVolume * (activeVo.volume ?? 1) * captionVoiceGainAtTime(
            cut.userVoiceSegments ?? [],
            beatElapsedRef.current + beatStart,
          ),
        ));
        const offset = Math.max(0, beatElapsedRef.current + beatStart - startAt);
        const seek = () => { try { audio!.currentTime = offset; } catch { /* pre-metadata */ } };
        audio.addEventListener("loadedmetadata", seek, { once: true });
        seek();
        audio.play().catch(() => {});
      } catch {
        /* offline or model still downloading — skip preview audio (export still narrates) */
      }
    })();

    return () => {
      cancelled = true;
      if (audio) {
        audio.pause();
        audio.src = "";
        if (generatedVoAudioRef.current === audio) generatedVoAudioRef.current = null;
        voToneGraphRef.current?.destroy();
        voToneGraphRef.current = null;
      }
    };
    // Re-run when the active segment (or its text) changes, or play toggles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeVo?.id, activeVo?.text, playing, muteAllAudio, voiceover, voiceoverVolume, ttsEngine, voice, elevenVoiceId, elevenModel, elevenStability, elevenStyle, voiceoverSpeed]);

  useEffect(() => {
    const audio = generatedVoAudioRef.current;
    if (!audio || !activeVo) return;
    // Adjusting a slider mid-playback must take effect now, not on the next segment.
    if (voToneGraphRef.current || hasVoTone(voiceoverBassDb, voiceoverTrebleDb, voiceoverEffect)) {
      attachVoTone(audio, voiceoverBassDb, voiceoverTrebleDb, voiceoverEffect);
    }
    audio.volume = Math.min(1, Math.max(0,
      voiceoverVolume * (activeVo.volume ?? 1) * captionVoiceGainAtTime(cut.userVoiceSegments ?? [], elapsed),
    ));
  }, [activeVo, cut.userVoiceSegments, elapsed, voiceoverVolume, voiceoverBassDb, voiceoverTrebleDb, voiceoverEffect]);

  // SFX track — one HTMLAudio "voice" per active segment (overlaps allowed), synced
  // to the global `elapsed` clock like the overlay/VO effects. Trim is enforced by
  // stopping the voice once the playhead passes the segment's window end.
  const sfxVoicesRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  useEffect(() => {
    const voices = sfxVoicesRef.current;
    if (!playing || muteAllAudio) { voices.forEach((a) => a.pause()); return; }
    for (const seg of resolveSfxSegments(cut.sfxSegments, beatSpans(cut.beats))) {

      const inWindow = elapsed >= seg.startTimeSec && elapsed < seg.startTimeSec + seg.durationSec;
      const existing = voices.get(seg.id);
      const vol = Math.min(1, Math.max(0, seg.volume));
      if (inWindow) {
        const offset = elapsed - seg.startTimeSec;
        if (!existing) {
          const a = new Audio(sfxFileUrl(seg.fileName));
          a.volume = vol;
          voices.set(seg.id, a);
          const start = () => { try { a.currentTime = offset; } catch { /* pre-metadata */ } a.play().catch(() => {}); };
          if (a.readyState >= 1) start(); else a.addEventListener("loadedmetadata", start, { once: true });
        } else {
          existing.volume = vol;
          if (Math.abs(existing.currentTime - offset) > 0.2) { try { existing.currentTime = offset; } catch { /* ignore */ } }
          if (existing.paused) existing.play().catch(() => {});
        }
      } else if (existing) {
        existing.pause();
        voices.delete(seg.id);
      }
    }
  }, [elapsed, playing, muteAllAudio, cut.sfxSegments]);

  // Stop and release all SFX voices on unmount.
  useEffect(() => {
    const voices = sfxVoicesRef.current;
    return () => { voices.forEach((a) => { a.pause(); a.src = ""; }); voices.clear(); };
  }, []);

  const play = () => {
    if (index >= cut.beats.length - 1) {
      const lastBeat = cut.beats[cut.beats.length - 1];
      const lastDur = lastBeat
        ? beatTiming(lastBeat, clipById.get(lastBeat.clipId)?.durationSec).timelineSec
        : 0;
      if (beatElapsedRef.current >= lastDur - 0.05) {
        restart();
        return;
      }
    }
    applyPreviewSpeed(activeVideos(), previewSpeed);
    playPreviewMedia(activeVideos()).then((started) => {
      if (started || activeVideos().length === 0) setPlaying(true);
    });
  };
  const pause = () => {
    pausePreviewMedia(activeVideos());
    setPlaying(false);
  };
  const restart = () => {
    beatElapsedRef.current = 0;
    setBeatElapsed(0);
    const v = videoRef.current;
    if (v && cut.beats[0]) v.currentTime = cut.beats[0].inSec;
    if (audioRef.current) audioRef.current.currentTime = 0;
    setIndex(0);
    const firstBeat = cut.beats[0];
    const firstClip = firstBeat ? clipById.get(firstBeat.clipId) : undefined;
    const firstSpeed = firstClip?.kind === "still"
      ? 1
      : firstBeat ? speedAtElapsed(beatTiming(firstBeat, firstClip?.durationSec), 0) : 1;
    applyPreviewSpeed(activeVideos(), firstSpeed);
    playPreviewMedia(activeVideos()).then((started) => {
      if (started || activeVideos().length === 0) setPlaying(true);
    });
  };

  useEffect(() => {
    if (!transportCommand) return;
    if (transportCommand.action === "restart") restart();
    else pause();
    // The monotonically increasing id makes identical consecutive commands run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transportCommand?.id]);

  // Captions come from the VO track by absolute cut time (only segments with the
  // caption toggle on), decoupled from beats.
  const caption = activeUserVoiceCaption(cut.userVoiceSegments, elapsed) || activeVoCaption(cut.voSegments, elapsed);

  const [trAnimKey, setTrAnimKey] = useState(0);

  useEffect(() => {
    setTrAnimKey((k) => k + 1);
  }, [index]);

  const currentTr = beat?.transition;
  const currentTrSec = beat?.transitionSec ?? 0.5;

  const nextBeat = cut.beats[index + 1];
  const nextTr = nextBeat?.transition;
  const nextTrSec = nextBeat?.transitionSec ?? 0.5;
  const currentBeatDur = timing?.timelineSec ?? 3;
  const timeRemaining = Math.max(0, currentBeatDur - beatElapsed);

  const currentTrPos = beat?.transitionPosition ?? "start";
  const nextTrPos = nextBeat?.transitionPosition ?? "start";
  const prevBeat = index > 0 ? cut.beats[index - 1] : undefined;
  const prevTr = prevBeat?.transition;
  const prevTrSec = prevBeat?.transitionSec ?? 0.5;
  const prevTrPos = prevBeat?.transitionPosition ?? "start";

  // Determine active outgoing and incoming transition effects
  const activeOutTr = (nextTr && nextTr !== "none" && nextTrPos === "start")
    ? { tr: nextTr, sec: nextTrSec }
    : (currentTr && currentTr !== "none" && currentTrPos === "end")
    ? { tr: currentTr, sec: currentTrSec }
    : undefined;

  const activeInTr = (currentTr && currentTr !== "none" && currentTrPos === "start")
    ? { tr: currentTr, sec: currentTrSec }
    : (prevTr && prevTr !== "none" && prevTrPos === "end")
    ? { tr: prevTr, sec: prevTrSec }
    : undefined;

  let transitionOverlayOpacity = 0;
  let transitionOverlayBg = "#000";

  // 1. Outgoing beat fading down near the end of beat duration
  if (activeOutTr && (activeOutTr.tr === "fadeblack" || activeOutTr.tr === "fade" || activeOutTr.tr === "fadewhite") && timeRemaining < activeOutTr.sec) {
    const fadeProgress = 1 - timeRemaining / activeOutTr.sec;
    transitionOverlayOpacity = Math.min(1, Math.max(0, fadeProgress));
    transitionOverlayBg = activeOutTr.tr === "fadewhite" ? "#fff" : "#000";
  }
  // 2. Incoming beat fading up at the start of new beat duration
  else if (activeInTr && (activeInTr.tr === "fadeblack" || activeInTr.tr === "fade" || activeInTr.tr === "fadewhite") && beatElapsed < activeInTr.sec) {
    const fadeProgress = 1 - beatElapsed / activeInTr.sec;
    transitionOverlayOpacity = Math.min(1, Math.max(0, fadeProgress));
    transitionOverlayBg = activeInTr.tr === "fadewhite" ? "#fff" : "#000";
  }

  const videoAnimStyle = useMemo(() => {
    if (!currentTr || currentTr === "none" || index === 0) return undefined;
    if (currentTr === "slideleft" || currentTr === "wipeleft") return `st-tr-slideleft ${currentTrSec}s ease-out`;
    if (currentTr === "slideright" || currentTr === "wiperight") return `st-tr-slideright ${currentTrSec}s ease-out`;
    return undefined;
  }, [currentTr, currentTrSec, trAnimKey, index]);

  // Total duration of all beats combined in the Cut
  const totalCutDuration = useMemo(() => {
    return cut.beats.reduce(
      (acc, b) => acc + beatTiming(b, clipById.get(b.clipId)?.durationSec).timelineSec,
      0,
    );
  }, [clipById, cut.beats]);

  function seekTotalTime(targetSec: number) {
    const clamped = Math.max(0, Math.min(totalCutDuration, targetSec));
    let accum = 0;
    let targetIndex = 0;
    let offsetInBeat = 0;

    for (let i = 0; i < cut.beats.length; i++) {
      const item = cut.beats[i];
      const bDur = beatTiming(item, clipById.get(item.clipId)?.durationSec).timelineSec;
      if (clamped <= accum + bDur || i === cut.beats.length - 1) {
        targetIndex = i;
        offsetInBeat = Math.min(bDur, Math.max(0, clamped - accum));
        break;
      }
      accum += bDur;
    }

    if (playingRef.current) setPlaying(false);
    
    beatElapsedRef.current = offsetInBeat;
    setBeatElapsed(offsetInBeat);
    setIndex(targetIndex);

    const b = cut.beats[targetIndex];
    const v = videoRef.current;
    if (v && b) {
      const bTiming = beatTiming(b, clipById.get(b.clipId)?.durationSec);
      v.currentTime = b.inSec + sourceOffsetAt(bTiming, offsetInBeat).offsetSec;
      applyPreviewSpeed([v], clipById.get(b.clipId)?.kind === "still" ? 1 : speedAtElapsed(bTiming, offsetInBeat));
    }
  }

  const scrubRef = useRef<HTMLDivElement>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);

  function handleScrubPointer(e: React.PointerEvent<HTMLDivElement>) {
    const el = scrubRef.current;
    if (!el || totalCutDuration <= 0) return;
    const rect = el.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seekTotalTime(pct * totalCutDuration);
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsScrubbing(true);
    handleScrubPointer(e);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (isScrubbing) handleScrubPointer(e);
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (isScrubbing) {
      e.currentTarget.releasePointerCapture(e.pointerId);
      setIsScrubbing(false);
    }
  }

  function stepFrame(frames: number) {
    const frameSec = 1 / 30; // ~33.3ms for frame inspection
    seekTotalTime(elapsed + frames * frameSec);
  }

  useEffect(() => {
    if (!enableSpacebarPlayback) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.code !== "Space" || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.isContentEditable
        || target?.closest("input, textarea, select, [contenteditable='true']")
      ) return;

      event.preventDefault();
      if (playingRef.current) pause();
      else play();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enableSpacebarPlayback]);

  return (
    <div>
      <div
        style={{
          position: "relative",
          height: PREVIEW_H,
          width: PREVIEW_H * ASPECT_RATIO[cut.aspect],
          maxWidth: "100%",
          margin: "0 auto",
          background: "#000",
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        {/* Zoom and rotation live on wrappers, not the <video> — a beat's
            transition animation drives the video's own transform and would
            collide. They are separate layers with separate pivots: zoom outside
            on the focus point, rotation inside on the centre. Nested transforms
            apply child-first, matching the export's rotate-then-zoom order. */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            // Ken Burns replaces the Zoom layer (ADR-0015). Sampled per frame
            // here rather than animated: this preview already advances
            // `beatElapsed` on its own rAF clock and scrubs through the whole
            // Cut, so there is no playback phase a CSS animation could own.
            ...(beat?.framing === "kenBurns" && beat.kenBurns
              // Normalised over the TRIM, not over `durationSec`. The export
              // spans the move across `outSec - inSec` and StagePreview does the
              // same; `durationSec` is a third derivation of that quantity, kept
              // equal only by Inspector's setTrim. Agreeing by expression rather
              // than by coincidence is free here.
              ? kenBurnsStyleAt(beat.kenBurns, beatElapsed / Math.max(0.05, beat.outSec - beat.inSec))
              : beatZoomStyle(beat?.zoom, beat?.zoomX, beat?.zoomY, isBeatZoomActive(beat?.zoom, beat?.zoomScope, beat?.zoomSec, beatElapsed))),
          }}
        >
        <div
          style={{
            position: "absolute",
            inset: 0,
            ...beatRotationStyle(...canvasDims(cut.aspect), beat?.rotation),
          }}
        >
          {/* A Still is an <img> in the same wrappers with the same grade and
              transition animation (ADR-0012). The beat clock above runs on rAF
              from b.durationSec, not from this element, so nothing else in the
              transport needs to know which one is mounted. */}
          <PixelatePreview effect={ledMatrixEffect} exportWidth={canvasW} exportHeight={canvasH}>
          {(() => {
            const splitCfg = beat?.splitScreen;
            const filterStyle = cssFilterFor(beat?.colorAdjustments, cut.globalFilterId, cut.globalFilterIntensity, cut.globalFilterAdjustments);

            if (splitCfg && splitCfg.layout !== "none" && splitCfg.slots.length > 1) {
              const normConfig = normalizeSplitConfig(splitCfg, currentBeatClip?.id ?? "", beat?.inSec ?? 0);
              const gridCss = getSplitLayoutCss(normConfig.layout);

              return (
                <div style={{ ...gridCss, filter: filterStyle, animation: videoAnimStyle ? `${videoAnimStyle}` : undefined }}>
                  {normConfig.slots.map((slot, idx) => {
                    const slotClip = clips.find((c) => c.id === slot.clipId) ?? currentBeatClip;
                    const slotBlob = slotClip ? getClipBlobUrl(previewFileForClip(slotClip)) : null;
                    const tfStyle = getSlotTransformStyle(slot);

                    return (
                      <div key={`${slot.clipId}-${idx}`} style={{ position: "relative", overflow: "hidden", background: "#000" }}>
                        {slotClip?.kind === "still" ? (
                          <img src={slotBlob ?? undefined} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", ...tfStyle }} />
                        ) : (
                          <video
                            ref={(el) => {
                              slotVideoRefs.current[idx] = el;
                              if (idx === 0) videoRef.current = el;
                            }}
                            src={slotBlob ?? undefined}
                            muted={muteAllAudio || !beat || effectiveSplitScreenSlotVolume(slot, idx, beat, cut) === 0}
                            playsInline
                            style={{ width: "100%", height: "100%", objectFit: "cover", ...tfStyle }}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            }

            return currentBeatClip?.kind === "still" ? (
              <img
                src={mainBeatBlobUrl}
                alt=""
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  filter: filterStyle,
                  animation: videoAnimStyle ? `${videoAnimStyle}` : undefined,
                }}
              />
            ) : (
              <video
                ref={videoRef}
                src={mainBeatBlobUrl}
                muted={muteAllAudio || !beat || effectiveBeatVolume(beat, cut) === 0}
                playsInline
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  filter: filterStyle,
                  animation: videoAnimStyle ? `${videoAnimStyle}` : undefined,
                }}
              />
            );
          })()}
          </PixelatePreview>

        </div>
        </div>

        {ledMatrixEffect?.shape === "pixelate-circle" && (
          <LedMatrixOverlay effect={ledMatrixEffect} width={canvasW} height={canvasH} />
        )}

        {transitionOverlayOpacity > 0 && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: transitionOverlayBg,
              opacity: transitionOverlayOpacity,
              pointerEvents: "none",
              zIndex: 10,
              transition: "opacity 0.03s linear",
            }}
          />
        )}

        {activeOverlay && activeOverlayClip && overlayBlobUrl && (
          <video
            key={activeOverlay.id}
            ref={overlayVideoRef}
            src={overlayBlobUrl}
            muted={muteAllAudio || (activeOverlay.volume ?? 0) === 0}
            playsInline
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              // `contain`, not `cover`: the export fits a B-roll Overlay with
              // `force_original_aspect_ratio=decrease` and pads it with
              // `black@0.0` — fully transparent — so a mismatched aspect shows
              // the Beat's own footage around it rather than being cropped.
              objectFit: "contain",
              pointerEvents: "none",
              opacity: activeOverlay.opacity,
              mixBlendMode: activeOverlay.blendMode as any,
              zIndex: 5,
            }}
          />
        )}

        <StickerOverlay stickers={cut.stickers} beats={cut.beats} aspect={cut.aspect} cutSec={elapsed} />

        {title && title.layers.map((layer) => {
          if (!layer.enabled || !layer.text.trim()) return null;

          const timing = titleVisibilityAt(layer, elapsed);
          const { visible, opacity, localElapsedSec } = timing;
          if (!visible) return null;

          // Motion rides on top of the static bitmap (ADR-0008): opacity eases in
          // for every animation; slides translate by the SAME frame fraction the
          // export uses (TITLE_ANIM); pop eases opacity only, matching the export.
          const anim = layer.animation ?? "none";
          const animDur = layer.animDurationSec ?? 0.5;
          let animTransform = "";
          let animOpacity = opacity;
          let typewriterProgress: number | undefined = undefined;

          if (anim === "typewriter") {
            typewriterProgress = Math.min(1, Math.max(0, localElapsedSec / animDur));
          } else if (localElapsedSec < animDur && anim !== "none") {
            const p = Math.min(1, Math.max(0, localElapsedSec / animDur));
            animOpacity = opacity * p;
            const previewW = PREVIEW_H * ASPECT_RATIO[cut.aspect];
            if (anim === "slide_left") animTransform = `translateX(${(1 - p) * -(previewW * TITLE_ANIM.slideXFrac)}px)`;
            else if (anim === "slide_bottom") animTransform = `translateY(${(1 - p) * (PREVIEW_H * TITLE_ANIM.slideYFrac)}px)`;
            else if (anim === "slide_top") animTransform = `translateY(${(1 - p) * -(PREVIEW_H * TITLE_ANIM.slideYFrac)}px)`;
          }
          if (layer.maskMode === "video") animTransform = "";

          return (
            <TitleLayerCanvas
              key={layer.id}
              layer={layer}
              cw={canvasW}
              ch={canvasH}
              opacity={animOpacity}
              transform={animTransform}
              typewriterProgress={typewriterProgress}
            />
          );
        })}

        {/* Per-beat title layers — timed against this beat's local elapsed. */}
        <BeatTitleOverlay layers={beat?.titleLayers} aspect={cut.aspect} elapsed={beatElapsed} />

        {caption && (
          <CaptionCanvas
            text={caption}
            cw={canvasW}
            ch={canvasH}
            fontSizePx={Math.max(24, canvasH * 0.045) * captionScale}
            bgOpacity={captionOpacity}
            lineHeight={captionLineHeight}
            marginPx={canvasH * 0.07}
            fontId={captionFontId}
          />
        )}
      </div>

      {/* Interactive Scrubber Bar for Frame-by-Frame inspection */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, padding: "0 4px" }}>
        <span style={{ fontSize: 11, color: "var(--ink-3)", fontVariantNumeric: "tabular-nums", width: 44 }}>
          {elapsed.toFixed(1)}s
        </span>
        <div
          ref={scrubRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          style={{
            flex: 1,
            height: 10,
            borderRadius: 5,
            background: "var(--line)",
            position: "relative",
            cursor: "col-resize",
            display: "flex",
            alignItems: "center",
            touchAction: "none",
          }}
          title="Drag or click to scrub frame-by-frame"
        >
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: `${totalCutDuration > 0 ? (elapsed / totalCutDuration) * 100 : 0}%`,
              background: "var(--accent)",
              borderRadius: 5,
              opacity: 0.85,
            }}
          />
          <div
            style={{
              position: "absolute",
              left: `${totalCutDuration > 0 ? (elapsed / totalCutDuration) * 100 : 0}%`,
              top: "50%",
              width: 10,
              height: 14,
              borderRadius: 3,
              background: "var(--accent)",
              boxShadow: "0 1px 3px rgba(0,0,0,0.5)",
              transform: "translate(-50%, -50%)",
              pointerEvents: "none",
            }}
          />
        </div>
        <span style={{ fontSize: 11, color: "var(--ink-3)", fontVariantNumeric: "tabular-nums", width: 44, textAlign: "right" }}>
          {totalCutDuration.toFixed(1)}s
        </span>
      </div>

      <div className="st-transport st-cut-preview-transport">
        <ControlButton
          type="button"
          onClick={() => stepFrame(-1)}
          className="st-btn ghost"
          title="Step 1 frame backward (30fps)"
          aria-label="Step 1 frame backward"
        >
          <ChevronLeftIcon size={13} />
          1f
        </ControlButton>
        {playing ? (
          <ControlButton className="ds-play" onClick={pause} title="Pause preview" aria-label="Pause preview" aria-pressed>
            <PauseIcon size={13} />
          </ControlButton>
        ) : (
          <ControlButton className="ds-play" onClick={play} title="Play preview" aria-label="Play preview" aria-pressed={false}>
            <PlayIcon size={13} />
          </ControlButton>
        )}
        <ControlButton
          type="button"
          onClick={() => stepFrame(1)}
          className="st-btn ghost"
          title="Step 1 frame forward (30fps)"
          aria-label="Step 1 frame forward"
        >
          1f
          <ChevronRightIcon size={13} />
        </ControlButton>
        <ControlButton className="st-btn ghost" onClick={restart}>
          <ReplayIcon size={13} />
          Restart
        </ControlButton>
        <span className="st-tc st-num">Beat {index + 1} / {cut.beats.length}</span>
      </div>
      <audio ref={audioRef} />
    </div>
  );
}

/**
 * Paint a preview canvas at its on-screen size × devicePixelRatio (capped at the
 * export raster), with the context scaled so the shared renderer still draws in
 * export coordinates. This rasterizes text at the display's NATIVE resolution
 * instead of CSS-downscaling a fixed 1080p bitmap — crisp on HiDPI, no softening.
 * Renders off-screen then blits in one drawImage, so there is no clear/draw flash.
 */
async function paintHiDPI(
  canvas: HTMLCanvasElement,
  exportW: number,
  exportH: number,
  draw: (ctx: CanvasRenderingContext2D) => Promise<void> | void,
  isCancelled: () => boolean,
): Promise<void> {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const bw = rect.width > 0 ? Math.min(exportW, Math.round(rect.width * dpr)) : exportW;
  const bh = rect.height > 0 ? Math.min(exportH, Math.round(rect.height * dpr)) : exportH;

  const off = document.createElement("canvas");
  off.width = bw;
  off.height = bh;
  const offCtx = off.getContext("2d");
  if (!offCtx) return;
  offCtx.setTransform(bw / exportW, 0, 0, bh / exportH, 0, 0);
  await draw(offCtx);
  if (isCancelled()) return;

  if (canvas.width !== bw) canvas.width = bw;
  if (canvas.height !== bh) canvas.height = bh;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, bw, bh);
  ctx.drawImage(off, 0, 0);
}

/**
 * One title layer, drawn by the SHARED canvas renderer (ADR-0008) — the exact
 * same `drawTitleLayer` the export uses, at the display's native resolution.
 * Animation (opacity/transform) is applied to the canvas element, never baked in.
 */
function TitleLayerCanvas({
  layer,
  cw,
  ch,
  opacity,
  transform,
  typewriterProgress,
}: {
  layer: PreviewTitleLayer;
  cw: number;
  ch: number;
  opacity: number;
  transform: string;
  typewriterProgress?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const canvas = ref.current;
      if (!canvas) return;
      const weight = layer.fontWeight ?? 400;
      const cssFamily = layer.fontFamily || "sans-serif";
      const bytes = await getTitleFontBytes(layer.fontId, weight, layer.fontFile);
      const canvasFamily = await ensureTitleFontFace(titleFontKey(cssFamily, weight, bytes?.length), bytes, cssFamily);
      if (cancelled) return;
      await paintHiDPI(
        canvas,
        cw,
        ch,
        (ctx) => drawTitleLayerAsset(ctx, {
          text: layer.text,
          canvasFamily,
          cssFamily,
          fontBytes: bytes,
          fontWeight: weight,
          sizePx: layer.sizePx,
          letterSpacing: layer.letterSpacing,
          arcDeg: layer.arcDeg,
          rotation: layer.rotation,
          shadow: layer.shadow,
          color: layer.color,
          posX: layer.posX,
          posY: layer.posY,
          boxWidthPct: layer.boxWidthPct,
          lineHeight: layer.lineHeight,
          typewriterProgress,
          showCursor: layer.typewriterCursor !== false,
          maskMode: layer.maskMode,
          maskColor: layer.maskColor,
        }, cw, ch),
        () => cancelled,
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [
    layer.text, layer.fontId, layer.fontFile, layer.fontFamily, layer.fontWeight,
    layer.sizePx, layer.letterSpacing, layer.arcDeg, layer.rotation, layer.shadow, layer.color,
    layer.posX, layer.posY, layer.boxWidthPct, layer.lineHeight, layer.typewriterCursor,
    layer.maskMode, layer.maskColor,
    typewriterProgress, cw, ch,
  ]);

  return (
    <canvas
      ref={ref}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        opacity,
        transform: transform || undefined,
        transition: "opacity 0.05s linear",
      }}
    />
  );
}

/**
 * Renders a beat's stacked title layers over a preview surface, timed against
 * beat-local `elapsed` (scope "entire" = whole beat, "intro" = first Ns with a
 * fade). Shared by the Export preview and the Stage's Beat view so per-beat
 * titles look identical in both. Must live in a `position: relative` container.
 */
/**
 * The Sticker layer, shared by the Cut preview and the Beat preview the way
 * BeatTitleOverlay is (ADR-0011). Draws through the SHARED renderer onto a
 * full-frame bitmap at export resolution and shows it CSS-scaled — the same
 * bitmap the export composites, so placement cannot drift between them.
 */
export function StickerOverlay({
  stickers,
  beats,
  aspect,
  cutSec,
}: {
  stickers?: Sticker[];
  /** Needed to resolve a fitToBeat Sticker's window at read time. */
  beats: { durationSec: number }[];
  aspect: Aspect;
  cutSec: number;
}) {
  // One bitmap PER STICKER, not one for all of them: each carries its own blend
  // mode, and a merged layer could only have one. This also matches the export,
  // which emits one PNG per Sticker for the same reason.
  const [bitmaps, setBitmaps] = useState<Record<string, string>>({});
  const visible = activeStickers(resolveStickers(stickers, beatSpans(beats)), cutSec);
  // Derived from the renderer's own key so it cannot go stale when a visual
  // property is added.
  const key = visible.map(stickerRenderKey).join("|");

  useEffect(() => {
    let cancelled = false;
    if (!key) { setBitmaps({}); return; }
    const [cw, ch] = canvasDims(aspect);
    Promise.all(
      visible.map(async (st) => {
        const canvas = await renderStickersToCanvas([st], cw, ch);
        return [st.id, canvas ? canvas.toDataURL("image/png") : ""] as const;
      }),
    )
      .then((pairs) => {
        if (cancelled) return;
        setBitmaps(Object.fromEntries(pairs.filter(([, url]) => url)));
      })
      .catch((err) => {
        console.warn("[sticker] preview layer failed to render", err);
        if (!cancelled) setBitmaps({});
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, aspect]);

  if (!visible.length) return null;
  return (
    <>
      {visible.map((st) => {
        const url = bitmaps[st.id];
        if (!url) return null;
        return (
          <img
            key={st.id}
            src={url}
            alt=""
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              pointerEvents: "none",
              zIndex: 6,
            }}
          />
        );
      })}
    </>
  );
}

export function BeatTitleOverlay({
  layers,
  aspect,
  elapsed,
}: {
  layers?: TitleLayerSettings[];
  aspect: Aspect;
  elapsed: number;
}) {
  const [cw, ch] = canvasDims(aspect);
  if (!layers?.length) return null;

  return (
    <>
      {layers.map((l) => {
        if (!l.enabled || !l.text.trim()) return null;

        const layer: PreviewTitleLayer = {
          id: l.id, enabled: l.enabled, text: l.text, sizePx: l.sizePx,
          letterSpacing: l.letterSpacing, arcDeg: l.arcDeg, rotation: l.rotation, shadow: l.shadow, color: l.color,
          posX: l.posX, posY: l.posY, scope: l.scope, introSec: l.introSec,
          startSec: l.startSec, durationSec: l.durationSec,
          fadeOut: l.fadeOut,
          fontFamily: findFontById(l.fontId)?.cssFamily, fontWeight: l.weight,
          fontId: l.fontId, fontFile: l.fontFile, animation: l.animation, animDurationSec: l.animDurationSec,
          boxWidthPct: l.boxWidthPct, lineHeight: l.lineHeight, typewriterCursor: l.typewriterCursor,
          maskMode: l.maskMode,
          maskColor: l.maskColor,
        };


        const timing = titleVisibilityAt(layer, elapsed);
        const { visible, opacity, localElapsedSec } = timing;
        if (!visible) return null;

        const anim = layer.animation ?? "none";
        const animDur = layer.animDurationSec ?? 0.5;
        let animTransform = "";
        let animOpacity = opacity;
        let typewriterProgress: number | undefined = undefined;

        if (anim === "typewriter") {
          typewriterProgress = Math.min(1, Math.max(0, localElapsedSec / animDur));
        } else if (localElapsedSec < animDur && anim !== "none") {
          const p = Math.min(1, Math.max(0, localElapsedSec / animDur));
          animOpacity = opacity * p;
          const previewW = PREVIEW_H * ASPECT_RATIO[aspect];
          if (anim === "slide_left") animTransform = `translateX(${(1 - p) * -(previewW * TITLE_ANIM.slideXFrac)}px)`;
          else if (anim === "slide_bottom") animTransform = `translateY(${(1 - p) * (PREVIEW_H * TITLE_ANIM.slideYFrac)}px)`;
          else if (anim === "slide_top") animTransform = `translateY(${(1 - p) * -(PREVIEW_H * TITLE_ANIM.slideYFrac)}px)`;
        }
        if (layer.maskMode === "video") animTransform = "";

        return (
          <TitleLayerCanvas
            key={"beat-" + layer.id}
            layer={layer}
            cw={cw}
            ch={ch}
            opacity={animOpacity}
            transform={animTransform}
            typewriterProgress={typewriterProgress}
          />
        );
      })}
    </>
  );
}

/**
 * The active caption, drawn by the SHARED caption renderer (ADR-0008) — the same
 * drawCaptionBlock the export uses. Full-resolution canvas CSS-scaled into the
 * preview box, so the preview caption's font, wrapping, box, and placement match
 * the exported caption exactly (the old CSS span used a different font entirely).
 */
function CaptionCanvas({
  text,
  cw,
  ch,
  fontSizePx,
  bgOpacity,
  fontId,
  lineHeight,
  marginPx,
}: {
  text: string;
  cw: number;
  ch: number;
  fontSizePx: number;
  bgOpacity: number;
  fontId?: string;
  lineHeight: number;
  marginPx: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const canvas = ref.current;
      if (!canvas) return;
      await paintHiDPI(
        canvas,
        cw,
        ch,
        (ctx) => drawCaptionBlock(ctx, { text, fontSizePx, bgOpacity, lineHeight, marginPx, fontId }, cw, ch),
        () => cancelled,
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [text, cw, ch, fontSizePx, bgOpacity, lineHeight, marginPx, fontId]);

  return (
    <canvas
      ref={ref}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
    />
  );
}
