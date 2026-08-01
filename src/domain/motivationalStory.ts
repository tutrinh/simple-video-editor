import type { CustomPersonaDraft, MotivationalPersona, MotivationalPov } from "./motivationalPersona";
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
  /**
   * The filmable detail (object, number, time, place, sensation) this line is built on.
   * The author prompt requires the model to name it, which is what stops the line
   * collapsing into abstractions — see storyAuthor's specificity contract.
   */
  concreteDetail?: string;
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
  /** Who the story is told as — echoed back by the model, and invented by it under `auto`. */
  persona?: string;
  /** The single incident the reel tells, instead of a montage of lessons. */
  incident?: string;
}

export interface MotivationalStoryWorkspace {
  prompt: string;
  plan?: MotivationalStoryPlan;
  creatorNotes?: string;
  /** Persona preset id, `auto`, or `custom` (see domain/motivationalPersona). */
  personaId?: string;
  /** Point-of-view override applied on top of the selected persona. */
  pov?: MotivationalPov;
  /** The creator's own persona, used when personaId is `custom`. */
  customPersona?: CustomPersonaDraft;
  /** Target reel length, so a restored plan comes back with the length it was written for. */
  targetDurationSec?: number;
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
  /** Resolved persona; undefined means the model must invent and commit to one. */
  persona?: MotivationalPersona;
}
