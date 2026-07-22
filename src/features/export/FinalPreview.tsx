import { useEffect, useMemo, useRef, useState } from "react";
import type { Clip, Cut } from "../../domain/types";
import { canvasDims, type TitleAnimation } from "./export";
import { activeCaptionText } from "../../lib/pacing";
import { cssFilterFor } from "../../studio/util";
import { synthesizeVoiceover, type TtsEngine } from "../../lib/tts";
import type { Voice } from "../../lib/kokoroTts";
import { getClipBlobUrl } from "../../lib/blobUrlCache";

// WYSIWYG preview of the finished reel: plays each beat's trimmed footage in
// order and composes the SAME layers the export burns in — styled captions, the
// timed title overlay, correct aspect — plus optional music/voiceover.
const ASPECT_RATIO = { "16:9": 16 / 9, "9:16": 9 / 16, "1:1": 1 } as const;
const CAPTION_H_FRACTION = 0.045; // caption font ≈ 4.5% of frame height (matches export)
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
  const [, canvasH] = canvasDims(cut.aspect);

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
  const capFont = PREVIEW_H * CAPTION_H_FRACTION * captionScale;

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
        <video
          ref={videoRef}
          src={mainBeatBlobUrl}
          muted={(beat?.volume ?? 1) === 0}
          playsInline
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            filter: cssFilterFor(beat?.colorAdjustments, cut.globalFilterId, cut.globalFilterIntensity),
            animation: videoAnimStyle ? `${videoAnimStyle}` : undefined,
          }}
        />

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
              objectFit: "contain",
              pointerEvents: "none",
              opacity: activeOverlay.opacity,
              mixBlendMode: activeOverlay.blendMode as any,
              zIndex: 5,
            }}
          />
        )}

        {title && title.layers.map((layer) => {
          if (!layer.enabled || !layer.text.trim()) return null;

          let opacity = 1;
          let visible = false;
          if (layer.scope === "entire") {
            visible = true;
            opacity = 1;
          } else {
            const dur = layer.introSec ?? 3;
            const fade = Math.min(0.8, dur / 2);
            if (elapsed < dur) {
              visible = true;
              if (elapsed > dur - fade) {
                opacity = Math.max(0, (dur - elapsed) / fade);
              }
            }
          }

          if (!visible) return null;
          const fontSize = PREVIEW_H * (layer.sizePx / canvasH);
          const curvature = layer.arcDeg ?? 0;

          const anim = layer.animation ?? "none";
          const animDur = layer.animDurationSec ?? 0.5;
          let animTransform = "";
          let animOpacity = opacity;

          if (elapsed < animDur && anim !== "none") {
            const p = Math.min(1, Math.max(0, elapsed / animDur));
            if (anim === "fade") {
              animOpacity = opacity * p;
            } else if (anim === "slide_left") {
              animOpacity = opacity * p;
              animTransform = ` translateX(${(1 - p) * -120}px)`;
            } else if (anim === "slide_bottom") {
              animOpacity = opacity * p;
              animTransform = ` translateY(${(1 - p) * 60}px)`;
            } else if (anim === "slide_top") {
              animOpacity = opacity * p;
              animTransform = ` translateY(${(1 - p) * -60}px)`;
            } else if (anim === "pop") {
              animOpacity = opacity * p;
              const scaleVal = 0.75 + p * 0.25;
              animTransform = ` scale(${scaleVal})`;
            }
          }

          if (curvature !== 0) {
            const hOffset = (curvature / 180) * 420;
            const svgW = 1000;
            const svgH = 600;
            const startY = 300 + hOffset * 0.4;
            const controlY = 300 - hOffset;
            const pathD = `M 40,${startY} Q ${svgW / 2},${controlY} ${svgW - 40},${startY}`;
            const pathId = `arc_${layer.id}`;

            return (
              <div
                key={layer.id}
                style={{
                  position: "absolute",
                  left: `${50 + layer.posX}%`,
                  top: `${50 + layer.posY}%`,
                  transform: `translate(-50%, -50%)${animTransform}`,
                  width: "95%",
                  textAlign: "center",
                  pointerEvents: "none",
                  opacity: animOpacity,
                  transition: "opacity 0.05s linear",
                }}
              >
                <svg viewBox={`0 0 ${svgW} ${svgH}`} style={{ width: "100%", overflow: "visible" }}>
                  <defs>
                    <path id={pathId} d={pathD} fill="none" />
                  </defs>
                  <text
                    fill={layer.color}
                    fontWeight={layer.fontWeight ?? 400}
                    fontFamily={layer.fontFamily || "system-ui, sans-serif"}
                    fontSize={fontSize * 2.8}
                    letterSpacing={layer.letterSpacing ? `${(layer.letterSpacing * PREVIEW_H * 2.8) / canvasH}px` : undefined}
                    style={{
                      filter: layer.shadow !== false ? "drop-shadow(2px 2px 3px rgba(0,0,0,0.6))" : "none",
                    }}
                  >
                    <textPath href={`#${pathId}`} startOffset="50%" textAnchor="middle">
                      {layer.text}
                    </textPath>
                  </text>
                </svg>
              </div>
            );
          }

          return (
            <div
              key={layer.id}
              style={{
                position: "absolute",
                left: `${50 + layer.posX}%`,
                top: `${50 + layer.posY}%`,
                transform: `translate(-50%, -50%)${animTransform}`,
                width: "90%",
                textAlign: "center",
                pointerEvents: "none",
                opacity: animOpacity,
                transition: "opacity 0.05s linear",
              }}
            >
              <span
                style={{
                  color: layer.color,
                  fontWeight: layer.fontWeight ?? 400,
                  fontFamily: layer.fontFamily || "system-ui, sans-serif",
                  fontSize,
                  letterSpacing: layer.letterSpacing ? `${(layer.letterSpacing * PREVIEW_H) / canvasH}px` : undefined,
                  lineHeight: 1.1,
                  textShadow: layer.shadow !== false ? "2px 2px 3px rgba(0,0,0,0.6)" : "none",
                }}
              >
                {layer.text}
              </span>
            </div>
          );
        })}

        {caption && (
          <div style={{ position: "absolute", left: 0, right: 0, bottom: `${PREVIEW_H * 0.07}px`, textAlign: "center", padding: "0 6px", pointerEvents: "none" }}>
            <span
              style={{
                display: "inline-block",
                maxWidth: "92%",
                background: `rgba(0,0,0,${captionOpacity})`,
                color: "#fff",
                fontWeight: 700,
                lineHeight: captionLineHeight,
                whiteSpace: "pre-line",
                padding: "2px 8px",
                borderRadius: 3,
                fontSize: capFont,
              }}
            >
              {caption}
            </span>
          </div>
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
