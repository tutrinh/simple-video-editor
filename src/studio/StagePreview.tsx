import React, { Component, useEffect, useRef, useState, type ReactNode } from "react";
import type { Beat, Clip, Cut } from "../domain/types";
import FinalPreview, { BeatTitleOverlay, StickerOverlay } from "../features/export/FinalPreview";
import { canvasDims } from "../features/export/export";
import { activeVoCaption } from "../lib/pacing";
import { fmtClock, cssFilterFor, beatRotationStyle, beatZoomStyle, isBeatZoomActive, advanceStillPos, kenBurnsStyleAt, kenBurnsKeyframes } from "./util";
import { getClipBlobUrl } from "../lib/blobUrlCache";
import { getSplitLayoutCss, normalizeSplitConfig, getSlotTransformStyle } from "../features/export/splitScreenCanvas";
import SegmentedControl from "../design-system/SegmentedControl";
import { ControlButton, InputControl } from "../design-system/ControlPrimitives";
import PlayIcon from "../design-system/icons/PlayIcon";
import PauseIcon from "../design-system/icons/PauseIcon";
import ReplayIcon from "../design-system/icons/ReplayIcon";
import { previewFileForClip } from "./previewSource";
import { activePreviewMedia, pausePreviewMedia, playPreviewMedia } from "./previewPlayback";
import { useProject } from "../state/ProjectContext";
import { useUserVoiceRecorder } from "./useUserVoiceRecorder";
import { useUserVoicePlayback } from "./useUserVoicePlayback";
import { effectiveBeatVolume, effectiveSplitScreenSlotVolume } from "./beatAudio";



interface ErrorBoundaryProps {
  fallback: (reset: () => void) => ReactNode;
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

class PreviewErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("StagePreview cut render error:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback(() => this.setState({ hasError: false }));
    }
    return this.props.children;
  }
}

interface Props {
  cut: Cut;
  clips: Clip[];
  beat: Beat | null;
  clip: Clip | undefined;
  keyboardShortcutsActive?: boolean;
  onSelectBeat?: (beatId: string) => void;
  onPlayingChange?: (playing: boolean) => void;
  onRecordCreated?: (segmentId: string) => void;
}

/**
 * Two views of the same Cut:
 *  - "Beat": the selected Beat's trimmed window, scrubbable, caption burned in.
 *  - "Cut": the whole edit played back sequentially (reuses the export FinalPreview).
 */
