import type { ProjectState } from "../state/projectReducer";
import type { UserVoiceSegment } from "../domain/types";

export interface UserVoiceFileEntry {
  key: string;
  file: File;
}

type SerializedUserVoiceSegment = Omit<UserVoiceSegment, "file">;

export function collectUserVoiceFiles(state: ProjectState): UserVoiceFileEntry[] {
  return (state.cut?.userVoiceSegments ?? [])
    .filter((segment) => segment.file instanceof Blob)
    .map((segment) => ({ key: segment.id, file: segment.file }));
}

export function userVoiceKeys(state: ProjectState): string[] {
  return (state.cut?.userVoiceSegments ?? []).map((segment) => segment.id);
}

export function stripUserVoiceFiles(state: ProjectState): ProjectState {
  if (!state.cut?.userVoiceSegments) return state;
  const userVoiceSegments = state.cut.userVoiceSegments.map(({ file: _file, ...segment }) => segment);
  return {
    ...state,
    cut: {
      ...state.cut,
      userVoiceSegments: userVoiceSegments as UserVoiceSegment[],
    },
  };
}

export function reinjectUserVoiceFiles(state: ProjectState, files: Map<string, Blob>): ProjectState {
  if (!state.cut?.userVoiceSegments) return state;
  const userVoiceSegments = (state.cut.userVoiceSegments as unknown as SerializedUserVoiceSegment[])
    .flatMap((segment) => {
      const blob = files.get(segment.id);
      if (!blob) return [];
      const file = blob instanceof File
        ? blob
        : new File([blob], segment.name || `${segment.id}.webm`, { type: blob.type || "audio/webm" });
      return [{ ...segment, file }];
    });
  return { ...state, cut: { ...state.cut, userVoiceSegments } };
}
