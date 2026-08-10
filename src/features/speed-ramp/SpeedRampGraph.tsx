import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import type { SpeedRamp } from "../../domain/types";
import { PROJECT_FPS } from "../../domain/types";
import { nearestSpeedRampStepIndex, rampDurationSec, SPEED_RAMP_STEPS, speedAtRampProgress } from "../../domain/speedRamp";

type Ramp = Required<SpeedRamp>;
type Handle = "start" | "middle" | "end";

interface Props {
  ramp: Ramp;
  compact?: boolean;
  interactive?: boolean;
  onChange?: (ramp: Ramp) => void;
  durationSec?: number;
  sourceWindowSec?: number;
  playheadProgress?: number;
}

interface BandProps {
  ramp: Ramp;
  durationSec: number;
  sourceWindowSec?: number;
  playheadProgress?: number;
  interactive?: boolean;
  compact?: boolean;
  onChange?: (ramp: Ramp) => void;
}

const W = 320;
const MIN_SPEED = 0.5;
const MAX_SPEED = 4;

export function rampFrameAtProgress(progress: number, durationSec: number, fps = PROJECT_FPS): number {
  const totalFrames = Math.max(1, Math.round(Math.max(0, durationSec) * fps));
  return Math.min(totalFrames, Math.max(0, Math.round(progress * totalFrames)));
}

export function rampProgressAtFrame(frame: number, durationSec: number, fps = PROJECT_FPS): number {
  const totalFrames = Math.max(1, Math.round(Math.max(0, durationSec) * fps));
  return Math.min(1, Math.max(0, Math.round(frame) / totalFrames));
}

export function snapRampProgressToFrame(progress: number, durationSec: number, fps = PROJECT_FPS): number {
  return rampProgressAtFrame(rampFrameAtProgress(progress, durationSec, fps), durationSec, fps);
}

