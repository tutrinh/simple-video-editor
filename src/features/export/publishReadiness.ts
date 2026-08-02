import type { Aspect } from "../../domain/types";

export type PublishTarget = "TikTok" | "Instagram Reels" | "YouTube Shorts" | "Instagram Feed";

export interface PublishReadinessInput {
  target: PublishTarget;
  aspect: Aspect;
  durationSec: number;
  hasCaptions: boolean;
  hasAudio: boolean;
}

export interface PublishCheck { label: string; ready: boolean; detail: string }

export function publishReadiness(input: PublishReadinessInput): PublishCheck[] {
  const shortTarget = input.target !== "Instagram Feed";
  const framingReady = input.target === "Instagram Feed"
    ? input.aspect === "4:5" || input.aspect === "1:1"
    : input.aspect === "9:16";
  const durationReady = input.target === "YouTube Shorts" ? input.durationSec <= 180 : input.durationSec <= 90;
  return [
    {
      label: "Framing",
      ready: framingReady,
      detail: framingReady ? `${input.aspect} is ready` : `Use ${shortTarget ? "9:16" : "4:5 or 1:1"} for the strongest fit`,
    },
    {
      label: "Duration",
      ready: durationReady,
      detail: durationReady ? `${Math.round(input.durationSec)} seconds` : `Trim to ${input.target === "YouTube Shorts" ? "3 minutes" : "90 seconds"} or less`,
    },
    { label: "Captions", ready: input.hasCaptions, detail: input.hasCaptions ? "Captions are present" : "Add captions for sound-off viewers" },
    { label: "Audio", ready: input.hasAudio, detail: input.hasAudio ? "Audio is present" : "Add voice, source sound, or music" },
  ];
}
