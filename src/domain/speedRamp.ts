import type { Beat, SpeedRamp } from "./types";
import { PROJECT_FPS } from "./types";

export const SPEED_RAMP_STEPS = [0.5, 0.75, 1, 1.5, 2, 3, 4] as const;

export function nearestSpeedRampStepIndex(speed: number): number {
  let best = 0;
  for (let i = 1; i < SPEED_RAMP_STEPS.length; i++) {
    if (Math.abs(SPEED_RAMP_STEPS[i] - speed) < Math.abs(SPEED_RAMP_STEPS[best] - speed)) best = i;
  }
  return best;
}

export const SPEED_RAMP_DEFAULT: Required<SpeedRamp> = {
  enabled: true,
  startSpeed: 1,
  middleSpeed: 2,
  endSpeed: 1,
  firstPoint: 0.4,
  secondPoint: 0.6,
  preset: "custom",
  curve: "linear",
  curveStrength: 1,
  curveIn: 0.25,
  curveOut: 0.75,
  curveInX: 1 / 3,
  curveOutX: 2 / 3,
  curveSharpness: 0,
};

export const SPEED_RAMP_PRESETS: ReadonlyArray<{
  value: Exclude<Required<SpeedRamp>["preset"], "custom">;
  label: string;
  ramp: Required<SpeedRamp>;
}> = [
  {
    value: "montage",
    label: "Montage",
    ramp: { ...SPEED_RAMP_DEFAULT, startSpeed: 1, middleSpeed: 3, endSpeed: 1, firstPoint: 0.25, secondPoint: 0.75, preset: "montage" },
  },
  {
    value: "impact",
    label: "Impact",
    ramp: { ...SPEED_RAMP_DEFAULT, startSpeed: 2, middleSpeed: 0.5, endSpeed: 1.5, firstPoint: 0.35, secondPoint: 0.65, preset: "impact" },
  },
  {
    value: "slow-reveal",
    label: "Slow reveal",
    ramp: { ...SPEED_RAMP_DEFAULT, startSpeed: 0.5, middleSpeed: 0.75, endSpeed: 1, firstPoint: 0.4, secondPoint: 0.7, preset: "slow-reveal" },
  },
];

const clampSpeed = (value: number | undefined, fallback: number) =>
  Number.isFinite(value) ? Math.min(4, Math.max(0.25, value!)) : fallback;

export function normalizeSpeedRamp(ramp?: SpeedRamp): Required<SpeedRamp> | null {
  if (!ramp || ramp.enabled === false) return null;
  const firstPoint = Math.min(0.8, Math.max(0.1, ramp.firstPoint ?? SPEED_RAMP_DEFAULT.firstPoint));
  const secondPoint = Math.min(0.9, Math.max(firstPoint + 0.1, ramp.secondPoint ?? SPEED_RAMP_DEFAULT.secondPoint));
  const preset = ramp.preset === "montage" || ramp.preset === "impact" || ramp.preset === "slow-reveal"
    ? ramp.preset
    : "custom";
  const curve = ramp.curve === "ease-in" || ramp.curve === "ease-out" || ramp.curve === "smooth" || ramp.curve === "custom" || ramp.curve === "instant"
    ? ramp.curve
    : "linear";
  const clampUnit = (value: number | undefined, fallback: number) => Number.isFinite(value)
    ? Math.min(1, Math.max(0, value!))
    : fallback;
  const clampCurveY = (value: number | undefined, fallback: number) => Number.isFinite(value)
    ? Math.min(2, Math.max(0, value!))
    : fallback;
  const curveInX = clampUnit(ramp.curveInX, SPEED_RAMP_DEFAULT.curveInX);
  const curveOutX = Math.max(curveInX, clampUnit(ramp.curveOutX, SPEED_RAMP_DEFAULT.curveOutX));
  return {
    enabled: true,
    startSpeed: clampSpeed(ramp.startSpeed, SPEED_RAMP_DEFAULT.startSpeed),
    middleSpeed: clampSpeed(ramp.middleSpeed, SPEED_RAMP_DEFAULT.middleSpeed),
    endSpeed: clampSpeed(ramp.endSpeed, SPEED_RAMP_DEFAULT.endSpeed),
    firstPoint,
    secondPoint,
    preset,
    curve,
    curveStrength: clampUnit(ramp.curveStrength, SPEED_RAMP_DEFAULT.curveStrength),
    curveIn: clampCurveY(ramp.curveIn, SPEED_RAMP_DEFAULT.curveIn),
    curveOut: clampCurveY(ramp.curveOut, SPEED_RAMP_DEFAULT.curveOut),
    curveInX,
    curveOutX,
    curveSharpness: clampUnit(ramp.curveSharpness, SPEED_RAMP_DEFAULT.curveSharpness),
  };
}

