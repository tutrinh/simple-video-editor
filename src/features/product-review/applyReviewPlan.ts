import type { Aspect, Beat, Clip, Cut, Story, VoSegment } from "../../domain/types";
import type { ReviewPlan, ReviewScriptSegment, ReviewShot } from "../../domain/productReview";

export interface AppliedReviewPlan {
  story: Story;
  cut: Cut;
  placeholderClips: Clip[];
}

interface ShotWithScript {
  shot: ReviewShot;
  segments: ReviewScriptSegment[];
}

function orderedShots(plan: ReviewPlan): ShotWithScript[] {
  const shotById = new Map(plan.shots.map((shot) => [shot.id, shot]));
  const groups = new Map<string, ReviewScriptSegment[]>();
  const order: string[] = [];
  for (const segment of plan.script) {
    if (!shotById.has(segment.shotId)) continue;
    if (!groups.has(segment.shotId)) {
      groups.set(segment.shotId, []);
      order.push(segment.shotId);
    }
    groups.get(segment.shotId)!.push(segment);
  }
  for (const shot of plan.shots) {
    if (!groups.has(shot.id)) {
      groups.set(shot.id, []);
      order.push(shot.id);
    }
  }
  return order.map((id) => ({ shot: shotById.get(id)!, segments: groups.get(id)! }));
}

function requestedDuration(group: ShotWithScript): number {
  const scriptDuration = group.segments.reduce((sum, segment) => sum + segment.approxDurationSec, 0);
  return Math.max(0.1, scriptDuration || group.shot.approxDurationSec || 3);
}

function placeholderFor(shot: ReviewShot, durationSec: number): Clip {
  return {
    id: `review-placeholder-${shot.id}`,
    file: new File([], `missing-${shot.id}.mp4`, { type: "video/mp4" }),
    name: `Empty · ${shot.description}`,
    durationSec,
    width: 1080,
    height: 1920,
    isTemplatePlaceholder: true,
    templateSlotDescription: shot.description,
  };
}

function scriptTextOf(segments: ReviewScriptSegment[]): string {
  return segments.map((segment) => segment.text.trim()).filter(Boolean).join(" ");
}

export function applyReviewPlan(
  plan: ReviewPlan,
  clips: readonly Clip[],
  aspect: Aspect = "9:16",
): AppliedReviewPlan {
  const clipById = new Map(clips.map((clip) => [clip.id, clip]));
  const usedClipIds = new Set<string>();
  const placeholderClips: Clip[] = [];
  const beats: Beat[] = [];
  const voSegments: VoSegment[] = [];
  let cutCursorSec = 0;

  for (const { shot, segments } of orderedShots(plan)) {
    const desiredDuration = requestedDuration({ shot, segments });
    const matched = shot.matchedClipId && !usedClipIds.has(shot.matchedClipId)
      ? clipById.get(shot.matchedClipId)
      : undefined;
    const targetClip = matched ?? placeholderFor(shot, desiredDuration);
    if (matched) usedClipIds.add(matched.id);
    else placeholderClips.push(targetClip);

    const durationSec = Math.max(0.1, Math.min(desiredDuration, targetClip.durationSec || desiredDuration));
    const inSec = targetClip.isTemplatePlaceholder
      ? 0
      : Math.max(0, ((targetClip.durationSec || durationSec) - durationSec) / 2);
    const outSec = inSec + durationSec;
    const scriptText = scriptTextOf(segments);
    const beat: Beat = {
      id: `review-beat-${shot.id}`,
      clipId: targetClip.id,
      inSec,
      outSec,
      durationSec,
      scriptText,
      captionText: scriptText,
      templateSlotDescription: shot.description,
      durationPreset: "custom",
    };
    beats.push(beat);

    if (scriptText) {
      voSegments.push({
        id: `review-vo-${shot.id}`,
        text: scriptText,
        startTimeSec: cutCursorSec,
        durationSec,
        captionVisible: true,
      });
    }
    cutCursorSec += durationSec;
  }

  const story: Story = {
    logline: plan.hook || `A concise review of ${plan.productTitle}.`,
    beats: beats.map((beat) => ({ clipId: beat.clipId, scriptText: beat.scriptText })),
  };
  const cut: Cut = {
    beats,
    voSegments,
    aspect,
    templateName: `Product review · ${plan.productTitle}`,
  };
  return { story, cut, placeholderClips };
}

