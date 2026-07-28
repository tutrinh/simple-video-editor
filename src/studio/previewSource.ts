import type { Clip } from "../domain/types";

export function previewFileForClip(clip: Clip) {
  return clip.file;
}
