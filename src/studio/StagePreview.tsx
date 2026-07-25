import React, { Component, useEffect, useRef, useState, type ReactNode } from "react";
import type { Beat, Clip, Cut } from "../domain/types";
import FinalPreview, { BeatTitleOverlay, StickerOverlay } from "../features/export/FinalPreview";
import { canvasDims } from "../features/export/export";
import { activeVoCaption } from "../lib/pacing";
import { fmtClock, cssFilterFor, beatRotationStyle, beatZoomStyle, isBeatZoomActive, advanceStillPos } from "./util";
import { getClipBlobUrl } from "../lib/blobUrlCache";

interface ErrorBoundaryProps {
  fallback: (reset: () => void) => ReactNode;
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

class PreviewErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("StagePreview cut render error:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback(() => this.setState({ hasError: false }));
    }
    return this.props.children;
  }
}

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
  const overlayVideoRef = useRef<HTMLVideoElement>(null);
  const scrubRef = useRef<HTMLDivElement>(null);

  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0); // 0..1 within the beat window
  const [isScrubbing, setIsScrubbing] = useState(false);

  // A Still is an <img> with no clock of its own (ADR-0012), so the transport
  // below drives `pos` on rAF instead of reading video.currentTime. posRef
  // mirrors pos so the rAF loop can advance without re-subscribing each frame.
  const isStill = clip?.kind === "still";
  const stillUrl = isStill ? getClipBlobUrl(clip.normalized ?? clip.file) : null;
  const posRef = useRef(0);
  const setPosBoth = (p: number) => { posRef.current = p; setPos(p); };

  // 1. Load the selected clip's source using permanent blob cache
  useEffect(() => {
    if (mode !== "beat") return;
    setPosBoth(0);
    setPlaying(false);
    const v = videoRef.current;
    if (!v || !clip || !beat) return;
    const url = getClipBlobUrl(clip.normalized ?? clip.file);
    if (url && v.src !== url) v.src = url;
    const onMeta = () => { v.currentTime = beat.inSec; };
    if (v.readyState >= 1) {
      v.currentTime = beat.inSec;
    } else {
      v.addEventListener("loadedmetadata", onMeta, { once: true });
    }
    return () => { v.removeEventListener("loadedmetadata", onMeta); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip?.id, beat?.id, mode]);

  // 2. Update beat video volume and muted state dynamically
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !beat) return;
    v.volume = beat.volume ?? 1;
    v.muted = (beat.volume ?? 1) === 0;
  }, [beat?.volume]);

  // 2b. The Still transport: advance `pos` in real time over the Beat's window
  // and stop at the out-point, the way the video path stops at `outSec`.
  useEffect(() => {
    if (!isStill || !playing || !beat) return;
    const span = beat.outSec - beat.inSec;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const next = advanceStillPos(posRef.current, dt, span);
      setPosBoth(next.pos);
      if (next.ended) { setPlaying(false); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStill, playing, beat?.id, beat?.inSec, beat?.outSec]);

  // 3. Calculations for active beat & overlay
  const beatIndex = beat ? cut.beats.indexOf(beat) : -1;
  const beatStartSec = (beat && beatIndex >= 0) ? cut.beats.slice(0, beatIndex).reduce((sum, b) => sum + b.durationSec, 0) : 0;
  const beatElapsed = beat ? pos * (beat.outSec - beat.inSec) : 0;
  const elapsedCutSec = beatStartSec + beatElapsed;
  const activeOverlay = cut?.overlays?.find((o) => elapsedCutSec >= o.startTimeSec && elapsedCutSec < o.startTimeSec + o.durationSec) ?? null;
  const activeOverlayClip = activeOverlay ? clips.find((c) => c.id === activeOverlay.clipId) : null;
  const overlayBlobUrl = getClipBlobUrl(activeOverlayClip?.normalized ?? activeOverlayClip?.file);

  // 5. Active overlay sync effect
  useEffect(() => {
    const el = overlayVideoRef.current;
    if (!el || !activeOverlay) return;
    const targetTime = (elapsedCutSec - activeOverlay.startTimeSec) + activeOverlay.inSec;
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
  }, [elapsedCutSec, activeOverlay, playing]);

  function togglePlay() {
    if (!beat) return;
    if (isStill) {
      if (playing) { setPlaying(false); return; }
      if (pos >= 0.999) setPosBoth(0); // replay from the top
      setPlaying(true);
      return;
    }
    const v = videoRef.current;
    if (!v) return;
    if (playing) { v.pause(); setPlaying(false); return; }
    if (v.currentTime < beat.inSec || v.currentTime >= beat.outSec - 0.05) {
      v.currentTime = beat.inSec;
      setPosBoth(0);
    }
    v.play().then(() => setPlaying(true)).catch(() => {});
  }

  function handleScrubPointer(e: React.PointerEvent<HTMLDivElement>) {
    const el = scrubRef.current;
    if (!beat || !el) return;
    const rect = el.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    if (playing) setPlaying(false);
    if (isStill) { setPosBoth(pct); return; } // no frame to seek to — the position IS the state
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    v.currentTime = beat.inSec + pct * (beat.outSec - beat.inSec);
    setPosBoth(pct);
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
    if (!beat) return;
    const frameTime = 1 / 30; // ~33.3ms 30fps frame stepping
    const span = Math.max(0.01, beat.outSec - beat.inSec);
    if (isStill) {
      // Every frame of a Still is the same frame; stepping still moves the
      // playhead so the scrubber, Stickers and Title overlays track with it.
      if (playing) setPlaying(false);
      setPosBoth(Math.max(0, Math.min(1, pos + (frames * frameTime) / span)));
      return;
    }
    const v = videoRef.current;
    if (!v) return;
    if (playing) {
      v.pause();
      setPlaying(false);
    }
    const newTime = Math.max(beat.inSec, Math.min(beat.outSec, v.currentTime + frames * frameTime));
    v.currentTime = newTime;
    setPosBoth((newTime - beat.inSec) / span);
  }

  function onTimeUpdate() {
    const v = videoRef.current;
    if (!v || !beat) return;
    const span = Math.max(0.01, beat.outSec - beat.inSec);
    const newPos = Math.min(1, Math.max(0, (v.currentTime - beat.inSec) / span));
    setPosBoth(newPos);
    if (playing && v.currentTime >= beat.outSec - 0.02) {
      v.pause();
      v.currentTime = beat.outSec;
      setPosBoth(1);
      setPlaying(false);
    }
  }

  if (mode === "cut") {
    return (
      <PreviewErrorBoundary
        fallback={(reset) => (
          <>
            <div style={{ borderRadius: 12, overflow: "hidden", padding: 24, textAlign: "center", background: "#000", color: "#fff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 280 }}>
              <h3 style={{ margin: "0 0 8px 0", fontSize: 15, color: "var(--accent)" }}>🎞️ Cut Preview</h3>
              <p style={{ fontSize: 12, opacity: 0.8, maxWidth: 360, margin: "0 0 16px 0" }}>Switched back to single Beat preview mode.</p>
              <button
                className="st-btn ghost"
                onClick={() => { reset(); setMode("beat"); }}
                style={{ borderColor: "var(--accent)", color: "var(--accent)", fontSize: 11, padding: "4px 12px" }}
              >
                Return to Beat View
              </button>
            </div>
            <div className="st-transport">
              <span className="st-tc">Cut view</span>
              <span className="st-spacer" />
              <ModeSwitch mode={mode} setMode={setMode} />
            </div>
          </>
        )}
      >
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
      </PreviewErrorBoundary>
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

  const aspectRatio = cut.aspect === "9:16" ? "9 / 16" : cut.aspect === "1:1" ? "1 / 1" : "16 / 9";
  // Captions now come from the VO track by absolute cut time (decoupled from beats).
  const caption = activeVoCaption(cut.voSegments, elapsedCutSec);
  const isAtEnd = !playing && pos >= 0.98;

  return (
    <>
      <div className="st-preview" style={{ aspectRatio, cursor: "pointer", position: "relative" }} onClick={togglePlay} title={playing ? "Pause" : isAtEnd ? "Replay beat" : "Play beat"}>
        {/* Zoom and rotation are separate layers with separate pivots: zoom
            outside on the focus point, rotation inside on the centre. Nested
            transforms apply child-first, which matches the export's
            rotate-then-zoom order. */}
        <div style={{ position: "absolute", inset: 0, ...beatZoomStyle(beat.zoom, beat.zoomX, beat.zoomY, isBeatZoomActive(beat.zoom, beat.zoomScope, beat.zoomSec, beatElapsed)) }}>
          <div style={{ position: "absolute", inset: 0, ...beatRotationStyle(...canvasDims(cut.aspect), beat.rotation) }}>
            {isStill ? (
              // Same wrappers, same grade — only the element differs (ADR-0012).
              <img src={stillUrl ?? undefined} alt="" style={{ width: "100%", height: "100%", objectFit: "contain", filter: cssFilterFor(beat.colorAdjustments, cut.globalFilterId, cut.globalFilterIntensity, cut.globalFilterAdjustments) }} />
            ) : (
              <video ref={videoRef} onTimeUpdate={onTimeUpdate} muted={(beat.volume ?? 1) === 0} playsInline style={{ width: "100%", height: "100%", objectFit: "contain", filter: cssFilterFor(beat.colorAdjustments, cut.globalFilterId, cut.globalFilterIntensity, cut.globalFilterAdjustments) }} />
            )}
          </div>
        </div>
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
        <StickerOverlay stickers={cut.stickers} beats={cut.beats} aspect={cut.aspect} cutSec={elapsedCutSec} />
        <BeatTitleOverlay layers={beat.titleLayers} aspect={cut.aspect} elapsed={beatElapsed} />
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
