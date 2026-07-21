import { useEffect, useMemo, useRef, useState } from "react";
import type { Clip, Cut } from "../../domain/types";
import { canvasDims } from "./export";
import { captionSchedule, cueAt } from "../../lib/pacing";

// WYSIWYG preview of the finished reel: plays each beat's trimmed footage in
// order and composes the SAME layers the export burns in — styled captions, the
// timed title overlay, correct aspect — plus optional music/voiceover. It's a
// browser approximation (system fonts, un-ducked audio), not a pixel render.
//
// A per-beat wall clock (`beatElapsed`), not the video's currentTime, is the
// source of truth for advancing beats and switching captions. That lets a beat
// outlast its footage: when the author sets per-line caption timers the beat runs
// for the timer sum (beat.durationSec), freezing the last video frame once the
// footage is spent — the same shape the export produces.
const ASPECT_RATIO = { "16:9": 16 / 9, "9:16": 9 / 16, "1:1": 1 } as const;
const CAPTION_H_FRACTION = 0.045; // caption font ≈ 4.5% of frame height (matches export)
const PREVIEW_H = 360;

export interface PreviewTitle {
  text: string;
  sizePx: number; // px on the 1080p-height canvas
  color: string;
  position: "top" | "center" | "bottom";
  scope: "intro" | "entire";
  serif: boolean;
  introSec?: number;
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
  /** Silent lead-in before the beat's narration starts (mirrors the export). */
  voiceoverLeadSec?: number;
}

export default function FinalPreview({ cut, clips, captionScale, captionOpacity, captionLineHeight, title, music, musicVolume, voiceover, voiceoverLeadSec = 0 }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
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

  // Load the current beat's footage and seek to its in-point (object URL
  // created+revoked here → StrictMode-safe). Deliberately NOT keyed on `playing`
  // so pausing/resuming doesn't reload and restart the clip.
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

  // Voiceover narration per beat (browser TTS — the preview's stand-in for Kokoro).
  useEffect(() => {
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    if (!synth) return;
    synth.cancel();
    if (!playing || !voiceover) return;
    const text = cut.beats[index]?.scriptText?.trim();
    if (!text) return;
    // Ease the voice in after the lead-in, matching the export.
    const t = setTimeout(() => synth.speak(new SpeechSynthesisUtterance(text)), Math.round(voiceoverLeadSec * 1000));
    return () => { clearTimeout(t); synth.cancel(); };
  }, [index, playing, voiceover, cut.beats, voiceoverLeadSec]);

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
  const schedule = beat ? captionSchedule(beat.captionText, beat.captionDurations) : null;
  const caption = schedule ? cueAt(schedule, beatElapsed)?.text ?? "" : beat?.captionText ?? "";
  const capFont = PREVIEW_H * CAPTION_H_FRACTION * captionScale;
  const titleVisible = !!title && title.text.trim() !== "" && (title.scope === "entire" || elapsed < (title.introSec ?? 3));
  const titleFont = title ? PREVIEW_H * (title.sizePx / canvasH) : 0;

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
        <video ref={videoRef} muted playsInline style={{ width: "100%", height: "100%", objectFit: "contain" }} />

        {titleVisible && title && (
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              padding: "0 12px",
              textAlign: "center",
              pointerEvents: "none",
              top: title.position === "top" ? "6%" : title.position === "center" ? "50%" : undefined,
              bottom: title.position === "bottom" ? "6%" : undefined,
              transform: title.position === "center" ? "translateY(-50%)" : undefined,
            }}
          >
            <span
              style={{
                color: title.color,
                fontWeight: 700,
                fontFamily: title.serif ? "Georgia, 'Times New Roman', serif" : "system-ui, sans-serif",
                fontSize: titleFont,
                lineHeight: 1.1,
                textShadow: "2px 2px 3px rgba(0,0,0,0.6)",
              }}
            >
              {title.text}
            </span>
          </div>
        )}

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
        {playing ? <button onClick={pause}>⏸ Pause</button> : <button onClick={play}>▶ Play preview</button>}
        <button onClick={restart}>⟲ Restart</button>
        <span style={{ fontSize: 13, color: "#888" }}>beat {index + 1} / {cut.beats.length} · {elapsed.toFixed(1)}s</span>
      </div>
      <audio ref={audioRef} />
    </div>
  );
}
