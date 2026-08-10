import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import type { OverlayClip } from "../../domain/types";
import { overlayVisual } from "../../domain/overlayClip";
import { cssFilterFor } from "../../studio/util";

interface Props {
  overlay: OverlayClip;
  src: string;
  elapsedSec: number;
  playing: boolean;
  muted: boolean;
  editable?: boolean;
  selected?: boolean;
  zIndex?: number;
  onSelect?: () => void;
  onChange?: (overlay: OverlayClip) => void;
}

type DragState =
  | { mode: "move"; startX: number; startY: number; x: number; y: number }
  | { mode: "resize"; startX: number; startY: number; left: number; top: number; width: number; height: number };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Shared HTML-video compositor used by both the editor and final preview. */
export default function OverlayVideoLayer({
  overlay,
  src,
  elapsedSec,
  playing,
  muted,
  editable = false,
  selected = false,
  zIndex = 5,
  onSelect,
  onChange,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const visual = overlayVisual(overlay);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const targetTime = Math.max(0, elapsedSec - overlay.startTimeSec) + overlay.inSec;
    if (Math.abs(video.currentTime - targetTime) > 0.15) {
      try { video.currentTime = targetTime; } catch {}
    }
    const volume = overlay.volume ?? 0;
    video.volume = muted ? 0 : volume;
    video.muted = muted || volume === 0;
    if (playing && video.paused) void video.play().catch(() => {});
    else if (!playing && !video.paused) video.pause();
  }, [elapsedSec, muted, overlay.inSec, overlay.startTimeSec, overlay.volume, playing]);

  const updateMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const frame = wrapperRef.current?.parentElement;
    if (!drag || drag.mode !== "move" || !frame || !onChange) return;
    const rect = frame.getBoundingClientRect();
    const x = clamp(drag.x + (event.clientX - drag.startX) / Math.max(1, rect.width), visual.width / 2, 1 - visual.width / 2);
    const y = clamp(drag.y + (event.clientY - drag.startY) / Math.max(1, rect.height), visual.height / 2, 1 - visual.height / 2);
    onChange({ ...overlay, layoutMode: "pip", x, y, width: visual.width, height: visual.height });
  };

  const updateResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    const frame = wrapperRef.current?.parentElement;
    if (!drag || drag.mode !== "resize" || !frame || !onChange) return;
    const rect = frame.getBoundingClientRect();
    const width = clamp(drag.width + (event.clientX - drag.startX) / Math.max(1, rect.width), 0.1, 1 - drag.left);
    const height = clamp(drag.height + (event.clientY - drag.startY) / Math.max(1, rect.height), 0.1, 1 - drag.top);
    onChange({
      ...overlay,
      layoutMode: "pip",
      width,
      height,
      x: drag.left + width / 2,
      y: drag.top + height / 2,
    });
  };

  const pipStyle = visual.layoutMode === "pip"
    ? {
        left: `${(visual.x - visual.width / 2) * 100}%`,
        top: `${(visual.y - visual.height / 2) * 100}%`,
        width: `${visual.width * 100}%`,
        height: `${visual.height * 100}%`,
        borderRadius: `${visual.cornerRadius * 100}%`,
      }
    : { inset: 0 };

  return (
    <div
      ref={wrapperRef}
      className={`st-video-overlay-layer ${visual.layoutMode}${selected ? " selected" : ""}${editable ? " editable" : ""}`}
      style={{ ...pipStyle, zIndex }}
      data-overlay-id={overlay.id}
      onPointerDown={(event) => {
        event.stopPropagation();
        onSelect?.();
        if (!editable || visual.layoutMode !== "pip") return;
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = { mode: "move", startX: event.clientX, startY: event.clientY, x: visual.x, y: visual.y };
      }}
      onPointerMove={(event) => {
        if (dragRef.current?.mode === "move") updateMove(event);
      }}
      onPointerUp={(event) => {
        try { event.currentTarget.releasePointerCapture(event.pointerId); } catch {}
        dragRef.current = null;
      }}
    >
      <video
        ref={videoRef}
        src={src}
        muted={muted || (overlay.volume ?? 0) === 0}
        loop={Boolean(overlay.fitToBeat)}
        playsInline
        draggable={false}
        style={{
          width: "100%",
          height: "100%",
          objectFit: visual.fit,
          opacity: overlay.opacity,
          mixBlendMode: overlay.blendMode,
          filter: cssFilterFor(overlay.colorAdjustments),
        }}
      />
      {editable && selected && visual.layoutMode === "pip" && (
        <>
          <span className="st-video-overlay-label">VIDEO OVERLAY</span>
          <button
            type="button"
            className="st-video-overlay-resize"
            aria-label="Resize video overlay"
            onPointerDown={(event) => {
              event.stopPropagation();
              event.currentTarget.setPointerCapture(event.pointerId);
              dragRef.current = {
                mode: "resize",
                startX: event.clientX,
                startY: event.clientY,
                left: visual.x - visual.width / 2,
                top: visual.y - visual.height / 2,
                width: visual.width,
                height: visual.height,
              };
            }}
            onPointerMove={(event) => {
              if (dragRef.current?.mode === "resize") updateResize(event);
            }}
            onPointerUp={(event) => {
              try { event.currentTarget.releasePointerCapture(event.pointerId); } catch {}
              dragRef.current = null;
            }}
          />
        </>
      )}
    </div>
  );
}
