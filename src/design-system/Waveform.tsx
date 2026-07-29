import { useRef, type PointerEvent as ReactPointerEvent } from "react";

export type WaveformTone = "safe" | "warning" | "danger";

export interface WaveformBar {
  amplitude: number;
  tone: WaveformTone;
}

interface Props {
  bars: readonly WaveformBar[];
  variant: "timeline" | "inspector";
  ariaLabel: string;
  playheadPct?: number;
  trim?: {
    startPct: number;
    endPct: number;
    minSpanPct: number;
    onChange: (startPct: number, endPct: number) => void;
    onSeek: (pct: number) => void;
    onReset: (edge: "in" | "out") => void;
  };
}

/** Visual-only waveform primitive. Audio decoding and gain semantics stay with the caller. */
export default function Waveform({ bars, variant, ariaLabel, playheadPct = 0, trim }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const draggingEdgeRef = useRef<"in" | "out" | null>(null);

  function pointerPct(event: ReactPointerEvent): number {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return 0;
    return Math.min(100, Math.max(0, ((event.clientX - rect.left) / rect.width) * 100));
  }

  function moveHandle(event: ReactPointerEvent<HTMLButtonElement>, edge: "in" | "out") {
    if (!trim || draggingEdgeRef.current !== edge) return;
    const pct = pointerPct(event);
    if (edge === "in") trim.onChange(Math.min(pct, trim.endPct - trim.minSpanPct), trim.endPct);
    else trim.onChange(trim.startPct, Math.max(pct, trim.startPct + trim.minSpanPct));
  }

  function nudgeHandle(edge: "in" | "out", direction: -1 | 1) {
    if (!trim) return;
    if (edge === "in") {
      trim.onChange(
        Math.max(0, Math.min(trim.endPct - trim.minSpanPct, trim.startPct + direction)),
        trim.endPct,
      );
    } else {
      trim.onChange(
        trim.startPct,
        Math.min(100, Math.max(trim.startPct + trim.minSpanPct, trim.endPct + direction)),
      );
    }
  }

  return (
    <div
      ref={rootRef}
      className={`st-user-vo-waveform ${variant}`}
      role={trim ? "group" : "img"}
      aria-label={ariaLabel}
      onPointerDown={(event) => {
        if (!trim || (event.target as Element).closest("[data-waveform-trim-handle]")) return;
        trim.onSeek(pointerPct(event));
      }}
    >
      <svg viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">
        <line className="st-user-vo-waveform-center" x1="0" x2="100" y1="16" y2="16" />
        {bars.map((bar, index) => {
          const height = Math.max(1.5, Math.min(29, bar.amplitude * 29));
          const x = ((index + 0.5) / bars.length) * 100;
          return (
            <rect
              key={index}
              className={`st-user-vo-waveform-bar ${bar.tone}`}
              x={x}
              y={16 - height / 2}
              width={Math.max(0.28, 58 / bars.length)}
              height={height}
              rx={0.25}
            />
          );
        })}
      </svg>
      {variant === "inspector" && (
        <span className="st-user-vo-waveform-playhead" style={{ left: `${playheadPct}%` }} aria-hidden="true" />
      )}
      {trim && (
        <>
          <span className="st-user-vo-waveform-dim left" style={{ width: `${trim.startPct}%` }} aria-hidden="true" />
          <span className="st-user-vo-waveform-dim right" style={{ left: `${trim.endPct}%` }} aria-hidden="true" />
          <span
            className="st-user-vo-waveform-selection"
            style={{ left: `${trim.startPct}%`, width: `${trim.endPct - trim.startPct}%` }}
            aria-hidden="true"
          />
          <button
            type="button"
            data-waveform-trim-handle
            className="st-user-vo-waveform-handle in"
            style={{ left: `${trim.startPct}%` }}
            aria-label="User VO trim in"
            aria-valuemin={0}
            aria-valuemax={trim.endPct}
            aria-valuenow={trim.startPct}
            title="Drag to set the source In point; double-click to reset"
            onPointerDown={(event) => {
              event.stopPropagation();
              event.currentTarget.setPointerCapture(event.pointerId);
              draggingEdgeRef.current = "in";
            }}
            onPointerMove={(event) => moveHandle(event, "in")}
            onPointerUp={(event) => {
              try { event.currentTarget.releasePointerCapture(event.pointerId); } catch {}
              draggingEdgeRef.current = null;
            }}
            onDoubleClick={() => trim.onReset("in")}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault();
                nudgeHandle("in", event.key === "ArrowLeft" ? -1 : 1);
              }
            }}
          />
          <button
            type="button"
            data-waveform-trim-handle
            className="st-user-vo-waveform-handle out"
            style={{ left: `${trim.endPct}%` }}
            aria-label="User VO trim out"
            aria-valuemin={trim.startPct}
            aria-valuemax={100}
            aria-valuenow={trim.endPct}
            title="Drag to set the source Out point; double-click to reset"
            onPointerDown={(event) => {
              event.stopPropagation();
              event.currentTarget.setPointerCapture(event.pointerId);
              draggingEdgeRef.current = "out";
            }}
            onPointerMove={(event) => moveHandle(event, "out")}
            onPointerUp={(event) => {
              try { event.currentTarget.releasePointerCapture(event.pointerId); } catch {}
              draggingEdgeRef.current = null;
            }}
            onDoubleClick={() => trim.onReset("out")}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault();
                nudgeHandle("out", event.key === "ArrowLeft" ? -1 : 1);
              }
            }}
          />
        </>
      )}
    </div>
  );
}
