export interface ClipTagPreset {
  id: string;
  label: string;
  color: {
    bg: string;
    text: string;
    border: string;
  };
}

export const PRESET_TAGS: ClipTagPreset[] = [
  { id: "a-roll", label: "A-Roll", color: { bg: "rgba(87, 201, 138, 0.2)", text: "#57c98a", border: "rgba(87, 201, 138, 0.4)" } },
  { id: "b-roll", label: "B-Roll", color: { bg: "rgba(57, 180, 255, 0.2)", text: "#39b4ff", border: "rgba(57, 180, 255, 0.4)" } },
  { id: "interview", label: "Interview", color: { bg: "rgba(255, 179, 57, 0.2)", text: "#ffb339", border: "rgba(255, 179, 57, 0.4)" } },
  { id: "action", label: "Action", color: { bg: "rgba(229, 105, 95, 0.2)", text: "#e5695f", border: "rgba(229, 105, 95, 0.4)" } },
  { id: "intro", label: "Intro", color: { bg: "rgba(180, 100, 255, 0.2)", text: "#b464ff", border: "rgba(180, 100, 255, 0.4)" } },
  { id: "outro", label: "Outro", color: { bg: "rgba(255, 110, 180, 0.2)", text: "#ff6eb4", border: "rgba(255, 110, 180, 0.4)" } },
  { id: "product", label: "Product", color: { bg: "rgba(0, 229, 255, 0.2)", text: "#00e5ff", border: "rgba(0, 229, 255, 0.4)" } },
];

export function getTagStyle(tag: string) {
  const norm = tag.toLowerCase().trim();
  const preset = PRESET_TAGS.find((p) => p.id === norm || p.label.toLowerCase() === norm);
  if (preset) return preset.color;

  return {
    bg: "var(--panel-3)",
    text: "var(--ink-2)",
    border: "var(--line)",
  };
}
