import { useEffect, useRef, useState, useMemo } from "react";
import type { Beat, Clip, Cut } from "../domain/types";
import FinalPreview from "../features/export/FinalPreview";
import { activeCaptionText } from "../lib/pacing";
import { fmtClock, cssFilterFor } from "./util";

interface Props {
  cut: Cut;
  clips: Clip[];
  beat: Beat | null;
  clip: Clip | undefined;
}

/**
 * Two views of the same Cut:
 *  - "Beat": the selected Beat's trimmed window, scrubbable, caption burned in.
 *  - "Cut": the whole edit played back sequentially (reuses the export FinalPreview).
 */
export default function StagePreview({ cut, clips, beat, clip }: Props) {
  const [mode, setMode] = useState<"beat" | "cut">("beat");
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0); // 0..1 within the beat window

  // Load the selected clip's source; object URL lifetime matches the <video> src.
  useEffect(() => {
    if (mode !== "beat") return;
    const v = videoRef.current;
    if (!v || !clip || !beat) return;
    const url = URL.createObjectURL(clip.normalized ?? clip.file);
    v.src = url;
    setPos(0);
    setPlaying(false);
    const onMeta = () => { v.currentTime = beat.inSec; };
    v.addEventListener("loadedmetadata", onMeta, { once: true });
    return () => { v.removeEventListener("loadedmetadata", onMeta); URL.revokeObjectURL(url); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip?.id, beat?.id, mode]);

  function togglePlay() {
    const v = videoRef.current;
    if (!v || !beat) return;
    if (playing) { v.pause(); setPlaying(false); return; }
    if (v.currentTime < beat.inSec || v.currentTime >= beat.outSec - 0.05) {
      v.currentTime = beat.inSec;
      setPos(0);
    }
    v.play().then(() => setPlaying(true)).catch(() => {});
  }

  const scrubRef = useRef<HTMLDivElement>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);

  function handleScrubPointer(e: React.PointerEvent<HTMLDivElement>) {
    const v = videoRef.current;
    const el = scrubRef.current;
    if (!v || !beat || !el) return;
    const rect = el.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const newTime = beat.inSec + pct * (beat.outSec - beat.inSec);
    if (playing) {
      v.pause();
      setPlaying(false);
    }
    v.currentTime = newTime;
    setPos(pct);
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
    const v = videoRef.current;
    if (!v || !beat) return;
    if (playing) {
      v.pause();
      setPlaying(false);
    }
    const frameTime = 1 / 30; // ~33.3ms 30fps frame stepping
    const span = Math.max(0.01, beat.outSec - beat.inSec);
    const newTime = Math.max(beat.inSec, Math.min(beat.outSec, v.currentTime + frames * frameTime));
    v.currentTime = newTime;
    setPos((newTime - beat.inSec) / span);
  }

  function onTimeUpdate() {
    const v = videoRef.current;
    if (!v || !beat) return;
    const span = Math.max(0.01, beat.outSec - beat.inSec);
    const newPos = Math.min(1, Math.max(0, (v.currentTime - beat.inSec) / span));
    setPos(newPos);
    if (playing && v.currentTime >= beat.outSec - 0.02) {
      v.pause();
      v.currentTime = beat.outSec;
      setPos(1);
      setPlaying(false);
    }
  }

  if (mode === "cut") {
    return (
      <>
        <div style={{ borderRadius: 12, overflow: "hidden" }}>
          <FinalPreview
            cut={cut}
            clips={clips}
            captionScale={1}
            captionOpacity={0.5}
            captionLineHeight={1.6}
            title={null}
            music={null}
            musicVolume={0.5}
            voiceover={false}
          />
        </div>
        <div className="st-transport">
          <span className="st-tc">Playing the whole cut</span>
          <span className="st-spacer" />
          <ModeSwitch mode={mode} setMode={setMode} />
        </div>
      </>
    );
  }

  if (!beat) {
    return (
      <div className="st-stage-empty">
        <h2>No cut yet</h2>
        <p>Add clips on the left, then press <strong>Regenerate cut</strong> to let Claude build a first draft.</p>
      </div>
    );
  }

  // Update beat video volume and muted state dynamically
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !beat) return;
    v.volume = beat.volume ?? 1;
    v.muted = (beat.volume ?? 1) === 0;
  }, [beat?.volume]);

  const clipUrlMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of clips) {
      const src = c.normalized ?? c.file;
      if (src) map.set(c.id, URL.createObjectURL(src));
    }
    return map;
  }, [clips]);

  useEffect(() => {
    return () => {
      for (const url of clipUrlMap.values()) {
        URL.revokeObjectURL(url);
      }
    };
  }, [clipUrlMap]);

  const aspectRatio = cut.aspect === "9:16" ? "9 / 16" : cut.aspect === "1:1" ? "1 / 1" : "16 / 9";

  const beatIndex = cut.beats.indexOf(beat);
  const beatStartSec = cut.beats.slice(0, Math.max(0, beatIndex)).reduce((sum, b) => sum + b.durationSec, 0);
  const beatElapsed = pos * (beat.outSec - beat.inSec);
  const elapsedCutSec = beatStartSec + beatElapsed;
  const caption = activeCaptionText(beat.captionText, beat.captionDurations, beatElapsed, beat.durationSec || (beat.outSec - beat.inSec));
  const isAtEnd = !playing && pos >= 0.98;

  return (
    <>
      <div className="st-preview" style={{ aspectRatio, cursor: "pointer", position: "relative" }} onClick={togglePlay} title={playing ? "Pause" : isAtEnd ? "Replay beat" : "Play beat"}>
        <video ref={videoRef} onTimeUpdate={onTimeUpdate} muted={(beat.volume ?? 1) === 0} playsInline style={{ filter: cssFilterFor(beat.colorAdjustments) }} />
        {(() => {
          const activeOverlay = cut?.overlays?.find((o) => elapsedCutSec >= o.startTimeSec && elapsedCutSec < o.startTimeSec + o.durationSec);
          const overlayClip = activeOverlay ? clips.find((c) => c.id === activeOverlay.clipId) : null;
          if (!activeOverlay || !overlayClip) return null;
          const blobUrl = clipUrlMap.get(overlayClip.id);

          return (
            <video
              key={activeOverlay.id}
              src={blobUrl}
              ref={(el) => {
                if (el) {
                  const targetTime = (elapsedCutSec - activeOverlay.startTimeSec) + activeOverlay.inSec;
                  if (Math.abs(el.currentTime - targetTime) > 0.15) {
                    el.currentTime = targetTime;
                  }
                  if (playing && el.paused) el.play().catch(() => {});
                  else if (!playing && !el.paused) el.pause();
                  el.volume = activeOverlay.volume;
                }
              }}
              muted={activeOverlay.volume === 0}
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
          );
        })()}
        <div className="st-badgeTL st-num">Beat {String(cut.beats.indexOf(beat) + 1).padStart(2, "0")} · {clip?.name ?? "—"}</div>
        <div className="cap"><span>{caption}</span></div>
      </div>
      <div className="st-transport">
        <button className="st-play" onClick={togglePlay} title={playing ? "Pause" : isAtEnd ? "Replay beat" : "Play beat"}>
          {playing ? (
            <svg width="12" height="13" viewBox="0 0 12 13" fill="currentColor"><rect x="1" width="3.4" height="13" rx="1"/><rect x="7.6" width="3.4" height="13" rx="1"/></svg>
          ) : isAtEnd ? (
            <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M11.534 7h3.932a.25.25 0 0 1 .192.41l-1.966 2.36a.25.25 0 0 1-.384 0l-1.966-2.36a.25.25 0 0 1 .192-.41zm-11 2h3.932a.25.25 0 0 0 .192-.41L2.692 6.23a.25.25 0 0 0-.384 0L.342 8.59A.25.25 0 0 0 .534 9z"/><path fillRule="evenodd" d="M8 3c-1.552 0-2.94.707-3.857 1.818a.5.5 0 1 1-.771-.636A6.002 6.002 0 0 1 13.917 7H12.9A5.002 5.002 0 0 0 8 3zM3.1 9a5.002 5.002 0 0 0 4.9 4c1.552 0 2.94-.707 3.857-1.818a.5.5 0 1 1 .771.636A6.002 6.002 0 0 1 2.083 9H3.1z"/></svg>
          ) : (
            <svg width="12" height="13" viewBox="0 0 12 13" fill="currentColor"><path d="M0 0l12 6.5L0 13z"/></svg>
          )}
        </button>
        <button
          type="button"
          onClick={() => stepFrame(-1)}
          style={{ display: "inline-flex", alignItems: "center", gap: 2, fontSize: 11, background: "transparent", border: "none", color: "var(--ink-2)", cursor: "pointer", padding: "4px 6px" }}
          title="Step 1 frame backward (30fps)"
        >
          ‹ 1f
        </button>
        <button
          type="button"
          onClick={() => stepFrame(1)}
          style={{ display: "inline-flex", alignItems: "center", gap: 2, fontSize: 11, background: "transparent", border: "none", color: "var(--ink-2)", cursor: "pointer", padding: "4px 6px" }}
          title="Step 1 frame forward (30fps)"
        >
          1f ›
        </button>
        <span className="st-tc st-num">{fmtClock(beat.inSec + pos * (beat.outSec - beat.inSec))}</span>
        <div
          ref={scrubRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          className="st-scrub"
          style={{ cursor: "col-resize", touchAction: "none" }}
          title="Drag or click to scrub frame-by-frame"
        >
          <div className="fill" style={{ width: `${pos * 100}%` }} />
          <div className="thumb" style={{ left: `${pos * 100}%` }} />
        </div>
        <span className="st-tc st-num">{fmtClock(beat.outSec)}</span>
        <span className="st-tsep" />
        <ModeSwitch mode={mode} setMode={setMode} />
      </div>
    </>
  );
}

function ModeSwitch({ mode, setMode }: { mode: "beat" | "cut"; setMode: (m: "beat" | "cut") => void }) {
  return (
    <div className="st-modeswitch">
      <button className={mode === "beat" ? "on" : ""} onClick={() => setMode("beat")}>Beat</button>
      <button className={mode === "cut" ? "on" : ""} onClick={() => setMode("cut")}>Cut</button>
    </div>
  );
}
