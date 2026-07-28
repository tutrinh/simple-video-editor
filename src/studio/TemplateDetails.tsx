import { useEffect, useState } from "react";
import type { Aspect, ProjectTemplate } from "../domain/types";

interface Props {
  template: ProjectTemplate;
  compact?: boolean;
}

const COLOR_LABELS = {
  warmth: "Warmth",
  saturation: "Saturation",
  contrast: "Contrast",
  shadows: "Shadows",
  highlights: "Highlights",
} as const;

function signed(value: number | undefined): string {
  if (!value) return "Neutral";
  return value > 0 ? `+${value}` : String(value);
}

export default function TemplateDetails({ template, compact = false }: Props) {
  const totalDuration = template.beats.reduce((sum, beat) => sum + (beat.approxDurationSec ?? 0), 0);
  const hasEstimatedDuration = template.beats.some((beat) => beat.approxDurationSec != null);
  const colorEntries = template.colorHint
    ? (Object.keys(COLOR_LABELS) as Array<keyof typeof COLOR_LABELS>).map((key) => [key, template.colorHint?.[key]] as const)
    : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: compact ? 10 : 14 }}>
      <ReferenceVideo file={template.inspirationVideo} aspect={template.aspect ?? "16:9"} />

      <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
        <DetailChip label="Aspect" value={template.aspect ?? "16:9"} />
        <DetailChip label="Tone" value={template.toneHint || "Not specified"} />
        <DetailChip label="Structure" value={`${template.beats.length} beats`} />
        {hasEstimatedDuration && <DetailChip label="Estimated length" value={`~${totalDuration.toFixed(1)}s`} />}
      </div>

      <div>
        <div style={{ marginBottom: 7, fontSize: 10, fontWeight: 700, letterSpacing: ".08em", color: "var(--ink-3)" }}>
          EDIT SEQUENCE
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {template.beats.map((beat, index) => (
            <div
              key={index}
              style={{
                display: "grid",
                gridTemplateColumns: "24px minmax(0, 1fr) auto",
                alignItems: "center",
                gap: 9,
                padding: compact ? "7px 9px" : "9px 11px",
                background: "var(--panel)",
                border: "1px solid var(--line)",
                borderRadius: 7,
              }}
            >
              <span style={{ fontSize: 10, fontWeight: 700, color: "var(--accent)", textAlign: "center" }}>{index + 1}</span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--ink)" }}>{beat.description}</span>
                <span style={{ display: "block", marginTop: 2, fontSize: 9.5, color: "var(--ink-3)" }}>
                  {beat.transition && beat.transition !== "none" ? `${beat.transition} · ${beat.transitionSec ?? 0.5}s` : index === 0 ? "Opening beat" : "Straight cut"}
                  {beat.zoom && beat.zoom > 1 ? ` · ${beat.zoom.toFixed(1)}× zoom` : ""}
                </span>
              </span>
              <span style={{ fontSize: 10, color: "var(--ink-2)", fontVariantNumeric: "tabular-nums" }}>
                {beat.approxDurationSec != null ? `~${beat.approxDurationSec}s` : "Auto"}
              </span>
            </div>
          ))}
        </div>
      </div>

      {colorEntries.length > 0 && (
        <div>
          <div style={{ marginBottom: 7, fontSize: 10, fontWeight: 700, letterSpacing: ".08em", color: "var(--ink-3)" }}>
            COLOR GRADE
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {colorEntries.map(([key, value]) => (
              <span key={key} style={{ padding: "4px 7px", background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 6, fontSize: 9.5, color: "var(--ink-2)" }}>
                {COLOR_LABELS[key]} <strong style={{ color: value ? "var(--accent)" : "var(--ink-3)" }}>{signed(value)}</strong>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ReferenceVideo({ file, aspect }: { file?: File; aspect: Aspect }) {
  const [src, setSrc] = useState("");

  useEffect(() => {
    if (!file) {
      setSrc("");
      return;
    }
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const aspectRatio = aspect === "9:16" ? "9 / 16" : aspect === "1:1" ? "1 / 1" : "16 / 9";
  const maxWidth = aspect === "9:16" ? 180 : aspect === "1:1" ? 260 : 360;

  return (
    <div>
      <div style={{ marginBottom: 7, fontSize: 10, fontWeight: 700, letterSpacing: ".08em", color: "var(--ink-3)" }}>
        REFERENCE VIDEO
      </div>
      {src ? (
        <video
          src={src}
          controls
          playsInline
          preload="metadata"
          aria-label="Inspiration video"
          style={{
            display: "block",
            width: "100%",
            maxWidth,
            aspectRatio,
            objectFit: "contain",
            background: "#050607",
            border: "1px solid var(--line)",
            borderRadius: 8,
          }}
        />
      ) : (
        <div style={{ padding: "9px 11px", border: "1px dashed var(--line)", borderRadius: 7, fontSize: 10.5, color: "var(--ink-3)" }}>
          Reference video unavailable for this older template.
        </div>
      )}
    </div>
  );
}

function DetailChip({ label, value }: { label: string; value: string }) {
  return (
    <span style={{ padding: "4px 8px", background: "var(--panel-3)", border: "1px solid var(--line)", borderRadius: 999, fontSize: 9.5, color: "var(--ink-2)" }}>
      <span style={{ color: "var(--ink-3)" }}>{label}:</span> {value}
    </span>
  );
}
