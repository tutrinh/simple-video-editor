import type { Aspect, Beat, Clip, Cut, Story, VoSegment } from "../../domain/types";
import type { MotivationalStoryPlan } from "../../domain/motivationalStory";

export interface AppliedMotivationalStoryPlan {
  story: Story;
  cut: Cut;
  placeholderClips: Clip[];
}

export function applyMotivationalStoryPlan(
  plan: MotivationalStoryPlan,
  clips: readonly Clip[],
  aspect: Aspect = "9:16",
): AppliedMotivationalStoryPlan {
  const clipMap = new Map<string, Clip>(clips.map((clip) => [clip.id, clip]));
  const assignedClipIds = new Set<string>();

  const beats: Beat[] = [];
  const voSegments: VoSegment[] = [];
  const placeholderClips: Clip[] = [];

  let cutCursorSec = 0;

  for (let i = 0; i < plan.shots.length; i++) {
    const shot = plan.shots[i];
    const scriptLines = plan.script.filter((line) => line.shotId === shot.id);

    let assignedClipId: string | undefined = undefined;
    if (shot.matchedClipId && clipMap.has(shot.matchedClipId) && !assignedClipIds.has(shot.matchedClipId)) {
      assignedClipId = shot.matchedClipId;
      assignedClipIds.add(assignedClipId);
    }

    if (!assignedClipId) {
      const placeholderId = `motivational-placeholder-${shot.id}`;
      const placeholderClip: Clip = {
        id: placeholderId,
        file: new File([], `placeholder-${shot.id}.mp4`, { type: "video/mp4" }),
        name: `Slot: ${shot.description}`,
        durationSec: shot.approxDurationSec,
        width: aspect === "9:16" ? 1080 : aspect === "1:1" ? 1080 : 1920,
        height: aspect === "9:16" ? 1920 : aspect === "4:5" ? 1350 : aspect === "1:1" ? 1080 : 1080,
        isTemplatePlaceholder: true,
        templateSlotDescription: shot.description,
      };
      placeholderClips.push(placeholderClip);
      assignedClipId = placeholderId;
    }

    const assignedClip = clipMap.get(assignedClipId) || placeholderClips.find((p) => p.id === assignedClipId);
    const sourceMaxSec = assignedClip ? assignedClip.durationSec : shot.approxDurationSec;

    const scriptText = scriptLines.map((line) => line.text.trim()).filter(Boolean).join(" ");
    const approxDur = scriptLines.reduce((acc, l) => acc + l.approxDurationSec, 0) || shot.approxDurationSec;

    const durationSec = Math.max(0.5, Math.min(Math.round(approxDur * 10) / 10, Math.round(sourceMaxSec * 10) / 10));
    const inSec = 0;
    const outSec = durationSec;

    const beat: Beat = {
      id: `motivational-beat-${shot.id}`,
      clipId: assignedClipId,
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
        id: `motivational-vo-${shot.id}`,
        text: scriptText,
        startTimeSec: cutCursorSec,
        durationSec,
        captionVisible: true,
        fitToBeat: true,
      });
    }

    cutCursorSec += durationSec;
  }

  const story: Story = {
    logline: plan.hook || `Motivational story: ${plan.title}`,
    beats: beats.map((b) => ({ clipId: b.clipId, scriptText: b.scriptText })),
  };

  const cut: Cut = {
    beats,
    voSegments,
    aspect,
    templateName: `Motivational Story · ${plan.title}`,
  };

  return { story, cut, placeholderClips };
}

export async function fitMotivationalStoryVoiceoversToLength(
  applied: AppliedMotivationalStoryPlan,
  synthFn: (text: string) => Promise<{ durationSec: number }>,
): Promise<AppliedMotivationalStoryPlan> {
  const beats = [...applied.cut.beats];
  const voSegments = [...(applied.cut.voSegments ?? [])];

  const spokenDurations = await Promise.all(
    beats.map(async (beat, i) => {
      const voSeg = voSegments.find((v) => v.id === `motivational-vo-${beat.id.replace("motivational-beat-", "")}`)
        || voSegments[i];
      if (voSeg && voSeg.text.trim()) {
        try {
          const timeoutPromise = new Promise<{ durationSec: number }>((_, reject) =>
            setTimeout(() => reject(new Error("TTS fit timeout")), 4000)
          );
          const narration = await Promise.race([synthFn(voSeg.text.trim()), timeoutPromise]);
          if (narration && narration.durationSec > 0.2) {
            return Math.max(0.4, Math.round(narration.durationSec * 10) / 10);
          }
        } catch (err) {
          console.warn(`[Motivational Plan] Voiceover fit to length fallback for beat ${i}:`, err);
        }
      }
      return beat.durationSec;
    })
  );

  let cumulativeTimeSec = 0;
  let changed = false;

  for (let i = 0; i < beats.length; i++) {
    const beat = beats[i];
    const spokenDur = spokenDurations[i];
    if (spokenDur !== beat.durationSec) changed = true;

    const voSeg = voSegments.find((v) => v.id === `motivational-vo-${beat.id.replace("motivational-beat-", "")}`)
      || voSegments[i];

    const inSec = beat.inSec;
    const outSec = inSec + spokenDur;
    beats[i] = {
      ...beat,
      durationSec: spokenDur,
      outSec,
    };

    if (voSeg) {
      const voIdx = voSegments.findIndex((v) => v.id === voSeg.id);
      if (voIdx >= 0) {
        voSegments[voIdx] = {
          ...voSeg,
          startTimeSec: cumulativeTimeSec,
          durationSec: spokenDur,
          fitToBeat: true,
        };
      }
    }

    cumulativeTimeSec += spokenDur;
  }

  if (!changed) return applied;

  const updatedStory: Story = {
    ...applied.story,
    beats: beats.map((b) => ({ clipId: b.clipId, scriptText: b.scriptText })),
  };

  const updatedCut: Cut = {
    ...applied.cut,
    beats,
    voSegments,
  };

  return {
    ...applied,
    story: updatedStory,
    cut: updatedCut,
  };
}
