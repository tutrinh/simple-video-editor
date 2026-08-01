import type { Beat, BeatFill } from "./types";
import { DEFAULT_BEAT_SPEED, PROJECT_FPS } from "./types";

/**
 * The one place a Beat's Speed and Fill are turned into time (ADR-0019).
 *
 * The export builds a filter graph and the preview drives `currentTime` on rAF —
 * two entirely different mechanisms that must agree on which source frame is on
 * screen at a given moment. They agree because both derive it from here, and a
 * parity test asserts they keep doing so.
 *
 * Note the two lengths are *not* interchangeable. `timelineSec` is how long the
 * Beat occupies the Cut (`outSec - inSec`, which is what the export encodes).
 * `windowSec` is how much source footage actually exists to fill it, which is
 * smaller whenever the trim window runs past the end of the Clip. A Beat can
 * therefore outlast its footage at Speed 1, which is the case the old implicit
 * stretch existed to paper over.
 */
export interface BeatTiming {
  /** Timeline seconds the Beat occupies. */
  timelineSec: number;
  /** Source seconds actually available inside the trim window. */
  windowSec: number;
  speed: number;
  fill: BeatFill;
}

/** Speed as a usable number. Guards the 0 and negative cases a saved file could carry. */
export function beatSpeed(beat: Pick<Beat, "speed">): number {
  const value = beat.speed ?? DEFAULT_BEAT_SPEED;
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_BEAT_SPEED;
}

/** Fill as a usable value; undefined means "hold". */
export function beatFill(beat: Pick<Beat, "fill">): BeatFill {
  return beat.fill === "loop" ? "loop" : "hold";
}

/** Round to a whole frame of the Cut, so a Beat never ends mid-frame. */
export function snapToFrames(seconds: number): number {
  return Math.round(seconds * PROJECT_FPS) / PROJECT_FPS;
}

/**
 * How long a Beat runs, given the footage it has and the Speed it plays at
 * (ADR-0020). Footage is the clock: half a second of source at 0.5× is a second
 * of Cut. Snapped to whole frames so segment boundaries stay exact and sub-frame
 * error cannot accumulate across a long Cut.
 */
export function beatDurationSec(windowSec: number, speed: number): number {
  const usable = Number.isFinite(speed) && speed > 0 ? speed : DEFAULT_BEAT_SPEED;
  return snapToFrames(Math.max(0, windowSec) / usable);
}

/**
 * Build the timing for a Beat against the Clip it points at. `clipDurationSec`
 * of 0 or undefined means the length is unknown, so the trim window is trusted.
 */
export function beatTiming(
  beat: Pick<Beat, "inSec" | "outSec" | "speed" | "fill">,
  clipDurationSec?: number,
): BeatTiming {
  const requested = Math.max(0, beat.outSec - beat.inSec);
  const available = clipDurationSec && clipDurationSec > 0
    ? Math.max(0, clipDurationSec - Math.max(0, beat.inSec))
    : requested;
  const windowSec = Math.min(requested, available);
  const speed = beatSpeed(beat);
  return {
    // Derived, not stored: the footage and the Speed decide the length (ADR-0020).
    timelineSec: beatDurationSec(windowSec, speed),
    windowSec,
    speed,
    fill: beatFill(beat),
  };
}

/** Timeline seconds the available footage fills once Speed is applied. */
export function slowedLengthSec(timing: BeatTiming): number {
  return timing.windowSec / timing.speed;
}

/**
 * Timeline seconds the Beat outlasts its footage. Positive means Fill decides
 * what fills the remainder; zero or less means the source is truncated instead.
 */
export function beatGapSec(timing: BeatTiming): number {
  return timing.timelineSec - slowedLengthSec(timing);
}

/** Source seconds of the window the Author will actually see. */
export function visibleWindowSec(timing: BeatTiming): number {
  return Math.min(timing.windowSec, timing.timelineSec * timing.speed);
}

export interface SourceAt {
  /** Offset into the trim window, in source seconds (add `inSec` for absolute). */
  offsetSec: number;
  /** True once the footage is spent and the last frame is being held. */
  holding: boolean;
}

/**
 * Which source frame is on screen `elapsedSec` into the Beat.
 *
 * This is the whole model: consumed source is `elapsed × speed`, and Fill only
 * decides what happens once that exceeds the window. Nothing multiplies Speed by
 * anything derived, so both numbers the Author sees stay true.
 */
