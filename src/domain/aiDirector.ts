export type InfluenceGoal = "shares" | "saves" | "follows" | "clicks" | "sales";

export interface CreatorBrief {
  audience: string;
  goal: InfluenceGoal;
  promise: string;
  evidence: string;
  callToAction: string;
}

export type HookMechanism =
  | "result-first"
  | "question"
  | "contradiction"
  | "tension"
  | "visual-reveal";

export interface HookVariant {
  id: string;
  mechanism: HookMechanism;
  spokenLine: string;
  onScreenText: string;
  visualDirection: string;
  rationale: string;
}

export interface AiDirectorWorkspace {
  brief: CreatorBrief;
  hooks: HookVariant[];
  selectedHookId?: string;
}

export const EMPTY_CREATOR_BRIEF: CreatorBrief = {
  audience: "",
  goal: "shares",
  promise: "",
  evidence: "",
  callToAction: "",
};

export function emptyAiDirectorWorkspace(): AiDirectorWorkspace {
  return { brief: { ...EMPTY_CREATOR_BRIEF }, hooks: [] };
}