export function activeSpeedRamp(beat: Pick<Beat, "speedRamp">): Required<SpeedRamp> | null {
  return normalizeSpeedRamp(beat.speedRamp);
}

function cubicBezier(control1: number, control2: number, t: number): number {
  const inv = 1 - t;
  return 3 * inv * inv * t * control1 + 3 * inv * t * t * control2 + t ** 3;
}

function cubicBezierDerivative(control1: number, control2: number, t: number): number {
  const inv = 1 - t;
  return 3 * inv * inv * control1
    + 6 * inv * t * (control2 - control1)
    + 3 * t * t * (1 - control2);
}

function customBezierTAtX(ramp: Required<SpeedRamp>, x: number): number {
  let low = 0;
  let high = 1;
  for (let i = 0; i < 20; i++) {
    const mid = (low + high) / 2;
    if (cubicBezier(ramp.curveInX, ramp.curveOutX, mid) < x) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

export function speedRampEase(ramp: Required<SpeedRamp>, progress: number): number {
  const u = Math.min(1, Math.max(0, progress));
  if (u === 0 || u === 1) return u;
  if (ramp.curve === "instant") return 0;
  const strength = ramp.curveStrength;
  let shaped = u;
  if (ramp.curve === "ease-in") shaped = u ** 3;
  else if (ramp.curve === "ease-out") shaped = 1 - (1 - u) ** 3;
  else if (ramp.curve === "smooth") shaped = u * u * (3 - 2 * u);
  else if (ramp.curve === "custom") {
    const t = customBezierTAtX(ramp, u);
    const bezier = cubicBezier(ramp.curveIn, ramp.curveOut, t);
    shaped = bezier ** (1 + 31 * ramp.curveSharpness);
  }
  return ramp.curve === "linear" || ramp.curve === "custom"
    ? shaped
    : u + (shaped - u) * strength;
}

/** Integral of `speedRampEase` from 0..progress. */
export function integratedSpeedRampEase(ramp: Required<SpeedRamp>, progress: number): number {
  const u = Math.min(1, Math.max(0, progress));
  if (ramp.curve === "instant") return 0;
  const linear = u * u / 2;
  let shaped = linear;
  if (ramp.curve === "ease-in") shaped = u ** 4 / 4;
  else if (ramp.curve === "ease-out") shaped = u - (1 - (1 - u) ** 4) / 4;
  else if (ramp.curve === "smooth") shaped = u ** 3 - u ** 4 / 2;
  else if (ramp.curve === "custom") {
    // Integrate y(t)·x'(t) to get area under y(x). Simpson sampling is stable
    // here and keeps preview/export on the same exact implementation.
    const endT = customBezierTAtX(ramp, u);
    const steps = 24;
    const h = endT / steps;
    let sum = 0;
    for (let i = 0; i <= steps; i++) {
      const t = i * h;
      const value = cubicBezier(ramp.curveIn, ramp.curveOut, t) ** (1 + 31 * ramp.curveSharpness)
        * cubicBezierDerivative(ramp.curveInX, ramp.curveOutX, t);
      sum += value * (i === 0 || i === steps ? 1 : i % 2 === 0 ? 2 : 4);
    }
    shaped = sum * h / 3;
  }
  return ramp.curve === "linear" || ramp.curve === "custom"
    ? shaped
    : linear + (shaped - linear) * ramp.curveStrength;
}

/** Instantaneous speed at normalized Beat progress. */
export function speedAtRampProgress(ramp: Required<SpeedRamp>, progress: number): number {
  const p = Math.min(1, Math.max(0, progress));
  if (ramp.curve === "instant") {
    if (p < ramp.firstPoint) return ramp.startSpeed;
    if (p < ramp.secondPoint) return ramp.middleSpeed;
    return ramp.endSpeed;
  }
  let speed: number;
  if (p < ramp.firstPoint) {
    speed = ramp.startSpeed + (ramp.middleSpeed - ramp.startSpeed) * speedRampEase(ramp, p / ramp.firstPoint);
  } else if (p <= ramp.secondPoint) {
    speed = ramp.middleSpeed;
  } else {
    speed = ramp.middleSpeed + (ramp.endSpeed - ramp.middleSpeed) * speedRampEase(ramp, (p - ramp.secondPoint) / (1 - ramp.secondPoint));
  }
  return Math.min(8, Math.max(0.25, speed));
}

/** Integral of speed over normalized progress 0..p (source-seconds per timeline-second). */
export function integratedRampSpeed(ramp: Required<SpeedRamp>, progress: number): number {
  const p = Math.min(1, Math.max(0, progress));
  if (ramp.curve === "instant") {
    const before = Math.min(p, ramp.firstPoint) * ramp.startSpeed;
    const focus = Math.max(0, Math.min(p, ramp.secondPoint) - ramp.firstPoint) * ramp.middleSpeed;
    const after = Math.max(0, p - ramp.secondPoint) * ramp.endSpeed;
    return before + focus + after;
  }
  if (ramp.curve === "custom" && (ramp.curveIn > 1 || ramp.curveOut > 1)) {
    // Overshoot can cross the safe playback floor on a descending transition.
    // Integrate the same clamped instantaneous speed the preview uses so
    // duration, seeking and export remain in lockstep.
    const steps = 96;
    let sum = 0;
    for (let i = 0; i < steps; i++) {
      sum += speedAtRampProgress(ramp, p * (i + 0.5) / steps);
    }
    return p * sum / steps;
  }
  const first = ramp.firstPoint;
  const second = ramp.secondPoint;
  if (p <= first) {
    const u = p / first;
    return first * (ramp.startSpeed * u + (ramp.middleSpeed - ramp.startSpeed) * integratedSpeedRampEase(ramp, u));
  }
  const firstArea = first * (ramp.startSpeed + (ramp.middleSpeed - ramp.startSpeed) * integratedSpeedRampEase(ramp, 1));
  if (p <= second) return firstArea + (p - first) * ramp.middleSpeed;
  const u = (p - second) / (1 - second);
  const tail = (1 - second) * (ramp.middleSpeed * u + (ramp.endSpeed - ramp.middleSpeed) * integratedSpeedRampEase(ramp, u));
  return firstArea + (second - first) * ramp.middleSpeed + tail;
}

export function averageRampSpeed(ramp: Required<SpeedRamp>): number {
  return integratedRampSpeed(ramp, 1);
}

export function rampDurationSec(windowSec: number, ramp: Required<SpeedRamp>): number {
  return Math.round(Math.max(0, windowSec) / averageRampSpeed(ramp) * PROJECT_FPS) / PROJECT_FPS;
}

export interface SpeedRampSlice {
  sourceStartSec: number;
  sourceEndSec: number;
  timelineStartSec: number;
  timelineEndSec: number;
  speed: number;
}

/** Piecewise-constant export approximation sampled from the exact preview integral. */
export function speedRampSlices(windowSec: number, ramp: Required<SpeedRamp>, count = 18): SpeedRampSlice[] {
  const duration = rampDurationSec(windowSec, ramp);
  const average = averageRampSpeed(ramp);
  const slices: SpeedRampSlice[] = [];
  const n = Math.max(3, Math.round(count));
  const progressPoints = ramp.curve === "instant"
    ? [...new Set([...Array.from({ length: n + 1 }, (_, index) => index / n), ramp.firstPoint, ramp.secondPoint])].sort((a, b) => a - b)
    : Array.from({ length: n + 1 }, (_, index) => index / n);
  for (let i = 0; i < progressPoints.length - 1; i++) {
    const p0 = progressPoints[i];
    const p1 = progressPoints[i + 1];
    const timelineStartSec = duration * p0;
    const timelineEndSec = duration * p1;
    // Normalize by the full curve area so frame-snapping `duration` cannot
    // leave a sub-frame sliver of source behind (or run a sliver past it).
    const sourceStartSec = i === 0 ? 0 : windowSec * integratedRampSpeed(ramp, p0) / average;
    const sourceEndSec = i === progressPoints.length - 2 ? windowSec : windowSec * integratedRampSpeed(ramp, p1) / average;
    slices.push({
      sourceStartSec,
      sourceEndSec,
      timelineStartSec,
      timelineEndSec,
      speed: Math.max(0.01, (sourceEndSec - sourceStartSec) / Math.max(1e-6, timelineEndSec - timelineStartSec)),
    });
  }
  return slices;
}

/** FFmpeg setpts mapping from source T to the ramp's accumulated timeline time. */
export function speedRampSetpts(ramp: Required<SpeedRamp>, windowSec: number): string {
  const slices = speedRampSlices(windowSec, ramp);
  let expression = `(T-${slices.at(-1)!.sourceStartSec.toFixed(6)})/${slices.at(-1)!.speed.toFixed(6)}+${slices.at(-1)!.timelineStartSec.toFixed(6)}`;
  for (let i = slices.length - 2; i >= 0; i--) {
    const slice = slices[i];
    const mapped = `(T-${slice.sourceStartSec.toFixed(6)})/${slice.speed.toFixed(6)}+${slice.timelineStartSec.toFixed(6)}`;
    expression = `if(lt(T,${slice.sourceEndSec.toFixed(6)}),${mapped},${expression})`;
  }
  return `setpts='(${expression})/TB'`;
}
