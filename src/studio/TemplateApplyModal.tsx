import { useMemo, useState } from "react";
import type { Clip, ProjectTemplate } from "../domain/types";
import { applyTemplate } from "../features/templates/applyTemplate";
import { useProject } from "../state/ProjectContext";
import { ControlButton, SelectControl } from "../design-system/ControlPrimitives";
import { ModalScrim, ModalSurface } from "../design-system/ModalPrimitives";
import CloseIcon from "../design-system/icons/CloseIcon";
import TemplateDetails from "./TemplateDetails";

interface Props {
  template: ProjectTemplate;
  clips: Clip[];
  onClose: () => void;
  onApplied: () => void;
}

export default function TemplateApplyModal({ template, clips, onClose, onApplied }: Props) {
  const { state, dispatch } = useProject();
  const usableClips = clips.filter((clip) => !clip.isTemplatePlaceholder);
  const [assignments, setAssignments] = useState<string[]>(
    template.beats.map((_, index) => usableClips[index]?.id ?? ""),
  );
  const [error, setError] = useState("");

  const duplicateIds = useMemo(() => {
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const id of assignments) {
      if (!id) continue;
      if (seen.has(id)) duplicates.add(id);
      seen.add(id);
    }
    return duplicates;
  }, [assignments]);

  const canApply = duplicateIds.size === 0;

  const handleApply = () => {
    try {
      const result = applyTemplate(
        template,
        usableClips,
        assignments.map((clipId, beatIndex) => ({ beatIndex, clipId })),
      );
      dispatch({ type: "APPLY_TEMPLATE", cut: result.cut, placeholderClips: result.placeholderClips });
      onApplied();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not apply this template.");
    }
  };

  return (
    <ModalScrim
      className="st-modal-scrim"
      onClick={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) onClose();
      }}
      style={{ zIndex: 1200 }}
    >
      <ModalSurface
        className="st-modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={`Use ${template.name}`}
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "min(880px, calc(100vw - 40px))",
          maxWidth: 880,
          maxHeight: "88vh",
          padding: 0,
          gap: 0,
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", gap: 16 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 15, color: "var(--ink)" }}>Use “{template.name}”</h3>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--ink-2)" }}>
              Assign a different project clip to each template beat.
            </p>
          </div>
          <ControlButton aria-label="Close" onClick={onClose} style={{ background: "none", border: 0, color: "var(--ink-2)", alignSelf: "flex-start" }}>
            <CloseIcon size={15} />
          </ControlButton>
        </div>

        <div style={{ padding: 20, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ padding: 12, background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: 9 }}>
            <TemplateDetails template={template} compact />
          </div>

          {usableClips.length < template.beats.length && (
            <div style={{ padding: "10px 12px", border: "1px solid var(--accent)", borderRadius: 8, color: "var(--ink-2)", background: "color-mix(in srgb, var(--accent) 8%, transparent)", fontSize: 12 }}>
              This template has {template.beats.length} beats and the project has {usableClips.length} clips. Unassigned beats will stay in order as empty timeline slots that you can fill later.
            </div>
          )}

          {state.cut?.beats.length ? (
            <div style={{ padding: "10px 12px", background: "var(--panel-3)", border: "1px solid var(--line)", borderRadius: 8, color: "var(--ink-2)", fontSize: 11 }}>
              Applying this template replaces the current cut. Your uploaded clips stay in the project.
            </div>
          ) : null}

          {template.beats.map((beat, index) => {
            const selected = assignments[index];
            const isDuplicate = Boolean(selected && duplicateIds.has(selected));
            return (
              <label key={index} style={{ display: "grid", gridTemplateColumns: "minmax(150px, 1fr) minmax(220px, 1.3fr)", gap: 14, alignItems: "center", padding: 12, background: "var(--panel)", border: `1px solid ${isDuplicate ? "var(--danger)" : "var(--line)"}`, borderRadius: 8 }}>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 11, fontWeight: 700, color: "var(--ink)" }}>{index + 1}. {beat.description}</span>
                  <span style={{ display: "block", marginTop: 3, fontSize: 10, color: "var(--ink-3)" }}>
                    {beat.approxDurationSec ? `About ${beat.approxDurationSec}s` : "Default duration"}
                  </span>
                </span>
                <SelectControl
                  value={selected}
                  onChange={(event) => {
                    const next = [...assignments];
                    next[index] = event.target.value;
                    setAssignments(next);
                    setError("");
                  }}
                  style={{ width: "100%", minWidth: 0, boxSizing: "border-box", padding: "7px 9px", background: "var(--panel-2)", color: "var(--ink)", border: `1px solid ${isDuplicate ? "var(--danger)" : "var(--line)"}`, borderRadius: 6 }}
                >
                  <option value="">Leave empty — fill later</option>
                  {usableClips.map((clip) => (
                    <option key={clip.id} value={clip.id} disabled={assignments.some((id, i) => i !== index && id === clip.id)}>
                      {clip.name} · {clip.durationSec.toFixed(1)}s
                    </option>
                  ))}
                </SelectControl>
              </label>
            );
          })}

          {error && <div style={{ color: "var(--danger)", fontSize: 12 }}>{error}</div>}
        </div>

        <div style={{ padding: "14px 20px", borderTop: "1px solid var(--line)", display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <ControlButton className="st-btn ghost" onClick={onClose}>Cancel</ControlButton>
          <ControlButton className="st-btn primary" disabled={!canApply} onClick={handleApply}>Apply Template</ControlButton>
        </div>
      </ModalSurface>
    </ModalScrim>
  );
}
