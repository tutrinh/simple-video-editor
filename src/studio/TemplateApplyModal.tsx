import { useEffect, useMemo, useState } from "react";
import type { Clip, ProjectTemplate } from "../domain/types";
import { applyTemplate } from "../features/templates/applyTemplate";
import {
  recommendTemplateCoverage,
  type TemplateCoveragePlan,
} from "../features/templates/templateCoverage";
import { analyzeClip } from "../features/analyze/analyze";
import { callClaude } from "../lib/claudeClient";
import { useProject } from "../state/ProjectContext";
import { useSettings } from "../state/SettingsContext";
import { SelectControl } from "../design-system/ControlPrimitives";
import { ModalScrim, ModalSurface } from "../design-system/ModalPrimitives";
import CloseButton from "../design-system/CloseButton";
import Button from "../design-system/Button";
import Badge from "../design-system/Badge";
import { ProgressNotice } from "../design-system/Feedback";
import TemplateDetails from "./TemplateDetails";

interface Props {
  template: ProjectTemplate;
  clips: Clip[];
  onClose: () => void;
  onApplied: () => void;
}

export default function TemplateApplyModal({ template, clips, onClose, onApplied }: Props) {
  const { state, dispatch } = useProject();
  const { settings } = useSettings();
  const usableClips = clips.filter((clip) => !clip.isTemplatePlaceholder);
  const [assignments, setAssignments] = useState<string[]>(
    template.beats.map((_, index) => usableClips[index]?.id ?? ""),
  );
  const [error, setError] = useState("");
  const [coverage, setCoverage] = useState<TemplateCoveragePlan | null>(null);
  const [coverageBusy, setCoverageBusy] = useState(false);
  const [coverageProgress, setCoverageProgress] = useState("");

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

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !coverageBusy) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [coverageBusy, onClose]);

  async function handleRecommendCoverage() {
    if (coverageBusy || usableClips.length === 0) return;
    setCoverageBusy(true);
    setCoverage(null);
    setError("");
    try {
      const analyzedClips: Clip[] = [];
      for (let index = 0; index < usableClips.length; index++) {
        const clip = usableClips[index];
        if (clip.description) {
          analyzedClips.push(clip);
          continue;
        }
        setCoverageProgress(`Analyzing Clip ${index + 1} of ${usableClips.length} · ${clip.name}`);
        const description = await analyzeClip(clip, {
          provider: settings.aiProvider,
          model: settings.analyzeModel,
        });
        dispatch({ type: "SET_DESCRIPTION", id: clip.id, description });
        analyzedClips.push({ ...clip, description });
      }

      setCoverageProgress("Matching Clips to template roles…");
      const plan = await recommendTemplateCoverage({
        template,
        clips: analyzedClips,
      }, (prompt) => callClaude(prompt, {
        provider: settings.aiProvider,
        model: settings.authorModel,
      }));
      setCoverage(plan);
      setAssignments(plan.recommendations.map((recommendation) => recommendation.clipId ?? ""));
      setCoverageProgress("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setCoverageProgress("");
    } finally {
      setCoverageBusy(false);
    }
  }

  function handleApply() {
    try {
      const result = applyTemplate(
        template,
        usableClips,
        assignments.map((clipId, beatIndex) => ({ beatIndex, clipId })),
      );
      dispatch({ type: "APPLY_TEMPLATE", cut: result.cut, placeholderClips: result.placeholderClips });
      onApplied();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not apply this template.");
    }
  }

  return (
    <ModalScrim
      className="st-modal-scrim st-template-apply-scrim"
      onClick={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget && !coverageBusy) onClose();
      }}
    >
      <ModalSurface
        className="st-modal-card st-template-apply-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Use ${template.name}`}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="st-template-apply-header">
          <div>
            <h3>Use “{template.name}”</h3>
            <p>Let AI match your footage, then review or override every Beat.</p>
          </div>
          <CloseButton onClick={onClose} label="Close template assignment" disabled={coverageBusy} />
        </header>

        <div className="st-template-apply-body">
          <section className="st-template-coverage-tools" aria-label="AI coverage coach">
            <div>
              <strong>AI Autofill &amp; Coverage</strong>
              <span>Analyzes visible Clip content, proposes unique matches, and identifies shots you still need.</span>
            </div>
            <Button
              variant="primary"
              size="small"
              disabled={coverageBusy || usableClips.length === 0}
              onClick={handleRecommendCoverage}
            >
              {coverageBusy ? "Working…" : coverage ? "Run again" : "Analyze & Autofill"}
            </Button>
          </section>

          {coverageBusy && (
            <ProgressNotice
              title="Building coverage plan"
              message={coverageProgress || "Preparing Clip analysis…"}
            />
          )}

          {coverage && (
            <div className="st-template-coverage-summary" role="status">
              <Badge tone="positive">{coverage.matchedCount} matched</Badge>
              <Badge tone={coverage.missingCount ? "critical" : "positive"}>
                {coverage.missingCount} missing
              </Badge>
              <span>Review every recommendation before applying the template.</span>
            </div>
          )}

          <section className="st-template-apply-details">
            <TemplateDetails template={template} compact />
          </section>

          {usableClips.length < template.beats.length && (
            <div className="st-template-apply-notice">
              This template has {template.beats.length} Beats and the Project has {usableClips.length} Clips.
              Unmatched Beats remain labeled placeholders that you can fill later.
            </div>
          )}

          {state.cut?.beats.length ? (
            <div className="st-template-apply-replace">
              Applying this template replaces the current Cut. Uploaded Clips remain in the Project.
            </div>
          ) : null}

          <div className="st-template-assignment-list">
            {template.beats.map((beat, index) => {
              const selected = assignments[index];
              const isDuplicate = Boolean(selected && duplicateIds.has(selected));
              const recommendation = coverage?.recommendations[index];
              const manuallyOverridden = Boolean(coverage && selected !== (recommendation?.clipId ?? ""));
              return (
                <label
                  key={index}
                  className={`st-template-assignment${isDuplicate ? " invalid" : ""}`}
                >
                  <span className="st-template-assignment-role">
                    <span>
                      <strong>{index + 1}. {beat.description}</strong>
                      <small>{beat.approxDurationSec ? `About ${beat.approxDurationSec}s` : "Default duration"}</small>
                    </span>
                    {recommendation && (
                      <Badge tone={recommendation.missing ? "critical" : "positive"}>
                        {manuallyOverridden
                          ? "Manual"
                          : recommendation.missing
                            ? "Needs shot"
                            : `${Math.round(recommendation.confidence * 100)}% match`}
                      </Badge>
                    )}
                  </span>

                  <SelectControl
                    value={selected}
                    aria-label={`Clip for Beat ${index + 1}: ${beat.description}`}
                    onChange={(event) => {
                      const next = [...assignments];
                      next[index] = event.target.value;
                      setAssignments(next);
                      setError("");
                    }}
                  >
                    <option value="">Leave empty — fill later</option>
                    {usableClips.map((clip) => (
                      <option
                        key={clip.id}
                        value={clip.id}
                        disabled={assignments.some((id, assignmentIndex) =>
                          assignmentIndex !== index && id === clip.id
                        )}
                      >
                        {clip.name} · {clip.durationSec.toFixed(1)}s
                      </option>
                    ))}
                  </SelectControl>

                  {recommendation && !manuallyOverridden && (
                    <span className="st-template-assignment-reason">
                      {recommendation.reason}
                      {recommendation.missingShot && (
                        <strong>Reshoot: {recommendation.missingShot}</strong>
                      )}
                    </span>
                  )}
                </label>
              );
            })}
          </div>

          {error && <div className="ui-field-error st-template-apply-error" role="alert">{error}</div>}
        </div>

        <footer className="st-template-apply-footer">
          <Button variant="secondary" onClick={onClose} disabled={coverageBusy}>Cancel</Button>
          <Button variant="primary" disabled={!canApply || coverageBusy} onClick={handleApply}>
            Apply Template
          </Button>
        </footer>
      </ModalSurface>
    </ModalScrim>
  );
}