export function sourceOffsetAt(timing: BeatTiming, elapsedSec: number): SourceAt {
  if (timing.windowSec <= 0) return { offsetSec: 0, holding: true };

  const consumed = Math.max(0, elapsedSec) * timing.speed;
  if (consumed < timing.windowSec) return { offsetSec: consumed, holding: false };

  return timing.fill === "loop"
    ? { offsetSec: consumed % timing.windowSec, holding: false }
    : { offsetSec: timing.windowSec, holding: true };
}

export interface SpeedPlan {
  /** Multiplier for `setpts`. Speed 0.5 stretches presentation stamps by 2. */
  ptsFactor: number;
  /** True when the graph must retime at all. */
  retimed: boolean;
  /** Timeline seconds to hold the last frame via `tpad`. */
  holdSec: number;
  /** True when the trim window must repeat to fill the Beat. */
  loops: boolean;
}

/**
 * The same model expressed as the numbers a filter graph needs, derived from the
 * helpers above rather than recomputed — so the export cannot drift from the
 * preview.
 */
export function speedPlan(timing: BeatTiming): SpeedPlan {
  const gap = beatGapSec(timing);
  const loops = gap > 0.01 && timing.fill === "loop";
  return {
    ptsFactor: 1 / timing.speed,
    // Below a thousandth the graph gains nothing and costs a filter.
    retimed: Math.abs(timing.speed - 1) > 0.001,
    holdSec: loops ? 0 : Math.max(0, gap),
    loops,
  };
}

/**
 * Turn the export's old hidden stretch into the Speed that reproduces the Beat's
 * LENGTH (ADR-0020), so a Project saved before Speed existed keeps its Cut
 * timing — and the Author can finally see and change what was happening.
 *
 * Length is preserved rather than picture. The old export looped instead of
 * slowing once the shortfall passed 2.5×, and looping is unrepresentable now
 * that a Beat is sized to its footage; those Beats become very slow rather than
 * repeated. Their length — which is what the rest of the Cut, the Voiceover and
 * the Music are aligned to — is unchanged.
 *
 * Idempotent: a Beat that already carries either field is left alone, so this is
 * safe to run on every load.
 */
export function migrateImplicitStretch<T extends Pick<Beat, "inSec" | "outSec" | "speed" | "fill">>(
  beat: T,
  clipDurationSec?: number,
): T {
  if (beat.speed !== undefined || beat.fill !== undefined) return beat;

  // Deliberately the REQUESTED window, not `beatTiming`'s derived length — the
  // old export encoded `outSec - inSec` regardless of how much footage existed,
  // and reproducing it means comparing against that same number.
  const requested = Math.max(0, beat.outSec - beat.inSec);
  const available = clipDurationSec && clipDurationSec > 0
    ? Math.max(0, clipDurationSec - Math.max(0, beat.inSec))
    : requested;
  const windowSec = Math.min(requested, available);

  // No shortfall means the old code did nothing, so the defaults already match.
  if (windowSec <= 0 || windowSec >= requested - 0.001) return beat;

  // windowSec / (windowSec / requested) === requested, so the Beat keeps the
  // length it had — and for shortfalls up to 2.5× this is also the exact Speed
  // the old graph's `setpts=ratio*PTS` produced.
  return { ...beat, speed: windowSec / requested, fill: "hold" as const };
}

/**
 * Run {@link migrateImplicitStretch} across a whole Cut, resolving each Beat's
 * Clip so the available footage — not just the trim window — is what decides.
 * Returns the same object when nothing changed, so a loaded Project is not
 * needlessly cloned.
 */
export function migrateCutSpeeds<
  C extends { beats: Beat[] } | undefined,
  L extends { id: string; durationSec?: number },
>(cut: C, clips: readonly L[]): C {
  if (!cut) return cut;
  const durationById = new Map(clips.map((clip) => [clip.id, clip.durationSec]));
  let changed = false;
  const beats = cut.beats.map((beat) => {
    const next = migrateImplicitStretch(beat, durationById.get(beat.clipId));
    if (next !== beat) changed = true;
    return next;
  });
  return changed ? { ...cut, beats } : cut;
}

/**
 * `atempo` accepts 0.5–2.0 per instance, so slower Speeds need chaining. Returns
 * the factors to apply in order; empty when the audio needs no retiming.
 */
export function atempoChain(speed: number): number[] {
  if (!Number.isFinite(speed) || speed <= 0 || Math.abs(speed - 1) <= 0.001) return [];
  const factors: number[] = [];
  let remaining = speed;
  while (remaining < 0.5 - 1e-9) {
    factors.push(0.5);
    remaining /= 0.5;
  }
  while (remaining > 2 + 1e-9) {
    factors.push(2);
    remaining /= 2;
  }
  if (Math.abs(remaining - 1) > 0.001) factors.push(remaining);
  return factors;
}
