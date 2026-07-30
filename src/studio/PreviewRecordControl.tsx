import { ControlButton, InputControl } from "../design-system/ControlPrimitives";
import { fmtClock } from "./util";
import type { UserVoiceRecorderStatus } from "./useUserVoiceRecorder";

interface PreviewRecordControlProps {
  mode: "beat" | "cut";
  hasBeat: boolean;
  preflightOpen: boolean;
  noiseCleanupEnabled: boolean;
  status: UserVoiceRecorderStatus;
  elapsedSec: number;
  error: string | null;
  noiseCleanupActive: boolean;
  noiseCleanupWarning: string | null;
  onOpenPreflight: () => void;
  onClosePreflight: () => void;
  onNoiseCleanupChange: (enabled: boolean) => void;
  onStart: () => void;
  onCancel: () => void;
  onStop: () => void;
}

export default function PreviewRecordControl({
  mode,
  hasBeat,
  preflightOpen,
  noiseCleanupEnabled,
  status,
  elapsedSec,
  error,
  noiseCleanupActive,
  noiseCleanupWarning,
  onOpenPreflight,
  onClosePreflight,
  onNoiseCleanupChange,
  onStart,
  onCancel,
  onStop,
}: PreviewRecordControlProps) {
  const label = mode === "beat" ? "Record Beat" : "Record Cut";

  if (preflightOpen) {
    return (
      <div className="st-preview-record-control">
        <ControlButton
          className="st-btn ghost st-preview-record-button"
          onClick={onClosePreflight}
        >
          Cancel
        </ControlButton>
        <div className="st-preview-record-preflight" role="dialog" aria-label="Microphone access">
          <strong>Allow microphone?</strong>
          <span>Your browser will ask next. Choose Allow to start the silent preview and recording.</span>
          <label className="st-preview-noise-cleanup">
            <InputControl
              type="checkbox"
              checked={noiseCleanupEnabled}
              onChange={(event) => onNoiseCleanupChange(event.target.checked)}
            />
            <span>
              <strong>Clean background noise</strong>
              <small>RNNoise runs privately on this device.</small>
            </span>
          </label>
          <ControlButton className="st-btn st-preview-record-confirm" onClick={onStart}>
            Continue
          </ControlButton>
        </div>
      </div>
    );
  }

  if (status === "requesting") {
    return (
      <div className="st-preview-record-control">
        <ControlButton
          className="st-btn ghost st-preview-record-button"
          onClick={onCancel}
          title="Cancel the microphone request"
        >
          Cancel
        </ControlButton>
        <span className="st-preview-record-hint" role="status">
          {noiseCleanupEnabled ? "Starting noise cleanup and microphone…" : "Connecting to microphone…"} If your browser asks, choose Allow.
        </span>
      </div>
    );
  }

  if (status === "recording" || status === "stopping") {
    return (
      <div className="st-preview-record-control">
        <ControlButton
          className="st-btn st-preview-record-button"
          onClick={onStop}
          disabled={status === "stopping"}
          title="Stop recording and add it to the User VO track. Preview audio is muted while recording."
          style={{ color: "#fff", background: "#d43a36", borderColor: "#d43a36" }}
        >
          ■ {status === "stopping" ? "Saving…" : "Stop"}
        </ControlButton>
        <span className="st-preview-record-info" role="status">
          {fmtClock(elapsedSec)}{noiseCleanupActive ? " · Clean" : ""}
        </span>
      </div>
    );
  }

  return (
    <div className="st-preview-record-control">
      <ControlButton
        className="st-btn ghost st-preview-record-button"
        onClick={onOpenPreflight}
        disabled={mode === "beat" && !hasBeat}
        title={`Preview the ${mode} silently from its start while recording your microphone${noiseCleanupEnabled ? " with RNNoise cleanup" : ""}`}
      >
        <span style={{ color: "#d43a36" }}>●</span>{" "}
        {label}
      </ControlButton>
      {error && (
        <span className="st-preview-record-error" role="alert" title={error}>
          {error}
        </span>
      )}
      {!error && noiseCleanupWarning && (
        <span className="st-preview-record-warning" role="status" title={noiseCleanupWarning}>
          {noiseCleanupWarning}
        </span>
      )}
    </div>
  );
}
