import { useEffect, useMemo, useRef, useState } from "react";
import type { Clip, Cut } from "../../domain/types";
import { canvasDims } from "./export";
import { activeCaptionText } from "../../lib/pacing";
import { cssFilterFor } from "../../studio/util";
import { synthesizeVoiceover, type TtsEngine } from "../../lib/tts";
import type { Voice } from "../../lib/kokoroTts";

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

  // Load the current beat's footage and seek to its in-point
  useEffect(() => {
    const v = videoRef.current;
    const b = cut.beats[index];
    const clip = b && clipById.get(b.clipId);
    const src = clip?.normalized ?? clip?.file;
    if (!v || !b || !src) return;
    const url = URL.createObjectURL(src);
    v.src = url;
    const onMeta = () => {
      v.currentTime = b.inSec;
      if (playingRef.current) v.play().catch(() => {});
    };
    v.addEventListener("loadedmetadata", onMeta, { once: true });
    return () => {
      v.removeEventListener("loadedmetadata", onMeta);
      URL.revokeObjectURL(url);
    };
  }, [index, cut.beats, clipById]);

  // Play/pause the loaded video in step with the transport.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (playing) v.play().catch(() => {});
    else v.pause();
  }, [playing]);

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
      if (v && v.currentTime >= b.outSec - 0.03 && !v.paused) v.pause(); // freeze last frame
      const e = beatElapsedRef.current + dt;
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

  const play = () => setPlaying(true);
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
        <video ref={videoRef} muted playsInline style={{ width: "100%", height: "100%", objectFit: "contain", filter: cssFilterFor(beat?.colorAdjustments) }} />

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
                  transform: "translate(-50%, -50%)",
                  width: "95%",
                  textAlign: "center",
                  pointerEvents: "none",
                  opacity,
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
                transform: "translate(-50%, -50%)",
                width: "90%",
                textAlign: "center",
                pointerEvents: "none",
                opacity,
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

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, justifyContent: "center" }}>
        {playing ? (
          <button onClick={pause} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
            Pause
          </button>
        ) : (
          <button onClick={play} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            Play preview
          </button>
        )}
        <button onClick={restart} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
          </svg>
          Restart
        </button>
        <span style={{ fontSize: 13, color: "#888", fontVariantNumeric: "tabular-nums" }}>beat {index + 1} / {cut.beats.length} · {elapsed.toFixed(1)}s</span>
      </div>
      <audio ref={audioRef} />
    </div>
  );
}
