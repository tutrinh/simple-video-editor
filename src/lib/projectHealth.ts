import type { ProjectState } from "../state/projectReducer";

export interface ProjectHealthIssue {
  code: "missing-clip-media" | "missing-reference" | "missing-user-voice" | "missing-music";
  message: string;
  clipId?: string;
}

export function projectHealthIssues(state: ProjectState): ProjectHealthIssue[] {
  const issues: ProjectHealthIssue[] = [];
  const clipIds = new Set(state.clips.map((clip) => clip.id));
  for (const clip of state.clips) {
    if (!clip.isTemplatePlaceholder && (!(clip.file instanceof Blob) || clip.file.size === 0)) {
      issues.push({ code: "missing-clip-media", clipId: clip.id, message: `Relink the source file for “${clip.name}”.` });
    }
  }
  for (const beat of state.cut?.beats ?? []) {
    if (!clipIds.has(beat.clipId)) issues.push({ code: "missing-reference", message: `Beat ${beat.id} references a missing Clip.` });
    for (const slot of beat.splitScreen?.slots ?? []) {
      if (!clipIds.has(slot.clipId)) issues.push({ code: "missing-reference", message: `A split-screen slot references a missing Clip.` });
    }
  }
  for (const overlay of state.cut?.overlays ?? []) {
    if (!clipIds.has(overlay.clipId)) issues.push({ code: "missing-reference", message: `Overlay ${overlay.id} references a missing Clip.` });
  }
  for (const voice of state.cut?.userVoiceSegments ?? []) {
    if (!(voice.file instanceof Blob) || voice.file.size === 0) issues.push({ code: "missing-user-voice", message: `User VO “${voice.name}” is missing its audio file.` });
  }
  if (state.musicTrack && (!(state.musicTrack.file instanceof Blob) || state.musicTrack.file.size === 0)) {
    issues.push({ code: "missing-music", message: `Music “${state.musicTrack.name}” is unavailable. Choose it again from Music.` });
  }
  return issues;
}
