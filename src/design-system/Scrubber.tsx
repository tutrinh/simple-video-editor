import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import PlayButton from "./PlayButton";

interface ScrubberProps {
  duration?: number;
  initialIn?: number;
  initialOut?: number;
}

type Handle = "in" | "out";

export default function Scrubber({
  duration = 18,
  initialIn = 2,
  initialOut = 16,
}: ScrubberProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [inPoint, setInPoint] = useState(initialIn);
  const [outPoint, setOutPoint] = useState(initialOut);
  const [dragging, setDragging] = useState<Handle | null>(null);

  const inPercent = (inPoint / duration) * 100;
  const outPercent = (outPoint / duration) * 100;

  function updateHandle(handle: Handle, next: number) {
    const clamped = Math.max(0, Math.min(duration, next));
    if (handle === "in") setInPoint(Math.min(clamped, outPoint - 0.1));
    else setOutPoint(Math.max(clamped, inPoint + 0.1));
  }

  function timeAt(clientX: number) {
    const bounds = trackRef.current?.getBoundingClientRect();
    if (!bounds) return 0;
    return ((clientX - bounds.left) / bounds.width) * duration;
  }

  function startDrag(handle: Handle, event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(handle);
  }

  function moveDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    updateHandle(dragging, timeAt(event.clientX));
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(null);
  }

  function nudge(handle: Handle, direction: -1 | 1) {
    updateHandle(handle, (handle === "in" ? inPoint : outPoint) + direction * 0.1);
  }

  return (
    <div className="ds-scrubber">
      <div className="ds-scrubber-transport">
        <PlayButton label="selected range" />
        <div
          ref={trackRef}
          className={`ds-scrubber-track${dragging ? " dragging" : ""}`}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <div
            className="ds-scrubber-selection"
            style={{ left: `${inPercent}%`, width: `${outPercent - inPercent}%` }}
          />
          {(["in", "out"] as const).map((handle) => {
            const value = handle === "in" ? inPoint : outPoint;
            const percent = handle === "in" ? inPercent : outPercent;
            return (
              <button
                key={handle}
                type="button"
                className={`ds-scrubber-handle ${handle}`}
                style={{ left: `${percent}%` }}
                aria-label={`${handle === "in" ? "In" : "Out"} point`}
                aria-valuemin={0}
                aria-valuemax={duration}
                aria-valuenow={Number(value.toFixed(1))}
                role="slider"
                onPointerDown={(event) => startDrag(handle, event)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowLeft") {
                    event.preventDefault();
                    nudge(handle, -1);
                  }
                  if (event.key === "ArrowRight") {
                    event.preventDefault();
                    nudge(handle, 1);
                  }
                }}
              />
            );
          })}
        </div>
        <code className="ds-scrubber-time">{duration.toFixed(1)}s</code>
      </div>
      <div className="ds-scrubber-readout">
        <span>In <code>{inPoint.toFixed(1)}s</code></span>
        <span>Out <code>{outPoint.toFixed(1)}s</code></span>
        <strong><code>{(outPoint - inPoint).toFixed(1)}s</code> selected</strong>
      </div>
    </div>
  );
}
