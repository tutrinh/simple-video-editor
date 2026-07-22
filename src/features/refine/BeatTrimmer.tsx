import { useEffect, useRef, useState } from "react";
import type { Beat, Clip } from "../../domain/types";

// Drag-to-trim: a timeline with in/out handles over a scrub video. Dragging a
// handle seeks the video to that frame (live preview) and, on release, commits
// the window via onChange. Used by the Studio Inspector as the visual trim
// control; styled for the dark workspace theme.
const MIN_GAP = 0.1;

interface Props {
  beat: Beat;
  clip: Clip;
  onChange: (inSec: number, outSec: number) => void;
  /** Compact = draggable track only (no video/preview). Always-visible inline control. */
  compact?: boolean;
}

export default function BeatTrimmer({ beat, clip, onChange, compact = false }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const dur = clip.durationSec || Math.max(beat.outSec, 1);

  const [inSec, setInSec] = useState(beat.inSec);
  const [outSec, setOutSec] = useState(beat.outSec);
  const [drag, setDrag] = useState<null | "in" | "out">(null);
  const [playing, setPlaying] = useState(false);

  // Mirror external edits (numeric fields, clip swap) when not mid-drag.
  useEffect(() => {
    if (!drag) {
      setInSec(beat.inSec);
      setOutSec(beat.outSec);
    }
  }, [beat.inSec, beat.outSec, drag]);

  // Load the clip source. The object URL is created AND revoked here so its
  // lifetime matches the <video> src (StrictMode-safe). Reload only on clip change.
  useEffect(() => {
    if (compact) return; // no <video> in compact mode
    const v = videoRef.current;
    if (!v) return;
    const url = URL.createObjectURL(clip.normalized ?? clip.file);
    v.src = url;
    const onMeta = () => { v.currentTime = beat.inSec; };
    v.addEventListener("loadedmetadata", onMeta, { once: true });
    return () => {
      v.removeEventListener("loadedmetadata", onMeta);
      URL.revokeObjectURL(url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip.id, compact]);

  function seek(t: number) {
    const v = videoRef.current;
    if (v && Number.isFinite(t)) v.currentTime = t;
  }

  function timeFromX(clientX: number): number {
    const el = trackRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return frac * dur;
  }

  function startDrag(which: "in" | "out", e: React.PointerEvent) {
    e.preventDefault();
    setPlaying(false);
    videoRef.current?.pause();
    trackRef.current?.setPointerCapture(e.pointerId);
    setDrag(which);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drag) return;
    const t = timeFromX(e.clientX);
    if (drag === "in") {
      const next = Math.max(0, Math.min(t, outSec - MIN_GAP));
      setInSec(next);
      seek(next);
    } else {
      const next = Math.min(dur, Math.max(t, inSec + MIN_GAP));
      setOutSec(next);
      seek(next);
    }
  }

  function endDrag(e: React.PointerEvent) {
    if (!drag) return;
    trackRef.current?.releasePointerCapture?.(e.pointerId);
    setDrag(null);
    onChange(inSec, outSec);
  }

  // Play just the selected [in, out] range as a preview.
  function playRange() {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = inSec;
    v.play().then(() => setPlaying(true)).catch(() => {});
  }
  function onTimeUpdate() {
    const v = videoRef.current;
    if (!v) return;
    if (playing && v.currentTime >= outSec) {
      v.pause();
      v.currentTime = outSec;
      setPlaying(false);
    }
  }

  const inPct = (inSec / dur) * 100;
  const outPct = (outSec / dur) * 100;
  const handle = (side: "in" | "out"): React.CSSProperties => ({
    position: "absolute",
    top: -1,
    left: `${side === "in" ? inPct : outPct}%`,
    transform: "translateX(-50%)",
    width: 8,
    height: 16,
    borderRadius: 2,
    background: drag === side ? "#e0982a" : "var(--accent, #ffb339)",
    cursor: "ew-resize",
    touchAction: "none",
    boxShadow: "0 1px 3px rgba(0,0,0,0.5)",
  });

  return (
    <div style={{ marginTop: compact ? 2 : 8, width: "100%", maxWidth: 520 }}>
      {!compact && (
        <video
          ref={videoRef}
          onTimeUpdate={onTimeUpdate}
          muted
          playsInline
          style={{ width: "100%", aspectRatio: "16/9", background: "#000", borderRadius: 6, objectFit: "contain" }}
        />
      )}
      <div
        ref={trackRef}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{ position: "relative", height: 14, margin: compact ? "4px 0" : "10px 0 4px", background: "var(--panel-3, #22262e)", borderRadius: 4, boxShadow: "inset 0 0 0 1px var(--line, #282c34)", touchAction: "none" }}
      >
        {/* selected region */}
        <div style={{ position: "absolute", top: 0, bottom: 0, left: `${inPct}%`, width: `${outPct - inPct}%`, background: "rgba(255,179,57,0.20)", borderRadius: 4 }} />
        <div style={handle("in")} onPointerDown={(e) => startDrag("in", e)} title="Drag in-point" />
        <div style={handle("out")} onPointerDown={(e) => startDrag("out", e)} title="Drag out-point" />
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 12, color: "var(--ink-2, #9aa0ab)" }}>
        {!compact && <button onClick={playRange} disabled={playing}>▶ Play range</button>}
        <span>{inSec.toFixed(1)} – {outSec.toFixed(1)}s · {(outSec - inSec).toFixed(1)}s of {dur.toFixed(1)}s</span>
      </div>
    </div>
  );
}
