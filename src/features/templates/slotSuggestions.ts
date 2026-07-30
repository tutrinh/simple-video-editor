import { callClaude, type ClaudeConfig } from "../../lib/claudeClient";
import type { Beat } from "../../domain/types";

export interface TemplateSlotSuggestionInput {
  templateName: string;
  templateTone?: string;
  slotDescription: string;
  beatIndex: number;
  beatCount: number;
  durationSec: number;
  projectDirection?: string;
}

type SlotSuggestionAuthor = (prompt: string, config: ClaudeConfig) => Promise<string>;

const MAX_SUGGESTIONS = 5;
const MAX_SUGGESTION_LENGTH = 140;

export type TemplateSlotSuggestionMode = "hook" | "shot";

export function templateSlotSuggestionMode(
  beatIndex: number,
  slotDescription: string | undefined,
): TemplateSlotSuggestionMode {
  return beatIndex === 0 || /\bhook\b/i.test(slotDescription ?? "") ? "hook" : "shot";
}

export function buildTemplateSlotSuggestionPrompt(input: TemplateSlotSuggestionInput): string {
  const mode = templateSlotSuggestionMode(input.beatIndex, input.slotDescription);
  const task = mode === "hook"
    ? [
        `Create exactly ${MAX_SUGGESTIONS} distinct spoken hook or on-screen opening line suggestions for one Beat in a short social-media Reel.`,
        "Each hook must be immediately usable, conversational, and at most 14 words.",
        "Vary the hooks across curiosity, tension, specificity, contrast, and direct address.",
      ]
    : [
        `Create exactly ${MAX_SUGGESTIONS} distinct shot or scene execution ideas for one Beat in a short social-media Reel.`,
        "Describe what to film: the subject, action, framing, or visual proof that directly fulfills this template slot.",
        "Each idea must be practical, visually distinct, and at most 18 words.",
        "Do not write hooks, captions, voiceover, or dialogue. These are filming ideas, not script copy.",
      ];

  return [
    ...task,
    `Template: ${input.templateName}`,
    `Beat ${input.beatIndex + 1} of ${input.beatCount}`,
    `Template slot role: ${input.slotDescription}`,
    `Available screen time: about ${Math.max(1, Math.round(input.durationSec))} seconds`,
    input.templateTone ? `Template tone: ${input.templateTone}` : "",
    input.projectDirection?.trim() ? `Creator direction: ${input.projectDirection.trim()}` : "",
    "",
    "Do not invent product facts, results, prices, personal experience, locations, or events.",
    "When missing specifics are essential, use a clear bracket placeholder such as [product], [problem], [result], or [place].",
    `Return only a JSON array of ${MAX_SUGGESTIONS} strings. No markdown or commentary.`,
  ].filter(Boolean).join("\n");
}

export function applyTemplateSlotSuggestion(
  beat: Beat,
  suggestion: string,
  mode: TemplateSlotSuggestionMode,
): Beat {
  if (mode === "shot") {
    return { ...beat, templateSlotSuggestion: suggestion };
  }
  const {
    captionDurations: _captionDurations,
    templateSlotSuggestion: _templateSlotSuggestion,
    ...rest
  } = beat;
  return { ...rest, captionText: suggestion, scriptText: suggestion };
}

function normalizeSuggestion(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value
    .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "")
    .replace(/^["']|["']$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized || normalized.length > MAX_SUGGESTION_LENGTH) return null;
  if (/^(?:certainly|sure|here (?:are|is)|suggestions?:?)$/i.test(normalized)) return null;
  return normalized;
}

export function parseTemplateSlotSuggestions(text: string): string[] {
  const unfenced = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  let candidates: unknown[] = [];

  try {
    const parsed = JSON.parse(unfenced) as unknown;
    if (Array.isArray(parsed)) {
      candidates = parsed;
    } else if (
      parsed &&
      typeof parsed === "object" &&
      Array.isArray((parsed as { suggestions?: unknown }).suggestions)
    ) {
      candidates = (parsed as { suggestions: unknown[] }).suggestions;
    }
  } catch {
    candidates = unfenced.split("\n");
  }

  const unique = new Set<string>();
  for (const candidate of candidates) {
    const suggestion = normalizeSuggestion(candidate);
    if (suggestion) unique.add(suggestion);
    if (unique.size === MAX_SUGGESTIONS) break;
  }
  return [...unique];
}

export async function generateTemplateSlotSuggestions(
  input: TemplateSlotSuggestionInput,
  config: ClaudeConfig,
  author: SlotSuggestionAuthor = callClaude,
): Promise<string[]> {
  const response = await author(buildTemplateSlotSuggestionPrompt(input), config);
  const suggestions = parseTemplateSlotSuggestions(response);
  if (suggestions.length === 0) {
    throw new Error("AI did not return usable suggestions. Try generating again.");
  }
  return suggestions;
}