export function formatRampFrame(progress: number, durationSec: number, fps = PROJECT_FPS): string {
  const frame = rampFrameAtProgress(progress, durationSec, fps);
  const seconds = Math.floor(frame / fps);
  const frames = frame % fps;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}:${String(frames).padStart(2, "0")} · F${frame}`;
}

export function rampBoundaryAtTargetFrame(
  ramp: Ramp,
  boundary: "firstPoint" | "secondPoint",
  targetFrame: number,
  sourceWindowSec: number,
  fps = PROJECT_FPS,
): number {
  const min = boundary === "firstPoint" ? 0.1 : ramp.firstPoint + 0.1;
  const max = boundary === "firstPoint" ? ramp.secondPoint - 0.1 : 0.9;
  let best = min;
  let bestError = Number.POSITIVE_INFINITY;
  // The boundary changes the curve's average speed and therefore its duration.
  // Search the small valid interval so the resulting boundary—not the old
  // percentage—lands on the requested timeline frame.
  for (let i = 0; i <= 4000; i++) {
    const candidate = min + (max - min) * i / 4000;
    const candidateRamp = { ...ramp, [boundary]: candidate };
    const duration = rampDurationSec(sourceWindowSec, candidateRamp);
    const error = Math.abs(candidate * duration * fps - targetFrame);
    if (error < bestError) {
      best = candidate;
      bestError = error;
    }
  }
  return best;
}

function speedY(speed: number, height: number, pad: number): number {
  const usable = height - pad * 2;
  const normalized = (Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed)) - MIN_SPEED) / (MAX_SPEED - MIN_SPEED);
  return height - pad - normalized * usable;
}

function nearestOfferedSpeed(y: number, height: number, pad: number): number {
  const normalized = Math.min(1, Math.max(0, (height - pad - y) / (height - pad * 2)));
  const raw = MIN_SPEED + normalized * (MAX_SPEED - MIN_SPEED);
  return SPEED_RAMP_STEPS[nearestSpeedRampStepIndex(raw)];
}

function continuousSpeedAtY(y: number, height: number, pad: number): number {
  const normalized = Math.min(1, Math.max(0, (height - pad - y) / (height - pad * 2)));
  return MIN_SPEED + normalized * (MAX_SPEED - MIN_SPEED);
}

export function speedRampGraphPoints(ramp: Ramp, height = 128, pad = 14) {
  const innerW = W - pad * 2;
  const x = (progress: number) => pad + progress * innerW;
  const middleX = x((ramp.firstPoint + ramp.secondPoint) / 2);
  return {
    start: { x: x(0), y: speedY(ramp.startSpeed, height, pad) },
    kneeIn: { x: x(ramp.firstPoint), y: speedY(ramp.middleSpeed, height, pad) },
    middle: { x: middleX, y: speedY(ramp.middleSpeed, height, pad) },
    kneeOut: { x: x(ramp.secondPoint), y: speedY(ramp.middleSpeed, height, pad) },
    end: { x: x(1), y: speedY(ramp.endSpeed, height, pad) },
  };
}

export function SpeedRampBand({ ramp, durationSec, sourceWindowSec, playheadProgress, interactive = false, compact = false, onChange }: BandProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  const updateBoundary = (boundary: "firstPoint" | "secondPoint", event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!interactive || !onChange || !rootRef.current) return;
    const rect = rootRef.current.getBoundingClientRect();
    const progress = Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width)));
    const targetFrame = rampFrameAtProgress(progress, durationSec);
    const snapped = snapRampProgressToFrame(progress, durationSec);
    const value = sourceWindowSec == null
      ? boundary === "firstPoint"
        ? Math.min(ramp.secondPoint - 0.1, Math.max(0.1, snapped))
        : Math.min(0.9, Math.max(ramp.firstPoint + 0.1, snapped))
      : rampBoundaryAtTargetFrame(ramp, boundary, targetFrame, sourceWindowSec);
    onChange({ ...ramp, [boundary]: value, preset: "custom" });
  };

  const boundaryHandle = (boundary: "firstPoint" | "secondPoint", progress: number, label: string) => (
    <button
      type="button"
      className={`st-speed-ramp-band-handle ${boundary}`}
      style={{ left: `${progress * 100}%` }}
      aria-label={label}
      disabled={!interactive}
      onPointerDown={(event) => {
        if (!interactive) return;
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        updateBoundary(boundary, event);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) updateBoundary(boundary, event);
      }}
      title={`${label} · ${formatRampFrame(progress, durationSec)}`}
    />
  );

  return (
    <div ref={rootRef} className={`st-speed-ramp-band${compact ? " compact" : ""}${interactive ? " interactive" : ""}`}>
      <div className="before" style={{ width: `${ramp.firstPoint * 100}%` }}><span>BEFORE</span><strong>{ramp.startSpeed}×</strong></div>
      <div className="focus" style={{ width: `${(ramp.secondPoint - ramp.firstPoint) * 100}%` }}><span>FOCUS</span><strong>{ramp.middleSpeed}×</strong></div>
      <div className="after" style={{ width: `${(1 - ramp.secondPoint) * 100}%` }}><span>AFTER</span><strong>{ramp.endSpeed}×</strong></div>
      {boundaryHandle("firstPoint", ramp.firstPoint, "Move start of focus speed")}
      {boundaryHandle("secondPoint", ramp.secondPoint, "Move end of focus speed")}
      {playheadProgress != null && <span className="st-speed-ramp-band-playhead" style={{ left: `${Math.min(1, Math.max(0, playheadProgress)) * 100}%` }} />}
    </div>
  );
}

export default function SpeedRampGraph({ ramp, compact = false, interactive = false, onChange, durationSec, sourceWindowSec, playheadProgress }: Props) {
  const height = compact ? 52 : 128;
  const pad = compact ? 4 : 14;
  const svgRef = useRef<SVGSVGElement>(null);
  const points = speedRampGraphPoints(ramp, height, pad);
  const sampleCount = compact ? 25 : 49;
  const samples = Array.from({ length: sampleCount }, (_, index) => {
    const progress = index / (sampleCount - 1);
    return {
      x: pad + progress * (W - pad * 2),
      y: speedY(speedAtRampProgress(ramp, progress), height, pad),
    };
  });
  const line = samples
    .map((point) => `${point.x},${point.y}`)
    .join(" ");
  const area = `${points.start.x},${height - pad} ${line} ${points.end.x},${height - pad}`;

  const updateFromPointer = (handle: Handle, event: ReactPointerEvent<SVGCircleElement>) => {
    if (!interactive || !onChange || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const svgX = (event.clientX - rect.left) / rect.width * W;
    const svgY = (event.clientY - rect.top) / rect.height * height;
    const speed = nearestOfferedSpeed(svgY, height, pad);
    const next: Ramp = { ...ramp, preset: "custom" };
    if (handle === "start") next.startSpeed = speed;
    if (handle === "middle") {
      next.middleSpeed = speed;
      const halfPlateau = (ramp.secondPoint - ramp.firstPoint) / 2;
      const rawCenter = Math.min(0.85 - halfPlateau, Math.max(0.15 + halfPlateau, (svgX - pad) / (W - pad * 2)));
      const center = durationSec ? snapRampProgressToFrame(rawCenter, durationSec) : rawCenter;
      next.firstPoint = durationSec ? snapRampProgressToFrame(center - halfPlateau, durationSec) : center - halfPlateau;
      next.secondPoint = durationSec ? snapRampProgressToFrame(center + halfPlateau, durationSec) : center + halfPlateau;
    }
    if (handle === "end") next.endSpeed = speed;
    onChange(next);
  };

  const handlePointerDown = (handle: Handle) => (event: ReactPointerEvent<SVGCircleElement>) => {
    if (!interactive) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    updateFromPointer(handle, event);
  };

  const renderHandle = (handle: Handle, point: { x: number; y: number }, speed: number) => (
    <g className={`st-speed-ramp-handle ${handle}`}>
      <circle
        cx={point.x}
        cy={point.y}
        r={compact ? 2.5 : 6}
        tabIndex={interactive ? 0 : undefined}
        role={interactive ? "slider" : undefined}
        aria-label={interactive ? `${handle} speed` : undefined}
        aria-valuemin={interactive ? MIN_SPEED : undefined}
        aria-valuemax={interactive ? MAX_SPEED : undefined}
        aria-valuenow={interactive ? speed : undefined}
        onPointerDown={handlePointerDown(handle)}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) updateFromPointer(handle, event);
        }}
      />
      {!compact && <text x={point.x} y={Math.max(9, point.y - 10)} textAnchor="middle">{speed}×</text>}
    </g>
  );

  const curveControls = {
    first: {
      x: points.start.x + (points.kneeIn.x - points.start.x) * ramp.curveInX,
      y: speedY(ramp.startSpeed + (ramp.middleSpeed - ramp.startSpeed) * ramp.curveIn, height, pad),
    },
    second: {
      x: points.start.x + (points.kneeIn.x - points.start.x) * ramp.curveOutX,
      y: speedY(ramp.startSpeed + (ramp.middleSpeed - ramp.startSpeed) * ramp.curveOut, height, pad),
    },
  };

  const updateCurveControl = (key: "curveIn" | "curveOut", event: ReactPointerEvent<SVGCircleElement>) => {
    if (!interactive || !onChange || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const svgX = (event.clientX - rect.left) / rect.width * W;
    const svgY = (event.clientY - rect.top) / rect.height * height;
    const speed = continuousSpeedAtY(svgY, height, pad);
    const delta = ramp.middleSpeed - ramp.startSpeed;
    const value = Math.abs(delta) < 1e-6 ? 0.5 : (speed - ramp.startSpeed) / delta;
    const rawX = (svgX - points.start.x) / Math.max(1, points.kneeIn.x - points.start.x);
    const xKey = key === "curveIn" ? "curveInX" : "curveOutX";
    const xValue = key === "curveIn"
      ? Math.min(ramp.curveOutX, Math.max(0, rawX))
      : Math.min(1, Math.max(ramp.curveInX, rawX));
    onChange({
      ...ramp,
      [key]: Math.min(2, Math.max(0, value)),
      [xKey]: xValue,
      curve: "custom",
      preset: "custom",
    });
  };

  const renderCurveControl = (key: "curveIn" | "curveOut", point: { x: number; y: number }) => (
    <circle
      className="curve-control"
      cx={point.x}
      cy={point.y}
      r={5}
      role="slider"
      tabIndex={0}
      aria-label={key === "curveIn" ? "Bézier control one" : "Bézier control two"}
      aria-valuemin={0}
      aria-valuemax={2}
      aria-valuenow={ramp[key]}
      onPointerDown={(event) => {
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        updateCurveControl(key, event);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) updateCurveControl(key, event);
      }}
    />
  );

  const setBoundaryAtPlayhead = (boundary: "firstPoint" | "secondPoint") => {
    if (!onChange || durationSec == null || playheadProgress == null) return;
    const targetFrame = rampFrameAtProgress(playheadProgress, durationSec);
    const snapped = snapRampProgressToFrame(playheadProgress, durationSec);
    const value = sourceWindowSec == null
      ? boundary === "firstPoint"
        ? Math.min(ramp.secondPoint - 0.1, Math.max(0.1, snapped))
        : Math.min(0.9, Math.max(ramp.firstPoint + 0.1, snapped))
      : rampBoundaryAtTargetFrame(ramp, boundary, targetFrame, sourceWindowSec);
    onChange({ ...ramp, [boundary]: value, preset: "custom" });
  };

  const playheadX = playheadProgress == null
    ? null
    : pad + Math.min(1, Math.max(0, playheadProgress)) * (W - pad * 2);

  return (
    <div className={`st-speed-ramp-graph${compact ? " compact" : ""}${interactive ? " interactive" : ""}`}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" aria-label={interactive ? "Speed ramp curve" : undefined}>
        {!compact && (
          <>
            {[0.5, 1, 2, 3, 4].map((speed) => (
              <line key={speed} className={speed === 1 ? "baseline" : "grid"} x1={pad} x2={W - pad} y1={speedY(speed, height, pad)} y2={speedY(speed, height, pad)} />
            ))}
          </>
        )}
        <polygon className="area" points={area} />
        <polyline className="curve" points={line} />
        {!compact && interactive && ramp.curve === "custom" && (
          <>
            <line className="curve-guide" x1={points.start.x} y1={points.start.y} x2={curveControls.first.x} y2={curveControls.first.y} />
            <line className="curve-guide" x1={points.kneeIn.x} y1={points.kneeIn.y} x2={curveControls.second.x} y2={curveControls.second.y} />
            {renderCurveControl("curveIn", curveControls.first)}
            {renderCurveControl("curveOut", curveControls.second)}
          </>
        )}
        {!compact && playheadX != null && (
          <>
            <line className="playhead" x1={playheadX} x2={playheadX} y1={pad} y2={height - pad} />
            <circle className="playhead-dot" cx={playheadX} cy={height - pad} r={3} />
          </>
        )}
        {renderHandle("start", points.start, ramp.startSpeed)}
        {renderHandle("middle", points.middle, ramp.middleSpeed)}
        {renderHandle("end", points.end, ramp.endSpeed)}
      </svg>
      {!compact && durationSec != null && playheadProgress != null && (
        <div className="st-speed-ramp-playhead-readout">PLAYHEAD&nbsp; {formatRampFrame(playheadProgress, durationSec)}</div>
      )}
      {!compact && <div className="st-speed-ramp-axis"><span>START</span><span>MIDDLE</span><span>END</span></div>}
      {!compact && durationSec != null && (
        <div className="st-speed-ramp-frame-controls">
          <div>
            <span>Reaches middle</span>
            <output>{formatRampFrame(ramp.firstPoint, durationSec)}</output>
            <button type="button" onClick={() => setBoundaryAtPlayhead("firstPoint")} disabled={playheadProgress == null} aria-label="Set ramp-in at current frame">Set here</button>
          </div>
          <div>
            <span>Leaves middle</span>
            <output>{formatRampFrame(ramp.secondPoint, durationSec)}</output>
            <button type="button" onClick={() => setBoundaryAtPlayhead("secondPoint")} disabled={playheadProgress == null} aria-label="Set ramp-out at current frame">Set here</button>
          </div>
        </div>
      )}
    </div>
  );
}
