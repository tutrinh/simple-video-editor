import { useEffect, useMemo, useRef, useState } from "react";
import type { Aspect, Clip, Cut } from "../../domain/types";
import type { TitleLayerSettings } from "../../state/ExportSettingsContext";
import { canvasDims, type TitleAnimation } from "./export";
import { activeCaptionText } from "../../lib/pacing";
import { cssFilterFor, beatZoomStyle, isBeatZoomActive } from "../../studio/util";
import { synthesizeVoiceover, type TtsEngine } from "../../lib/tts";
import type { Voice } from "../../lib/kokoroTts";
import { getClipBlobUrl } from "../../lib/blobUrlCache";
import { drawTitleLayer, ensureTitleFontFace, titleFontKey, TITLE_ANIM } from "./titleCanvas";
import { getTitleFontBytes } from "./titleFonts";
import { drawCaptionBlock } from "./captionCanvas";
import { findFontById } from "../../lib/googleFonts";

// WYSIWYG preview of the finished reel: plays each beat's trimmed footage in
// order and composes the SAME layers the export burns in — styled captions, the
// timed title overlay, correct aspect — plus optional music/voiceover.
const ASPECT_RATIO = { "16:9": 16 / 9, "9:16": 9 / 16, "1:1": 1 } as const;
const PREVIEW_H = 360;

export interface PreviewTitleLayer {
  id: string;
  enabled: boolean;
  text: string;
  sizePx: number;
  letterSpacing?: number;
  arcDeg?: number;
  shadow?: boolean;
  color: string;
  posX: number;
  posY: number;
  scope: "intro" | "entire";
  introSec?: number;
  fontFamily?: string;
  fontWeight?: number;
  /** Font id + optional uploaded file — so the preview loads the SAME TTF bytes
   *  the export does and draws with the same shared canvas renderer (ADR-0008). */
  fontId: string;
  fontFile?: File | null;
  animation?: TitleAnimation;
  animDurationSec?: number;
}

export interface PreviewTitle {
  layers: PreviewTitleLayer[];
}

interface Props {
  cut: Cut;
  clips: Clip[];
  captionScale: number;
  captionOpacity: number;
  captionLineHeight: number;
  title: PreviewTitle | null;
  music: File | null;
  musicVolume: number;
  voiceover: boolean;
  ttsEngine?: TtsEngine;
  voice?: Voice;
  elevenVoiceId?: string;
  voiceoverSpeed?: number;
  /** Silent lead-in before the beat's narration starts (mirrors the export). */
  voiceoverLeadSec?: number;
}