export default function StagePreview({ cut, clips, beat, clip, keyboardShortcutsActive = false, onSelectBeat, onPlayingChange, onRecordCreated }: Props) {
  const { dispatch } = useProject();
  const [mode, setMode] = useState<"beat" | "cut">("beat");
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayVideoRef = useRef<HTMLVideoElement>(null);
  const slotVideoRefs = useRef<(HTMLVideoElement | null)[]>([]);
  const scrubRef = useRef<HTMLDivElement>(null);


  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0); // 0..1 within the beat window
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [previewAudioMuted, setPreviewAudioMuted] = useState(false);
  const [noiseCleanupEnabled, setNoiseCleanupEnabled] = useState(true);
  const [recordingPreflightOpen, setRecordingPreflightOpen] = useState(false);
  const [cutTransportCommand, setCutTransportCommand] = useState<{ id: number; action: "restart" | "pause" } | null>(null);
  const recordScopeRef = useRef<{ startTimeSec: number; maxDurationSec: number; label: string } | null>(null);
  const recordingLockedRef = useRef(false);

  // A Still is an <img> with no clock of its own (ADR-0012), so the transport
  // below drives `pos` on rAF instead of reading video.currentTime. posRef
  // mirrors pos so the rAF loop can advance without re-subscribing each frame.
  const isStill = clip?.kind === "still";
  const stillUrl = isStill && clip ? getClipBlobUrl(previewFileForClip(clip)) : null;
  const posRef = useRef(0);
  const setPosBoth = (p: number) => { posRef.current = p; setPos(p); };

  useEffect(() => {
    if (mode === "beat") {
      onPlayingChange?.(playing);
    }
  }, [mode, playing, onPlayingChange]);

  useEffect(() => {
    if (!keyboardShortcutsActive) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.isContentEditable
        || target?.closest("input, textarea, select, [contenteditable='true']")
      ) return;

      const key = event.key.toLowerCase();
      if (recordingLockedRef.current) return;
      if (key === "c") {
        event.preventDefault();
        setMode("cut");
      } else if (key === "b") {
        event.preventDefault();
        setMode("beat");
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [keyboardShortcutsActive]);

  useEffect(() => {
    if (!keyboardShortcutsActive || mode !== "beat") return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.code !== "Space" || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.isContentEditable
        || target?.closest("input, textarea, select, [contenteditable='true']")
      ) return;

      event.preventDefault();
      togglePlay();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [keyboardShortcutsActive, mode, playing, pos, beat, clip]);

  // 1. Load the selected clip's source using permanent blob cache & sync time to inSec
  useEffect(() => {
    if (mode !== "beat") return;
    const v = videoRef.current;
    if (!v || !clip || !beat || clip.isTemplatePlaceholder) return;

    const url = getClipBlobUrl(previewFileForClip(clip));
    if (url && v.src !== url) {
      v.src = url;
    }

    const targetSec = beat.inSec + posRef.current * (beat.outSec - beat.inSec);
    const syncTime = () => {
      if (v.readyState >= 1) {
        v.currentTime = Math.min(targetSec, Math.max(0, (v.duration || 0) - 0.05));
      }
    };

    syncTime();
    v.addEventListener("loadedmetadata", syncTime, { once: true });
    return () => { v.removeEventListener("loadedmetadata", syncTime); };
  }, [clip?.id, beat?.id, beat?.inSec, beat?.outSec, mode]);

  // Sync currentTime while paused or when dragging position / inSec
  useEffect(() => {
    if (mode !== "beat" || playing) return;
    const v = videoRef.current;
    if (!v || !beat || v.readyState < 1) return;
    const targetSec = beat.inSec + pos * (beat.outSec - beat.inSec);
    v.currentTime = Math.min(targetSec, Math.max(0, (v.duration || 0) - 0.05));
  }, [mode, playing, pos, beat?.inSec, beat?.outSec]);


  // 2. Update beat video volume and muted state dynamically
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !beat) return;
    const volume = effectiveBeatVolume(beat, cut);
    v.volume = previewAudioMuted ? 0 : volume;
    v.muted = previewAudioMuted || volume === 0;
  }, [beat?.muted, beat?.volume, cut.beatAudioMasterVolume, cut.beatAudioMuted, previewAudioMuted]);

  // 2b. The Still transport: advance `pos` in real time over the Beat's window
  // and stop at the out-point, the way the video path stops at `outSec`.
  useEffect(() => {
    if (!isStill || !playing || !beat) return;
    const span = beat.outSec - beat.inSec;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const next = advanceStillPos(posRef.current, dt, span);
      setPosBoth(next.pos);
      if (next.ended) { setPlaying(false); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStill, playing, beat?.id, beat?.inSec, beat?.outSec]);

  // 3. Calculations for active beat & overlay
  const beatIndex = beat ? cut.beats.indexOf(beat) : -1;
  const beatStartSec = (beat && beatIndex >= 0) ? cut.beats.slice(0, beatIndex).reduce((sum, b) => sum + b.durationSec, 0) : 0;
  const beatElapsed = beat ? pos * (beat.outSec - beat.inSec) : 0;
  const elapsedCutSec = beatStartSec + beatElapsed;
  const totalCutDuration = cut.beats.reduce((sum, item) => sum + (item.durationSec || Math.max(0.05, item.outSec - item.inSec)), 0);
  useUserVoicePlayback(cut.userVoiceSegments, elapsedCutSec, mode === "beat" && playing && !previewAudioMuted);

  const recorder = useUserVoiceRecorder(({ file, durationSec }) => {
    const scope = recordScopeRef.current;
    if (!scope) return;
    const playedDuration = Math.max(0.1, Math.min(durationSec, scope.maxDurationSec));
    const genId = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
    const id = `user-vo-${genId()}`;
    dispatch({
      type: "ADD_USER_VOICE",
      segment: {
        id,
        name: `${scope.label} voice`,
        file,
        startTimeSec: scope.startTimeSec,
        durationSec: playedDuration,
        sourceDurationSec: durationSec,
        sourceStartSec: 0,
        volume: 1,
        levelDb: 0,
        bassDb: 0,
        trebleDb: 0,
      },
    });
    onRecordCreated?.(id);
    recordScopeRef.current = null;
    recordingLockedRef.current = false;
    setPreviewAudioMuted(false);
  }, noiseCleanupEnabled);

  useEffect(() => {
    if (recorder.status === "idle" && recordScopeRef.current && (recorder.error || recorder.elapsedSec > 0)) {
      recordingLockedRef.current = false;
      recordScopeRef.current = null;
      setPreviewAudioMuted(false);
    }
  }, [recorder.elapsedSec, recorder.error, recorder.status]);

  const activeOverlay = cut?.overlays?.find((o) => elapsedCutSec >= o.startTimeSec && elapsedCutSec < o.startTimeSec + o.durationSec) ?? null;
  const activeOverlayClip = activeOverlay ? clips.find((c) => c.id === activeOverlay.clipId) : null;
  const overlayBlobUrl = getClipBlobUrl(activeOverlayClip?.normalized ?? activeOverlayClip?.file);

  // 5. Active overlay sync effect
  useEffect(() => {
    const el = overlayVideoRef.current;
    if (!el || !activeOverlay) return;
    const targetTime = (elapsedCutSec - activeOverlay.startTimeSec) + activeOverlay.inSec;
    if (Math.abs(el.currentTime - targetTime) > 0.15) {
      try { el.currentTime = targetTime; } catch {}
    }
    const volume = activeOverlay.volume ?? 0;
    el.volume = previewAudioMuted ? 0 : volume;
    el.muted = previewAudioMuted || volume === 0;
    if (playing && el.paused) {
      el.play().catch(() => {});
    } else if (!playing && !el.paused) {
      el.pause();
    }
  }, [elapsedCutSec, activeOverlay, playing, previewAudioMuted]);

  // 6. Split screen slot sync effect
  useEffect(() => {
    if (!beat?.splitScreen || beat.splitScreen.layout === "none") return;
    const norm = normalizeSplitConfig(beat.splitScreen, clip?.id ?? "", beat.inSec);

    norm.slots.forEach((slot, idx) => {
      const el = slotVideoRefs.current[idx];
      if (!el) return;

      const slotClip = clips.find((c) => c.id === slot.clipId) ?? clip;
      if (slotClip?.kind === "still") return;

      const targetTime = (slot.inSec ?? beat.inSec) + beatElapsed;
      if (Math.abs(el.currentTime - targetTime) > 0.15) {
        try { el.currentTime = targetTime; } catch {}
      }
      const vol = effectiveSplitScreenSlotVolume(slot, idx, beat, cut);
      el.volume = previewAudioMuted ? 0 : vol;
      el.muted = previewAudioMuted || vol === 0;

      if (playing && el.paused) {
        el.play().catch(() => {});
      } else if (!playing && !el.paused) {
        el.pause();
      }
    });
  }, [beatElapsed, beat?.muted, beat?.splitScreen, playing, clip, clips, beat?.inSec, beat?.volume, cut.beatAudioMasterVolume, cut.beatAudioMuted, previewAudioMuted]);


  function togglePlay() {
    if (!beat) return;
    if (isStill) {
      if (playing) { setPlaying(false); return; }
      if (pos >= 0.999) setPosBoth(0); // replay from the top
      setPlaying(true);
      return;
    }
    const v = videoRef.current;
    if (!v) return;
    const splitActive = Boolean(beat.splitScreen && beat.splitScreen.layout !== "none");
    const media = activePreviewMedia(v, splitActive, slotVideoRefs.current);
    if (playing) { pausePreviewMedia(media); setPlaying(false); return; }
    if (v.currentTime < beat.inSec || v.currentTime >= beat.outSec - 0.05) {
      media.forEach((item) => { item.currentTime = beat.inSec; });
      setPosBoth(0);
    }
    playPreviewMedia(media).then((primaryStarted) => {
      if (primaryStarted) setPlaying(true);
    });
  }

  function restartBeatForRecording() {
    if (!beat) return;
    setPosBoth(0);
    if (isStill) {
      setPlaying(true);
      return;
    }
    const v = videoRef.current;
    if (!v) return;
    const splitActive = Boolean(beat.splitScreen && beat.splitScreen.layout !== "none");
    const media = activePreviewMedia(v, splitActive, slotVideoRefs.current);
    media.forEach((item) => {
      item.currentTime = beat.inSec;
      item.volume = 0;
      item.muted = true;
    });
    playPreviewMedia(media).then((primaryStarted) => {
      if (primaryStarted) setPlaying(true);
    });
  }

  function pausePreviewForRecording() {
    if (mode === "cut") {
      setCutTransportCommand({ id: Date.now(), action: "pause" });
      return;
    }
    const v = videoRef.current;
    if (v) {
      const splitActive = Boolean(beat?.splitScreen && beat.splitScreen.layout !== "none");
      pausePreviewMedia(activePreviewMedia(v, splitActive, slotVideoRefs.current));
    }
    setPlaying(false);
  }

  function startRecording() {
    setRecordingPreflightOpen(false);
    const targetMode = mode;
    recordingLockedRef.current = true;
    recordScopeRef.current = {
      startTimeSec: targetMode === "beat" ? beatStartSec : 0,
      maxDurationSec: targetMode === "beat"
        ? Math.max(0.1, beat?.durationSec ?? 0.1)
        : Math.max(0.1, totalCutDuration),
      label: targetMode === "beat" ? `Beat ${Math.max(1, beatIndex + 1)}` : "Cut",
    };
    recorder.start(() => {
      setPreviewAudioMuted(true);
      if (targetMode === "beat") restartBeatForRecording();
      else setCutTransportCommand({ id: Date.now(), action: "restart" });
    });
  }

  function stopRecording() {
    pausePreviewForRecording();
    recorder.stop();
  }

  function recordingControl() {
    const label = mode === "beat" ? "Record Beat" : "Record Cut";
    if (recordingPreflightOpen) {
      return (
        <div className="st-preview-record-control">
          <ControlButton
            className="st-btn ghost st-preview-record-button"
            onClick={() => setRecordingPreflightOpen(false)}
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
                onChange={(event) => setNoiseCleanupEnabled(event.target.checked)}
              />
              <span>
                <strong>Clean background noise</strong>
                <small>RNNoise runs privately on this device.</small>
              </span>
            </label>
            <ControlButton className="st-btn st-preview-record-confirm" onClick={startRecording}>
              Continue
            </ControlButton>
          </div>
        </div>
      );
    }
    if (recorder.status === "requesting") {
      return (
        <div className="st-preview-record-control">
          <ControlButton
            className="st-btn ghost st-preview-record-button"
            onClick={recorder.cancel}
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
    if (recorder.status === "recording" || recorder.status === "stopping") {
      return (
        <ControlButton
          className="st-btn st-preview-record-button"
          onClick={stopRecording}
          disabled={recorder.status === "stopping"}
          title="Stop recording and add it to the User VO track. Preview audio is muted while recording."
          style={{ color: "#fff", background: "#d43a36", borderColor: "#d43a36" }}
        >
          ■ {recorder.status === "stopping"
            ? "Saving…"
            : `Stop ${fmtClock(recorder.elapsedSec)} 🔇${recorder.noiseCleanupActive ? " · Clean" : ""}`}
        </ControlButton>
      );
    }
    return (
      <div className="st-preview-record-control">
        <ControlButton
          className="st-btn ghost st-preview-record-button"
          onClick={() => setRecordingPreflightOpen(true)}
          disabled={mode === "beat" && !beat}
          title={`Preview the ${mode} silently from its start while recording your microphone${noiseCleanupEnabled ? " with RNNoise cleanup" : ""}`}
        >
          <span style={{ color: "#d43a36" }}>●</span>{" "}
          {label}
        </ControlButton>
        {recorder.error && (
          <span className="st-preview-record-error" role="alert" title={recorder.error}>
            {recorder.error}
          </span>
        )}
        {!recorder.error && recorder.noiseCleanupWarning && (
          <span className="st-preview-record-warning" role="status" title={recorder.noiseCleanupWarning}>
            {recorder.noiseCleanupWarning}
          </span>
        )}
      </div>
    );
  }

  function handleScrubPointer(e: React.PointerEvent<HTMLDivElement>) {
    const el = scrubRef.current;
    if (!beat || !el) return;
    const rect = el.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    if (playing) setPlaying(false);
    if (isStill) { setPosBoth(pct); return; } // no frame to seek to — the position IS the state
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    v.currentTime = beat.inSec + pct * (beat.outSec - beat.inSec);
    setPosBoth(pct);
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsScrubbing(true);
    handleScrubPointer(e);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (isScrubbing) handleScrubPointer(e);
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (isScrubbing) {
      e.currentTarget.releasePointerCapture(e.pointerId);
      setIsScrubbing(false);
    }
  }

  function stepFrame(frames: number) {
    if (!beat) return;
    const frameTime = 1 / 30; // ~33.3ms 30fps frame stepping
    const span = Math.max(0.01, beat.outSec - beat.inSec);
    if (isStill) {
      // Every frame of a Still is the same frame; stepping still moves the
      // playhead so the scrubber, Stickers and Title overlays track with it.
      if (playing) setPlaying(false);
      setPosBoth(Math.max(0, Math.min(1, pos + (frames * frameTime) / span)));
      return;
    }
    const v = videoRef.current;
    if (!v) return;
    if (playing) {
      v.pause();
      setPlaying(false);
    }
    const newTime = Math.max(beat.inSec, Math.min(beat.outSec, v.currentTime + frames * frameTime));
    v.currentTime = newTime;
    setPosBoth((newTime - beat.inSec) / span);
  }

  function onTimeUpdate() {
    const v = videoRef.current;
    if (!v || !beat) return;
    const span = Math.max(0.01, beat.outSec - beat.inSec);
    const newPos = Math.min(1, Math.max(0, (v.currentTime - beat.inSec) / span));
    setPosBoth(newPos);
    if (playing && v.currentTime >= beat.outSec - 0.02) {
      v.pause();
      v.currentTime = beat.outSec;
      setPosBoth(1);
      setPlaying(false);
    }
  }

  if (mode === "cut") {
    return (
      <PreviewErrorBoundary
        fallback={(reset) => (
          <>
            <div style={{ borderRadius: 12, overflow: "hidden", padding: 24, textAlign: "center", background: "#000", color: "#fff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 280 }}>
              <h3 style={{ margin: "0 0 8px 0", fontSize: 15, color: "var(--accent)" }}>🎞️ Cut Preview</h3>
              <p style={{ fontSize: 12, opacity: 0.8, maxWidth: 360, margin: "0 0 16px 0" }}>Switched back to single Beat preview mode.</p>
              <ControlButton
                className="st-btn ghost"
                onClick={() => { reset(); setMode("beat"); }}
                style={{ borderColor: "var(--accent)", color: "var(--accent)", fontSize: 11, padding: "4px 12px" }}
              >
                Return to Beat View
              </ControlButton>
            </div>
            <div className="st-transport">
              <span className="st-tc">Cut view</span>
              <span className="st-spacer" />
              <ModeSwitch mode={mode} setMode={setMode} disabled={recorder.status !== "idle"} />
            </div>
          </>
        )}
      >
        <div style={{ borderRadius: 12, overflow: "hidden" }}>
          <FinalPreview
            cut={cut}
            clips={clips}
            selectedBeatId={beat?.id}
            captionScale={1}
            captionOpacity={0.5}
            captionLineHeight={1.6}
            title={null}
            music={null}
            musicVolume={0.5}
            voiceover={false}
            enableSpacebarPlayback={keyboardShortcutsActive}
            onActiveBeatChange={(beatId) => onSelectBeat?.(beatId)}
            onPlayingChange={onPlayingChange}
            transportCommand={cutTransportCommand}
            muteAllAudio={previewAudioMuted}
          />
        </div>
        <div className="st-transport">
          <span className="st-tc">Playing the whole cut</span>
          <span className="st-spacer" />
          {recordingControl()}
          <ModeSwitch mode={mode} setMode={setMode} disabled={recorder.status !== "idle"} />
        </div>
      </PreviewErrorBoundary>
    );
  }

  if (!beat) {
    return (
      <div className="st-stage-empty">
        <h2>No cut yet</h2>
        <p>Add clips on the left, then press <strong>Regenerate cut</strong> to let Claude build a first draft.</p>
      </div>
    );
  }

  // The move, if this Beat has one. Its keyframes are injected rather than
  // written inline because CSS has no inline @keyframes; the name is derived
  // from the move so two Beats with different moves cannot share a rule.
  const kbMove = beat.framing === "kenBurns" ? beat.kenBurns ?? null : null;
  const kbFrames = kbMove ? kenBurnsKeyframes(kbMove) : null;
  const kbAnimName = `kb-${beat.id.replace(/[^a-z0-9]/gi, "")}`;

  const aspectRatio = cut.aspect === "9:16" ? "9 / 16" : cut.aspect === "1:1" ? "1 / 1" : "16 / 9";
  // Captions now come from the VO track by absolute cut time (decoupled from beats).
  const caption = activeVoCaption(cut.voSegments, elapsedCutSec);
  const isAtEnd = !playing && pos >= 0.98;

  return (
    <>
      {kbFrames && (
        <style>{`@keyframes ${kbAnimName}{from{transform:${kbFrames.from}}to{transform:${kbFrames.to}}}`}</style>
      )}
      <div
        className="st-preview"
        style={{ aspectRatio, cursor: "pointer", position: "relative" }}
        onClick={togglePlay}
        title={playing ? "Pause" : isAtEnd ? "Replay beat" : "Play beat"}
      >
        {/* Zoom and rotation are separate layers with separate pivots: zoom
            outside on the focus point, rotation inside on the centre. Nested
            transforms apply child-first, which matches the export's
            rotate-then-zoom order. */}
        {/* Ken Burns REPLACES the Zoom layer — they are a mode, not a stack
            (ADR-0015). While playing, one CSS animation between the move's two
            ends; while paused or scrubbing, the transform sampled from the same
            contract, because a running animation cannot be scrubbed. */}
        <div style={{ position: "absolute", inset: 0, ...(clip?.isTemplatePlaceholder ? {} : kbMove
          ? (playing
              ? { animation: `${kbAnimName} ${Math.max(0.05, beat.outSec - beat.inSec)}s linear forwards` }
              : kenBurnsStyleAt(kbMove, pos))
          : beatZoomStyle(beat.zoom, beat.zoomX, beat.zoomY, isBeatZoomActive(beat.zoom, beat.zoomScope, beat.zoomSec, beatElapsed))) }}>
          <div style={{ position: "absolute", inset: 0, ...(clip?.isTemplatePlaceholder ? {} : beatRotationStyle(...canvasDims(cut.aspect), beat.rotation)) }}>
            {(() => {
              const splitCfg = beat.splitScreen;
              const filterStyle = cssFilterFor(beat.colorAdjustments, cut.globalFilterId, cut.globalFilterIntensity, cut.globalFilterAdjustments);

              if (splitCfg && splitCfg.layout !== "none" && splitCfg.slots.length > 1) {
                const normConfig = normalizeSplitConfig(splitCfg, clip?.id ?? "", beat.inSec);
                const gridCss = getSplitLayoutCss(normConfig.layout);
                return (
                  <div style={{ ...gridCss, filter: filterStyle }}>
                    {normConfig.slots.map((slot, idx) => {
                      const slotClip = clips.find((c) => c.id === slot.clipId) ?? clip;
                      const slotBlob = slotClip ? getClipBlobUrl(previewFileForClip(slotClip)) : null;
                      const tfStyle = getSlotTransformStyle(slot);
                      return (
                        <div key={`${slot.clipId}-${idx}`} style={{ position: "relative", overflow: "hidden", background: "#000" }}>
                          {slotClip?.kind === "still" ? (
                            <img src={slotBlob ?? undefined} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", ...tfStyle }} />
                          ) : (
                            <video
                              ref={(el) => {
                                slotVideoRefs.current[idx] = el;
                                if (idx === 0) (videoRef as any).current = el;
                              }}
                              src={slotBlob ?? undefined}
                              onTimeUpdate={idx === 0 ? onTimeUpdate : undefined}
                              muted={previewAudioMuted || effectiveSplitScreenSlotVolume(slot, idx, beat, cut) === 0}
                              playsInline
                              style={{ width: "100%", height: "100%", objectFit: "cover", ...tfStyle }}
                            />
                          )}

                        </div>
                      );
                    })}

                  </div>
                );
              }

              if (clip?.isTemplatePlaceholder) {
                return (
                  <div style={{ width: "100%", minWidth: 0, height: "100%", display: "grid", placeContent: "center stretch", justifyItems: "center", gap: 6, padding: "16px 10px", boxSizing: "border-box", background: "repeating-linear-gradient(135deg, var(--panel-3) 0 12px, var(--panel-2) 12px 24px)", color: "var(--ink-2)", textAlign: "center" }}>
                    <strong style={{ width: "100%", minWidth: 0, maxWidth: cut.aspect === "9:16" ? 130 : cut.aspect === "1:1" ? 210 : 280, fontSize: 12, lineHeight: 1.25, color: "var(--ink)", overflowWrap: "anywhere" }}>Empty template slot</strong>
                    <span style={{ width: "100%", minWidth: 0, maxWidth: cut.aspect === "9:16" ? 130 : cut.aspect === "1:1" ? 210 : 280, fontSize: 10.5, lineHeight: 1.35, overflowWrap: "anywhere" }}>{clip.templateSlotDescription}</span>
                    <span style={{ width: "100%", minWidth: 0, maxWidth: cut.aspect === "9:16" ? 130 : cut.aspect === "1:1" ? 210 : 280, fontSize: 9, lineHeight: 1.35, color: "var(--ink-3)", overflowWrap: "anywhere" }}>Use Swap Clip in the inspector to add footage.</span>
                  </div>
                );
              }

              return isStill ? (
                // Same wrappers, same grade — only the element differs (ADR-0012).
                <img src={stillUrl ?? undefined} alt="" style={{ width: "100%", height: "100%", objectFit: "contain", filter: filterStyle }} />
              ) : (
                <video ref={videoRef} onTimeUpdate={onTimeUpdate} muted={previewAudioMuted || effectiveBeatVolume(beat, cut) === 0} playsInline style={{ width: "100%", height: "100%", objectFit: "contain", filter: filterStyle }} />
              );
            })()}
          </div>
        </div>

        {activeOverlay && activeOverlayClip && overlayBlobUrl && (
          <video
            key={activeOverlay.id}
            ref={overlayVideoRef}
            src={overlayBlobUrl}
            muted={previewAudioMuted || (activeOverlay.volume ?? 0) === 0}
            playsInline
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              // `contain` to match the export, which fits with
              // `force_original_aspect_ratio=decrease` and pads transparently.
              objectFit: "contain",
              pointerEvents: "none",
              opacity: activeOverlay.opacity,
              mixBlendMode: activeOverlay.blendMode as any,
              zIndex: 5,

            }}
          />
        )}
        <StickerOverlay stickers={cut.stickers} beats={cut.beats} aspect={cut.aspect} cutSec={elapsedCutSec} />
        <BeatTitleOverlay layers={beat.titleLayers} aspect={cut.aspect} elapsed={beatElapsed} />
        <div className="st-badgeTL st-num">
          Beat {String(cut.beats.indexOf(beat) + 1).padStart(2, "0")} · {clip?.name ?? "—"}
        </div>
        <div className="cap"><span>{caption}</span></div>
      </div>
      <div className="st-transport">
        <ControlButton
          type="button"
          className="ds-play"
          onClick={togglePlay}
          title={playing ? "Pause" : isAtEnd ? "Replay beat" : "Play beat"}
          aria-label={playing ? "Pause beat" : isAtEnd ? "Replay beat" : "Play beat"}
          aria-pressed={playing}
        >
          {playing ? <PauseIcon size={13} /> : isAtEnd ? <ReplayIcon size={13} /> : <PlayIcon size={13} />}
        </ControlButton>
        <ControlButton
          type="button"
          onClick={() => stepFrame(-1)}
          style={{ display: "inline-flex", alignItems: "center", gap: 2, fontSize: 11, background: "transparent", border: "none", color: "var(--ink-2)", cursor: "pointer", padding: "4px 6px" }}
          title="Step 1 frame backward (30fps)"
        >
          ‹ 1f
        </ControlButton>
        <ControlButton
          type="button"
          onClick={() => stepFrame(1)}
          style={{ display: "inline-flex", alignItems: "center", gap: 2, fontSize: 11, background: "transparent", border: "none", color: "var(--ink-2)", cursor: "pointer", padding: "4px 6px" }}
          title="Step 1 frame forward (30fps)"
        >
          1f ›
        </ControlButton>
        <span className="st-tc st-num">{fmtClock(beat.inSec + pos * (beat.outSec - beat.inSec))}</span>
        <div
          ref={scrubRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          className="st-scrub"
          style={{ cursor: "col-resize", touchAction: "none" }}
          title="Drag or click to scrub frame-by-frame"
        >
          <div className="fill" style={{ width: `${pos * 100}%` }} />
          <div className="thumb" style={{ left: `${pos * 100}%` }} />
        </div>
        <span className="st-tc st-num">{fmtClock(beat.outSec)}</span>
        <span className="st-tsep" />
        {recordingControl()}
        <ModeSwitch mode={mode} setMode={setMode} disabled={recorder.status !== "idle"} />
      </div>
    </>
  );
}

function ModeSwitch({ mode, setMode, disabled = false }: { mode: "beat" | "cut"; setMode: (m: "beat" | "cut") => void; disabled?: boolean }) {
  return (
    <div className="st-preview-mode-switch">
      <SegmentedControl
        value={mode}
        options={[{ value: "beat", label: "Beat" }, { value: "cut", label: "Cut" }]}
        onChange={setMode}
        ariaLabel="Preview scope"
        disabled={disabled}
      />
      {/* All of these except Delete need the pointer over the editor panel — that gate is
          shared by this component's handlers and StudioApp's, but the Delete effect in
          StudioApp deliberately has none, so the caveat sits on the entries it is true of. */}
      <div
        className="st-preview-shortcuts"
        aria-label="Editor keyboard shortcuts"
        title="Most shortcuts work while the pointer is over the editor panel"
      >
        <span><kbd>Space</kbd> Play/Pause</span>
        <span><kbd>B</kbd><kbd>C</kbd> View</span>
        <span title="Step through whatever is active — the beats, or the selected segment's own track">
          <kbd>←</kbd><kbd>→</kbd> Prev/Next
        </span>
        <span title="Grow or shrink whatever is active by 0.1s — the beat, or the selected segment">
          <kbd>↑</kbd><kbd>↓</kbd> Length
        </span>
        <span title="Fit the selected voiceover segment to its spoken duration">
          <kbd>F</kbd> Fit voice
        </span>
        <span title="Remove the selected segment, or the whole voiceover selection. Works anywhere outside a text field, not just over the editor.">
          <kbd>Del</kbd> Remove
        </span>
      </div>
    </div>
  );
}
