import type { ProjectTemplate, TemplateBeat } from "../../domain/types";

const BUILT_IN_CREATED_AT = 0;

function reelTemplate(
  id: string,
  name: string,
  description: string,
  toneHint: string,
  beats: TemplateBeat[],
  colorHint: ProjectTemplate["colorHint"],
): ProjectTemplate {
  return {
    id,
    name,
    description,
    createdAt: BUILT_IN_CREATED_AT,
    updatedAt: BUILT_IN_CREATED_AT,
    aspect: "9:16",
    toneHint,
    colorHint,
    beats,
  };
}

export const BUILT_IN_REEL_TEMPLATES: readonly ProjectTemplate[] = Object.freeze([
  reelTemplate(
    "builtin-product-review-reel",
    "Product Review Reel",
    "A grounded 30-second review: problem, proof, details, tradeoff, and verdict.",
    "Credible, useful, tactile, creator-led",
    [
      { description: "Hook: show the product and name the problem", approxDurationSec: 3, zoom: 1.08 },
      { description: "Unbox or introduce the product in context", approxDurationSec: 4, transition: "fade", transitionSec: 0.25 },
      { description: "Demonstrate the main feature in real use", approxDurationSec: 5, transition: "slideleft", transitionSec: 0.25 },
      { description: "Close-up detail or second feature", approxDurationSec: 4, zoom: 1.12, transition: "fade", transitionSec: 0.2 },
      { description: "Show the result or before-and-after proof", approxDurationSec: 5, transition: "wipeleft", transitionSec: 0.25 },
      { description: "Honest tradeoff, limitation, or who should skip it", approxDurationSec: 4, transition: "fade", transitionSec: 0.2 },
      { description: "Creator verdict and call to action", approxDurationSec: 5, zoom: 1.08, transition: "fadeblack", transitionSec: 0.35 },
    ],
    { contrast: 8, warmth: 5, saturation: 4, highlights: -5 },
  ),
  reelTemplate(
    "builtin-lifestyle-vlog-reel",
    "Lifestyle Vlog Reel",
    "A 30-second day-in-the-life arc with atmosphere, movement, and a reflective close.",
    "Warm, candid, lived-in, gently cinematic",
    [
      { description: "Cold open: the most inviting moment from the day", approxDurationSec: 3, zoom: 1.06 },
      { description: "Morning or location-establishing wide shot", approxDurationSec: 4, transition: "fade", transitionSec: 0.3 },
      { description: "Getting-ready or leaving-the-house action", approxDurationSec: 4, transition: "slideleft", transitionSec: 0.25 },
      { description: "Travel, walking, or environmental movement", approxDurationSec: 4, transition: "wipeleft", transitionSec: 0.25 },
      { description: "Small sensory detail: food, hands, texture, or place", approxDurationSec: 4, zoom: 1.12, transition: "fade", transitionSec: 0.2 },
      { description: "Main activity or candid human moment", approxDurationSec: 5, transition: "slideleft", transitionSec: 0.25 },
      { description: "Quiet reset or reflective pause", approxDurationSec: 3, transition: "fade", transitionSec: 0.35 },
      { description: "Golden-hour payoff or closing thought", approxDurationSec: 4, zoom: 1.08, transition: "fadeblack", transitionSec: 0.4 },
    ],
    { warmth: 12, saturation: 3, shadows: 4, highlights: -8 },
  ),
  reelTemplate(
    "builtin-fashion-vlog-reel",
    "Fashion Vlog Reel",
    "A fast 25-second outfit story built around reveals, details, motion, and styling.",
    "Editorial, confident, rhythmic, polished",
    [
      { description: "Pattern-break hook or finished-look flash", approxDurationSec: 2, zoom: 1.12 },
      { description: "Full outfit reveal", approxDurationSec: 4, transition: "slideleft", transitionSec: 0.2 },
      { description: "Fabric, accessory, or construction close-up", approxDurationSec: 3, zoom: 1.16, transition: "wipeleft", transitionSec: 0.2 },
      { description: "Styling transition or alternate layer", approxDurationSec: 4, transition: "slideright", transitionSec: 0.2 },
      { description: "Movement shot: walk, turn, or fit in motion", approxDurationSec: 4, zoom: 1.08, transition: "slideleft", transitionSec: 0.2 },
      { description: "Second detail and styling rationale", approxDurationSec: 4, transition: "fade", transitionSec: 0.2 },
      { description: "Hero pose, final look, and outfit takeaway", approxDurationSec: 4, zoom: 1.1, transition: "fadeblack", transitionSec: 0.3 },
    ],
    { contrast: 14, saturation: -3, blackPoint: -5, highlights: -4 },
  ),
  reelTemplate(
    "builtin-motivation-vlog-reel",
    "Motivation Vlog Reel",
    "A 30-second voiceover-led story that moves from tension to action and payoff.",
    "Focused, emotional, forward-moving, sincere",
    [
      { description: "Direct hook: the tension, doubt, or hard truth", approxDurationSec: 3, zoom: 1.08 },
      { description: "Visualize the struggle or starting point", approxDurationSec: 4, transition: "fadeblack", transitionSec: 0.3 },
      { description: "First deliberate action", approxDurationSec: 4, transition: "slideleft", transitionSec: 0.25 },
      { description: "Progress montage or repeated effort", approxDurationSec: 5, zoom: 1.1, transition: "wipeleft", transitionSec: 0.2 },
      { description: "Setback, pause, or honest middle beat", approxDurationSec: 4, transition: "fade", transitionSec: 0.3 },
      { description: "Breakthrough, momentum, or visible result", approxDurationSec: 5, transition: "slideleft", transitionSec: 0.25 },
      { description: "Clear takeaway and invitation to act", approxDurationSec: 5, zoom: 1.08, transition: "fadeblack", transitionSec: 0.4 },
    ],
    { contrast: 12, warmth: 6, saturation: -2, shadows: -4, highlights: -6 },
  ),
]);

const BUILT_IN_IDS = new Set(BUILT_IN_REEL_TEMPLATES.map((template) => template.id));

export function isBuiltInReelTemplate(template: Pick<ProjectTemplate, "id">): boolean {
  return BUILT_IN_IDS.has(template.id);
}

export function listAvailableTemplates(customTemplates: ProjectTemplate[]): ProjectTemplate[] {
  return [
    ...BUILT_IN_REEL_TEMPLATES,
    ...customTemplates.filter((template) => !BUILT_IN_IDS.has(template.id)),
  ];
}