export default function FinalPreview({
  cut, clips, captionScale, captionOpacity, captionLineHeight, title, music, musicVolume,
  voiceover, ttsEngine, voice, elevenVoiceId, voiceoverSpeed, voiceoverLeadSec = 0,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayVideoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const voCacheRef = useRef<Map<string, string>>(new Map());
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [beatElapsed, setBeatElapsed] = useState(0); // seconds into the current beat
  const beatElapsedRef = useRef(0);
  const playingRef = useRef(false);

  const clipById = useMemo(() => new Map(clips.map((c) => [c.id, c])), [clips]);

  const beat = cut.beats[index];
  const [canvasW, canvasH] = canvasDims(cut.aspect);

  useEffect(() => { playingRef.current = playing; }, [playing]);

  // Cumulative start time of the current beat (for title "first Ns" timing).
  const beatStart = useMemo(() => {
    let t = 0;
    for (let i = 0; i < index && i < cut.beats.length; i++) t += cut.beats[i].durationSec;
    return t;
  }, [cut.beats, index]);
  const elapsed = beatStart + beatElapsed;

  const activeOverlay = cut?.overlays?.find((o) => elapsed >= o.startTimeSec && elapsed < o.startTimeSec + o.durationSec) ?? null;
  const activeOverlayClip = activeOverlay ? clips.find((c) => c.id === activeOverlay.clipId) : null;
  const overlayBlobUrl = getClipBlobUrl(activeOverlayClip?.normalized ?? activeOverlayClip?.file);

  useEffect(() => {
    const el = overlayVideoRef.current;
    if (!el || !activeOverlay) return;
    const targetTime = (elapsed - activeOverlay.startTimeSec) + activeOverlay.inSec;
    if (Math.abs(el.currentTime - targetTime) > 0.15) {
      try { el.currentTime = targetTime; } catch {}
    }
    el.volume = activeOverlay.volume ?? 0;
    el.muted = (activeOverlay.volume ?? 0) === 0;
    if (playing && el.paused) {
      el.play().catch(() => {});
    } else if (!playing && !el.paused) {
      el.pause();
    }
  }, [elapsed, activeOverlay, playing]);

  const currentBeatClip = beat ? clipById.get(beat.clipId) : null;
  const mainBeatBlobUrl = getClipBlobUrl(currentBeatClip?.normalized ?? currentBeatClip?.file);

  // Load the current beat's footage and seek to its in-point
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !beat || !mainBeatBlobUrl) return;
    const vol = beat.volume ?? 1;
    v.volume = vol;
    v.muted = vol === 0;
    const onMeta = () => {
      v.currentTime = beat.inSec;
      if (playingRef.current) v.play().catch(() => {});
    };
    if (v.readyState >= 1) {
      v.currentTime = beat.inSec;
      if (playingRef.current) v.play().catch(() => {});
    } else {
      v.addEventListener("loadedmetadata", onMeta, { once: true });
    }
    return () => {
      v.removeEventListener("loadedmetadata", onMeta);
    };
  }, [index, beat, mainBeatBlobUrl]);

  // Play/pause the loaded video in step with the transport.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (playing) v.play().catch(() => {});
    else v.pause();
  }, [playing]);

  // Keep DOM video element synchronized with beatElapsed when paused or loaded
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !beat || playing) return;
    const srcSpan = Math.max(0.05, beat.outSec - beat.inSec);
    const bDur = beat.durationSec || srcSpan;
    const pct = Math.min(1, Math.max(0, beatElapsed / bDur));
    const targetTime = beat.inSec + pct * srcSpan;
    if (Math.abs(v.currentTime - targetTime) > 0.05) {
      try { v.currentTime = targetTime; } catch {}
    }
  }, [beat, beatElapsed, playing]);

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
      const footageDur = b.outSec - b.inSec;
      const e = beatElapsedRef.current + dt;
      if (v && footageDur > 0 && e >= footageDur - 0.03 && !v.paused) v.pause(); // freeze last frame once footage window is spent
      const total = Math.max(0.05, b.durationSec);
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
  }, [playing, index, cut.beats]);

  // Music bed source + volume.
  useEffect(() => {
    const a = audioRef.current;
    if (!a || !music) return;
    const url = URL.createObjectURL(music);
    a.src = url;
    a.loop = true;
    return () => URL.revokeObjectURL(url);
  }, [music]);
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = Math.min(1, Math.max(0, musicVolume));
  }, [musicVolume]);
  useEffect(() => {
    const a = audioRef.current;
    if (!a || !music) return;
    if (playing) a.play().catch(() => {});
    else a.pause();
  }, [playing, music]);

  // Synthesize and play neural AI voiceover per beat (Kokoro or ElevenLabs), matching the export.
  useEffect(() => {
    const text = cut.beats[index]?.scriptText?.trim();
    if (!playing || !voiceover || !text) return;

    let timer: NodeJS.Timeout;
    let activeAudio: HTMLAudioElement | null = null;
    let cancelled = false;

    const key = `${text}_${ttsEngine ?? "kokoro"}_${voice ?? "af_heart"}_${elevenVoiceId ?? ""}_${voiceoverSpeed ?? 1}`;

    async function playVo() {
      try {
        let url = voCacheRef.current.get(key);
        if (!url) {
          const narration = await synthesizeVoiceover(text, {
            engine: ttsEngine ?? "kokoro",
            voice,
            elevenVoiceId,
            speed: voiceoverSpeed,
          });
          if (cancelled) return;
          const blob = new Blob([new Uint8Array(narration.data)], { type: narration.ext === "mp3" ? "audio/mpeg" : "audio/wav" });
          url = URL.createObjectURL(blob);
          voCacheRef.current.set(key, url);
        }

        if (cancelled) return;

        timer = setTimeout(() => {
          if (cancelled) return;
          const a = new Audio(url);
          activeAudio = a;
          a.play().catch(() => {});
        }, Math.round(voiceoverLeadSec * 1000));
      } catch {
        // Fallback to SpeechSynthesis if AI voice is offline / generating
        if (cancelled) return;
        const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
        if (synth) {
          synth.cancel();
          timer = setTimeout(() => {
            const ut = new SpeechSynthesisUtterance(text);
            if (voiceoverSpeed) ut.rate = voiceoverSpeed;
            synth.speak(ut);
          }, Math.round(voiceoverLeadSec * 1000));
        }
      }
    }

    playVo();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (activeAudio) { activeAudio.pause(); activeAudio.src = ""; }
      if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel();
    };
  }, [index, playing, voiceover, ttsEngine, voice, elevenVoiceId, voiceoverSpeed, voiceoverLeadSec, cut.beats]);

  const play = () => {
    if (index >= cut.beats.length - 1) {
      const lastBeat = cut.beats[cut.beats.length - 1];
      const lastDur = lastBeat ? (lastBeat.durationSec || Math.max(0.05, lastBeat.outSec - lastBeat.inSec)) : 0;
      if (beatElapsedRef.current >= lastDur - 0.05) {
        restart();
        return;
      }
    }
    setPlaying(true);
  };
  const pause = () => setPlaying(false);
  const restart = () => {
    beatElapsedRef.current = 0;
    setBeatElapsed(0);
    const v = videoRef.current;
    if (v && cut.beats[0]) v.currentTime = cut.beats[0].inSec;
    if (audioRef.current) audioRef.current.currentTime = 0;
    setIndex(0);
    setPlaying(true);
  };

  // Timed beats show one line at a time (the cue live at beatElapsed); untimed
  // beats show the whole stacked caption, as before.
  const caption = beat ? activeCaptionText(beat.captionText, beat.captionDurations, beatElapsed, beat.durationSec || (beat.outSec - beat.inSec)) : "";

  const [trAnimKey, setTrAnimKey] = useState(0);

  useEffect(() => {
    setTrAnimKey((k) => k + 1);
  }, [index]);

  const currentTr = beat?.transition;
  const currentTrSec = beat?.transitionSec ?? 0.5;

  const nextBeat = cut.beats[index + 1];
  const nextTr = nextBeat?.transition;
  const nextTrSec = nextBeat?.transitionSec ?? 0.5;
  const currentBeatDur = beat ? (beat.durationSec || (beat.outSec - beat.inSec)) : 3;
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
    return cut.beats.reduce((acc, b) => acc + (b.durationSec || Math.max(0.05, b.outSec - b.inSec)), 0);
  }, [cut.beats]);

  function seekTotalTime(targetSec: number) {
    const clamped = Math.max(0, Math.min(totalCutDuration, targetSec));
    let accum = 0;
    let targetIndex = 0;
    let offsetInBeat = 0;

    for (let i = 0; i < cut.beats.length; i++) {
      const bDur = cut.beats[i].durationSec || Math.max(0.05, cut.beats[i].outSec - cut.beats[i].inSec);
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
      const srcSpan = Math.max(0.05, b.outSec - b.inSec);
      const bDur = b.durationSec || srcSpan;
      const pct = Math.min(1, Math.max(0, offsetInBeat / bDur));
      v.currentTime = b.inSec + pct * srcSpan;
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
        {/* Zoom lives on this wrapper, not the <video> — so a beat's transition
            animation (which drives the video's transform) never collides with it. */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            ...(isBeatZoomActive(beat?.zoom, beat?.zoomScope, beat?.zoomSec, beatElapsed) ? beatZoomStyle(beat?.zoom, beat?.zoomX, beat?.zoomY) : {}),
          }}
        >
          <video
            ref={videoRef}
            src={mainBeatBlobUrl}
            muted={(beat?.volume ?? 1) === 0}
            playsInline
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              filter: cssFilterFor(beat?.colorAdjustments, cut.globalFilterId, cut.globalFilterIntensity, cut.globalFilterAdjustments),
              animation: videoAnimStyle ? `${videoAnimStyle}` : undefined,
            }}
          />
        </div>

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
            muted={(activeOverlay.volume ?? 0) === 0}
            playsInline
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              pointerEvents: "none",
              opacity: activeOverlay.opacity,
              mixBlendMode: activeOverlay.blendMode as any,
              zIndex: 5,
            }}
          />
        )}

        {title && title.layers.map((layer) => {
          if (!layer.enabled || !layer.text.trim()) return null;

          // Scope: "entire" is always on; "intro" shows for introSec then fades.
          let opacity = 1;
          let visible = false;
          if (layer.scope === "entire") {
            visible = true;
          } else {
            const dur = layer.introSec ?? 3;
            const fade = Math.min(0.8, dur / 2);
            if (elapsed < dur) {
              visible = true;
              if (elapsed > dur - fade) opacity = Math.max(0, (dur - elapsed) / fade);
            }
          }
          if (!visible) return null;

          // Motion rides on top of the static bitmap (ADR-0008): opacity eases in
          // for every animation; slides translate by the SAME frame fraction the
          // export uses (TITLE_ANIM); pop eases opacity only, matching the export.
          const anim = layer.animation ?? "none";
          const animDur = layer.animDurationSec ?? 0.5;
          let animTransform = "";
          let animOpacity = opacity;
          if (elapsed < animDur && anim !== "none") {
            const p = Math.min(1, Math.max(0, elapsed / animDur));
            animOpacity = opacity * p;
            const previewW = PREVIEW_H * ASPECT_RATIO[cut.aspect];
            if (anim === "slide_left") animTransform = `translateX(${(1 - p) * -(previewW * TITLE_ANIM.slideXFrac)}px)`;
            else if (anim === "slide_bottom") animTransform = `translateY(${(1 - p) * (PREVIEW_H * TITLE_ANIM.slideYFrac)}px)`;
            else if (anim === "slide_top") animTransform = `translateY(${(1 - p) * -(PREVIEW_H * TITLE_ANIM.slideYFrac)}px)`;
          }

          return (
            <TitleLayerCanvas
              key={layer.id}
              layer={layer}
              cw={canvasW}
              ch={canvasH}
              opacity={animOpacity}
              transform={animTransform}
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

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, justifyContent: "center" }}>
        <button
          type="button"
          onClick={() => stepFrame(-1)}
          style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, background: "transparent", border: "none", color: "var(--ink-2)", cursor: "pointer", padding: "4px 6px" }}
          title="Step 1 frame backward (30fps)"
        >
          ‹ 1f
        </button>
        {playing ? (
          <button type="button" onClick={pause} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, background: "transparent", border: "none", color: "var(--ink-2)", cursor: "pointer", padding: "4px 8px", borderRadius: 6 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
            Pause
          </button>
        ) : (
          <button type="button" onClick={play} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, background: "transparent", border: "none", color: "var(--ink-2)", cursor: "pointer", padding: "4px 8px", borderRadius: 6 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            Play preview
          </button>
        )}
        <button
          type="button"
          onClick={() => stepFrame(1)}
          style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, background: "transparent", border: "none", color: "var(--ink-2)", cursor: "pointer", padding: "4px 6px" }}
          title="Step 1 frame forward (30fps)"
        >
          1f ›
        </button>
        <button type="button" onClick={restart} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, background: "transparent", border: "none", color: "var(--ink-2)", cursor: "pointer", padding: "4px 8px", borderRadius: 6 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
          </svg>
          Restart
        </button>
        <span style={{ fontSize: 12, color: "var(--ink-2)", fontVariantNumeric: "tabular-nums", marginLeft: 4 }}>beat {index + 1} / {cut.beats.length}</span>
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
}: {
  layer: PreviewTitleLayer;
  cw: number;
  ch: number;
  opacity: number;
  transform: string;
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
        (ctx) => drawTitleLayer(ctx, {
          text: layer.text,
          canvasFamily,
          cssFamily,
          fontBytes: bytes,
          fontWeight: weight,
          sizePx: layer.sizePx,
          letterSpacing: layer.letterSpacing,
          arcDeg: layer.arcDeg,
          shadow: layer.shadow,
          color: layer.color,
          posX: layer.posX,
          posY: layer.posY,
        }, cw, ch),
        () => cancelled,
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [
    layer.text, layer.fontId, layer.fontFile, layer.fontFamily, layer.fontWeight,
    layer.sizePx, layer.letterSpacing, layer.arcDeg, layer.shadow, layer.color,
    layer.posX, layer.posY, cw, ch,
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
          letterSpacing: l.letterSpacing, arcDeg: l.arcDeg, shadow: l.shadow, color: l.color,
          posX: l.posX, posY: l.posY, scope: l.scope, introSec: l.introSec,
          fontFamily: findFontById(l.fontId)?.cssFamily, fontWeight: l.weight,
          fontId: l.fontId, fontFile: l.fontFile, animation: l.animation, animDurationSec: l.animDurationSec,
        };

        let opacity = 1;
        let visible = false;
        if (layer.scope === "entire") {
          visible = true;
        } else {
          const dur = layer.introSec ?? 3;
          const fade = Math.min(0.8, dur / 2);
          if (elapsed < dur) {
            visible = true;
            if (elapsed > dur - fade) opacity = Math.max(0, (dur - elapsed) / fade);
          }
        }
        if (!visible) return null;

        const anim = layer.animation ?? "none";
        const animDur = layer.animDurationSec ?? 0.5;
        let animTransform = "";
        let animOpacity = opacity;
        if (elapsed < animDur && anim !== "none") {
          const p = Math.min(1, Math.max(0, elapsed / animDur));
          animOpacity = opacity * p;
          const previewW = PREVIEW_H * ASPECT_RATIO[aspect];
          if (anim === "slide_left") animTransform = `translateX(${(1 - p) * -(previewW * TITLE_ANIM.slideXFrac)}px)`;
          else if (anim === "slide_bottom") animTransform = `translateY(${(1 - p) * (PREVIEW_H * TITLE_ANIM.slideYFrac)}px)`;
          else if (anim === "slide_top") animTransform = `translateY(${(1 - p) * -(PREVIEW_H * TITLE_ANIM.slideYFrac)}px)`;
        }

        return (
          <TitleLayerCanvas
            key={"beat-" + layer.id}
            layer={layer}
            cw={cw}
            ch={ch}
            opacity={animOpacity}
            transform={animTransform}
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
  lineHeight,
  marginPx,
}: {
  text: string;
  cw: number;
  ch: number;
  fontSizePx: number;
  bgOpacity: number;
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
        (ctx) => drawCaptionBlock(ctx, { text, fontSizePx, bgOpacity, lineHeight, marginPx }, cw, ch),
        () => cancelled,
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [text, cw, ch, fontSizePx, bgOpacity, lineHeight, marginPx]);

  return (
    <canvas
      ref={ref}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
    />
  );
}
