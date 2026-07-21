import type { Clip, ClipDescription } from "../../domain/types";
import { sampleFrames } from "../../lib/frameSampler";
import { describeClip, type ClaudeConfig } from "../../lib/claudeClient";

// Analyze one clip (ADR-0001): sample ~8 frames from the normalized 1080p source
// (falling back to the original) and pass the filename as a hint — filenames
// carry the story beat the pixels sometimes miss.

/** Filename without extension — the clip's human label / beat hint. */
export function hintFromName(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}

export async function analyzeClip(clip: Clip, cfg: ClaudeConfig, frames = 8): Promise<ClipDescription> {
  const source = clip.normalized ?? clip.file;
  const sampled = await sampleFrames(source, frames);
  return describeClip(sampled, hintFromName(clip.name), cfg);
}
