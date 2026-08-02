import { callClaude, type ClaudeConfig } from "../../lib/claudeClient";

export const STORY_STEPS = [
  { id: "hook", label: "Hook", prompt: "Make the viewer stop. Open a curiosity gap, tension, surprise, or clear promise." },
  { id: "beginning", label: "Beginning", prompt: "Orient us quickly: who, where, what changed, and why this matters now." },
  { id: "problem", label: "Problem", prompt: "Name the obstacle and stakes. What might be lost if nothing changes?" },
  { id: "journey", label: "Journey", prompt: "Show attempts, friction, choices, setbacks, discoveries, and forward movement." },
  { id: "resolution", label: "Resolution", prompt: "Show what resolved the problem and why that change worked." },
  { id: "ending", label: "Ending", prompt: "Land the meaning, transformation, takeaway, or invitation to respond." },
] as const;

export type StoryStepId = (typeof STORY_STEPS)[number]["id"];
export type PracticeStorySteps = Record<StoryStepId, string>;

export interface PracticeStory {
  platform: "TikTok" | "Instagram Reels" | "YouTube Shorts" | "LinkedIn" | "Other";
  audience: string;
  objective: string;
  steps: PracticeStorySteps;
}

export interface StoryStepFeedback {
  step: StoryStepId;
  score: number;
  working: string;
  improve: string;
  suggestion: string;
  exampleRewrite: string;
}

export interface CoachReview {
  overallScore: number;
  confidenceMessage: string;
  summary: string;
  strongestMoment: string;
  highestLeverageImprovement: string;
  engagementForecast: string;
  stepFeedback: StoryStepFeedback[];
  deliveryTips: string[];
  practiceChallenge: string;
}

export type StoryCoach = (prompt: string, config: ClaudeConfig) => Promise<string>;

export function emptyPracticeStory(): PracticeStory {
  return {
    platform: "Instagram Reels",
    audience: "",
    objective: "",
    steps: { hook: "", beginning: "", problem: "", journey: "", resolution: "", ending: "" },
  };
}

export function practiceStoryWordCount(story: PracticeStory): number {
  return Object.values(story.steps).join(" ").trim().split(/\s+/).filter(Boolean).length;
}

export function buildStoryCoachPrompt(story: PracticeStory): string {
  return [
    "You are an encouraging, exacting social-media storytelling Coach.",
    "Your job is to build the Author's skill and confidence, not replace their voice.",
    "Evaluate specificity, clarity, emotional stakes, tension, momentum, authenticity, spoken rhythm, retention, payoff, and audience relevance.",
    "Do not reward clickbait that the story cannot pay off. Do not invent personal experiences or facts.",
    "Treat Problem + Journey + Resolution as the middle. Empty or thin steps should receive direct, constructive coaching.",
    "Scores are 0-100. Be supportive but calibrated: 90+ means publish-ready and unusually strong.",
    "Example rewrites must stay faithful to the Author's facts and sound natural when spoken.",
    `Platform: ${story.platform}`,
    `Audience: ${story.audience.trim() || "Not specified"}`,
    `Author's objective: ${story.objective.trim() || "Build an engaging social story"}`,
    ...STORY_STEPS.map((step) => `${step.label.toUpperCase()}: ${story.steps[step.id].trim() || "[EMPTY]"}`),
    "Return ONLY valid JSON with this exact shape:",
    JSON.stringify({
      overallScore: 0,
      confidenceMessage: "One grounded, encouraging sentence.",
      summary: "Two concise sentences about the story's current effect.",
      strongestMoment: "The most effective specific moment and why it works.",
      highestLeverageImprovement: "The single change that would improve retention most.",
      engagementForecast: "A concise forecast of where viewers may stay, lean in, or drop off and why.",
      stepFeedback: STORY_STEPS.map((step) => ({
        step: step.id,
        score: 0,
        working: "What works in this exact section.",
        improve: "What is missing or weakening it.",
        suggestion: "A concrete revision action.",
        exampleRewrite: "A concise example in the Author's voice, or an empty string if facts are insufficient.",
      })),
      deliveryTips: ["Three concise spoken-delivery tips grounded in this story."],
      practiceChallenge: "One focused exercise for the Author's next attempt.",
    }),
  ].join("\n\n");
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function score(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? Math.round(Math.max(0, Math.min(100, number))) : 0;
}

export function parseCoachReview(raw: string): CoachReview {
  const cleaned = raw.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The Coach did not return a structured review.");
  const root = record(JSON.parse(cleaned.slice(start, end + 1)));
  const feedbackByStep = new Map<StoryStepId, Record<string, unknown>>();
  if (Array.isArray(root.stepFeedback)) {
    for (const item of root.stepFeedback) {
      const candidate = record(item);
      const step = text(candidate.step) as StoryStepId;
      if (STORY_STEPS.some((known) => known.id === step)) feedbackByStep.set(step, candidate);
    }
  }
  const stepFeedback = STORY_STEPS.map(({ id }) => {
    const item = feedbackByStep.get(id) ?? {};
    return {
      step: id,
      score: score(item.score),
      working: text(item.working),
      improve: text(item.improve),
      suggestion: text(item.suggestion),
      exampleRewrite: text(item.exampleRewrite),
    };
  });
  const review: CoachReview = {
    overallScore: score(root.overallScore),
    confidenceMessage: text(root.confidenceMessage),
    summary: text(root.summary),
    strongestMoment: text(root.strongestMoment),
    highestLeverageImprovement: text(root.highestLeverageImprovement),
    engagementForecast: text(root.engagementForecast),
    stepFeedback,
    deliveryTips: Array.isArray(root.deliveryTips) ? root.deliveryTips.map(text).filter(Boolean).slice(0, 5) : [],
    practiceChallenge: text(root.practiceChallenge),
  };
  if (!review.summary || !review.highestLeverageImprovement) throw new Error("The Coach review was incomplete. Try analyzing again.");
  return review;
}

export async function reviewPracticeStory(
  story: PracticeStory,
  config: ClaudeConfig,
  coach: StoryCoach = callClaude,
): Promise<CoachReview> {
  if (practiceStoryWordCount(story) < 20) throw new Error("Write at least 20 words before asking the Coach for feedback.");
  return parseCoachReview(await coach(buildStoryCoachPrompt(story), config));
}

const STORAGE_KEY = "vidstr_story_practice";

export function loadPracticeSession(): { story: PracticeStory; review: CoachReview | null } {
  if (typeof localStorage === "undefined") return { story: emptyPracticeStory(), review: null };
  try {
    const saved = record(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}"));
    const candidate = record(saved.story);
    const savedSteps = record(candidate.steps);
    const story: PracticeStory = {
      platform: (["TikTok", "Instagram Reels", "YouTube Shorts", "LinkedIn", "Other"] as const).includes(candidate.platform as PracticeStory["platform"])
        ? candidate.platform as PracticeStory["platform"] : "Instagram Reels",
      audience: text(candidate.audience),
      objective: text(candidate.objective),
      steps: Object.fromEntries(STORY_STEPS.map(({ id }) => [id, text(savedSteps[id])])) as unknown as PracticeStorySteps,
    };
    const review = saved.review ? parseCoachReview(JSON.stringify(saved.review)) : null;
    return { story, review };
  } catch {
    return { story: emptyPracticeStory(), review: null };
  }
}

export function savePracticeSession(story: PracticeStory, review: CoachReview | null): void {
  if (typeof localStorage === "undefined") return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ story, review })); } catch { /* practice remains available for this session */ }
}
