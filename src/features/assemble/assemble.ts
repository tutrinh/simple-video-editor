import type { Clip, Cut, Beat, Story, Aspect } from "../../domain/types";
import { estimateSpokenSeconds } from "../../lib/pacing";

// Assemble the Cut (ADR-0004): turn each authored StoryBeat into a Beat whose
// duration comes from the Script line's spoken length, then pick a trim window
// of that length. v1 centers the window (skips shaky starts/ends); motion-aware
// "land the peak frame" selection is a later refinement.

export function newId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

/**
 * The script-driven trim window (ADR-0004): duration from the script's spoken
 * length, centered in the clip. Shared by assemble, swap-clip, and add-back.
 */
export function computeWindow(clipDurationSec: number, scriptText: string): Pick<Beat, "inSec" | "outSec" | "durationSec"> {
  const target = estimateSpokenSeconds(scriptText);
  const clipDur = clipDurationSec || target;
  const durationSec = Math.min(target, clipDur);
  const inSec = Math.max(0, (clipDur - durationSec) / 2);
  return { inSec, outSec: inSec + durationSec, durationSec };
}

export function makeBeat(clip: Clip, scriptText: string): Beat {
  return { id: newId(), clipId: clip.id, scriptText, captionText: scriptText, ...computeWindow(clip.durationSec, scriptText) };
}

export function assembleCut(clips: Clip[], story: Story, aspect: Aspect = "16:9"): Cut {
  const clipById = new Map(clips.map((c) => [c.id, c]));
  const beats: Beat[] = [];
  for (const sb of story.beats) {
    const clip = clipById.get(sb.clipId);
    if (clip) beats.push(makeBeat(clip, sb.scriptText));
  }
  return { beats, aspect };
}

export function cutDuration(cut: Cut): number {
  return cut.beats.reduce((sum, b) => sum + b.durationSec, 0);
}
