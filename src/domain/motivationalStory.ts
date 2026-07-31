import type { Aspect } from "./types";

export interface MotivationalShot {
  id: string;
  description: string;
  capture: "action" | "talking-head" | "b-roll" | "landscape" | "demo" | "abstract";
  framing: "wide" | "medium" | "close-up";
  approxDurationSec: number;
  matchedClipId?: string;
}

export interface MotivationalScriptLine {
  id: string;
  text: string;
  purpose: "hook" | "struggle" | "shift" | "action" | "climax" | "takeaway";
  approxDurationSec: number;
  shotId: string;
}

export interface MotivationalStoryPlan {
  id: string;
  title: string;
  prompt: string;
  targetDurationSec: number;
  hook: string;
  createdAt: number;
  shots: MotivationalShot[];
  script: MotivationalScriptLine[];
}

export interface MotivationalStoryWorkspace {
  prompt: string;
  plan?: MotivationalStoryPlan;
  creatorNotes?: string;
}

export interface SavedMotivationalPlanItem {
  id: string;
  savedAt: number;
  prompt: string;
  workspace: MotivationalStoryWorkspace;
}

export interface GenerateMotivationalStoryInput {
  prompt: string;
  targetDurationSec: number;
  tone?: string;
  scriptType?: string;
  creatorNotes?: string;
  aiProvider?: "claude" | "codex";
  authorModel?: string;
  aspect?: Aspect;
}
