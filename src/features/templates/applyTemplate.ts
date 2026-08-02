import type { Clip, Cut, ProjectTemplate, TemplateBeat } from "../../domain/types";
import { makeBeat, newId } from "../assemble/assemble";

export interface TemplateAssignment {
  beatIndex: number;
  clipId: string;
}

export interface TemplateApplicationResult {
  cut: Cut;
  placeholderClips: Clip[];
}

export class TemplateApplicationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateApplicationError";
  }
}

function durationFor(beat: TemplateBeat, clip: Clip): number {
  const requested = beat.approxDurationSec;
  if (typeof requested !== "number" || !Number.isFinite(requested) || requested <= 0) {
    return makeBeat(clip).durationSec;
  }
  return Math.min(Math.max(0.1, requested), Math.max(0.1, clip.durationSec));
}

/**
 * Turns a template plus explicit slot assignments into an editor-ready Cut.
 * This is the sole seam where reusable template data becomes mutable project
 * state, so every caller gets the same validation and timing behavior.
 */
export function applyTemplate(
  template: ProjectTemplate,
  clips: Clip[],
  assignments: TemplateAssignment[],
): TemplateApplicationResult {
  if (template.beats.length < 2 || template.beats.length > 12) {
    throw new TemplateApplicationError("A template must contain between 2 and 12 beats.");
  }
  if (assignments.length !== template.beats.length) {
    throw new TemplateApplicationError("Every template beat needs a clip assignment.");
  }

  const clipById = new Map(clips.map((clip) => [clip.id, clip]));
  const assignmentByBeat = new Map<number, string>();
  const usedClipIds = new Set<string>();

  for (const assignment of assignments) {
    if (!Number.isInteger(assignment.beatIndex) || assignment.beatIndex < 0 || assignment.beatIndex >= template.beats.length) {
      throw new TemplateApplicationError("A clip assignment points to an unknown template beat.");
    }
    if (assignmentByBeat.has(assignment.beatIndex)) {
      throw new TemplateApplicationError("A template beat was assigned more than once.");
    }
    if (assignment.clipId && !clipById.has(assignment.clipId)) {
      throw new TemplateApplicationError("A selected clip is no longer available.");
    }
    if (assignment.clipId && usedClipIds.has(assignment.clipId)) {
      throw new TemplateApplicationError("Each template beat must use a different clip.");
    }
    assignmentByBeat.set(assignment.beatIndex, assignment.clipId);
    if (assignment.clipId) usedClipIds.add(assignment.clipId);
  }

  const placeholderClips: Clip[] = [];
  const beats = template.beats.map((slot, beatIndex) => {
    const clipId = assignmentByBeat.get(beatIndex);
    let clip = clipId ? clipById.get(clipId) : undefined;
    if (!clip) {
      const durationSec = typeof slot.approxDurationSec === "number" && Number.isFinite(slot.approxDurationSec)
        ? Math.max(0.1, slot.approxDurationSec)
        : 5;
      const [width, height] = template.aspect === "9:16"
        ? [1080, 1920]
        : template.aspect === "4:5"
          ? [1080, 1350]
        : template.aspect === "1:1"
          ? [1080, 1080]
          : [1920, 1080];
      clip = {
        id: `template-slot-${newId()}`,
        file: new File([], `empty-template-slot-${beatIndex + 1}.mp4`, { type: "video/mp4" }),
        name: `Empty · ${slot.description}`,
        durationSec,
        width,
        height,
        isTemplatePlaceholder: true,
        templateSlotDescription: slot.description,
      };
      placeholderClips.push(clip);
    }

    const durationSec = durationFor(slot, clip);
    const inSec = clip.kind === "still" ? 0 : Math.max(0, (clip.durationSec - durationSec) / 2);
    const base = makeBeat(clip);

    return {
      ...base,
      inSec,
      outSec: inSec + durationSec,
      durationSec,
      durationPreset: "custom" as const,
      templateSlotDescription: slot.description,
      zoom: slot.zoom,
      transition: beatIndex === 0 ? "none" as const : slot.transition,
      transitionSec: slot.transitionSec,
    };
  });

  return {
    cut: {
      beats,
      aspect: template.aspect ?? "16:9",
      templateName: template.name,
      templateToneHint: template.toneHint,
      globalFilterAdjustments: template.colorHint ? { ...template.colorHint } : undefined,
    },
    placeholderClips,
  };
}
