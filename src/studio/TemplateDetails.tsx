import { useEffect, useState } from "react";
import type { Aspect, ProjectTemplate } from "../domain/types";
import { isBuiltInReelTemplate } from "../features/templates/builtInTemplates";

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
    <div className={`st-template-details${compact ? " compact" : ""}`}>
      {!isBuiltInReelTemplate(template) && (
        <ReferenceVideo file={template.inspirationVideo} aspect={template.aspect ?? "16:9"} />
      )}

      <div className="st-template-detail-chips">
        <DetailChip label="Aspect" value={template.aspect ?? "16:9"} />
        <DetailChip label="Tone" value={template.toneHint || "Not specified"} />
        <DetailChip label="Structure" value={`${template.beats.length} beats`} />
        {hasEstimatedDuration && <DetailChip label="Estimated length" value={`~${totalDuration.toFixed(1)}s`} />}
      </div>

      <div>
        <div className="st-template-detail-label">EDIT SEQUENCE</div>
        <div className="st-template-detail-beats">
          {template.beats.map((beat, index) => (
            <div key={index} className="st-template-detail-beat">
              <span className="st-template-detail-number">{index + 1}</span>
              <span className="st-template-detail-copy">
                <span className="st-template-detail-description">{beat.description}</span>
                <span className="st-template-detail-transition">
                  {beat.transition && beat.transition !== "none" ? `${beat.transition} · ${beat.transitionSec ?? 0.5}s` : index === 0 ? "Opening beat" : "Straight cut"}
                  {beat.zoom && beat.zoom > 1 ? ` · ${beat.zoom.toFixed(1)}× zoom` : ""}
                </span>
              </span>
              <span className="st-template-detail-duration">
                {beat.approxDurationSec != null ? `~${beat.approxDurationSec}s` : "Auto"}
              </span>
            </div>
          ))}
        </div>
      </div>

      {colorEntries.length > 0 && (
        <div>
          <div className="st-template-detail-label">COLOR GRADE</div>
          <div className="st-template-color-chips">
            {colorEntries.map(([key, value]) => (
              <span key={key} className="st-template-color-chip">
                {COLOR_LABELS[key]} <strong className={value ? "active" : ""}>{signed(value)}</strong>
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

  const aspectClass = aspect === "9:16" || aspect === "4:5" ? "portrait" : aspect === "1:1" ? "square" : "landscape";

  return (
    <div className="st-template-reference">
      <div className="st-template-detail-label">REFERENCE VIDEO</div>
      {src ? (
        <video
          src={src}
          controls
          playsInline
          preload="metadata"
          aria-label="Inspiration video"
          className={`st-template-reference-video ${aspectClass}`}
        />
      ) : (
        <div className="st-template-reference-empty">
          Reference video unavailable for this older template.
        </div>
      )}
    </div>
  );
}

function DetailChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="st-template-detail-chip">
      <span>{label}:</span> {value}
    </span>
  );
}
