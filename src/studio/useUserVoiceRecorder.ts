import { useCallback, useEffect, useRef, useState } from "react";
import { prepareVoiceStream } from "./userVoiceNoiseCleanup";

export type UserVoiceRecorderStatus = "idle" | "requesting" | "recording" | "stopping";

export interface RecordedUserVoice {
  file: File;
  durationSec: number;
}

const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

const RECORDING_AUDIO_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    channelCount: { ideal: 2 },
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
};

async function microphonePermissionState(): Promise<PermissionState | "unknown"> {
  if (!navigator.permissions?.query) return "unknown";
  try {
    return (await navigator.permissions.query({ name: "microphone" as PermissionName })).state;
  } catch {
    return "unknown";
  }
}

export function requestMicrophoneStream(
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>,
  timeoutMs = 12_000,
  getPermissionState: () => Promise<PermissionState | "unknown"> = microphonePermissionState,
): Promise<MediaStream> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let permissionState: PermissionState | "unknown" = "unknown";
    void getPermissionState().then((state) => {
      permissionState = state;
    }, () => {});
    const timeoutId = globalThis.setTimeout(() => {
      settled = true;
      reject(new Error(
        permissionState === "granted"
          ? "Microphone access is already allowed, but this browser could not start it. Check macOS System Settings → Privacy & Security → Microphone, try Chrome or Safari, or use Import VO."
          : "The browser did not open the microphone prompt. Allow microphone access for this site in your browser settings, then try again.",
      ));
    }, Math.max(1, timeoutMs));

    getUserMedia(RECORDING_AUDIO_CONSTRAINTS).then(
      (stream) => {
        if (settled) {
          // Some browsers can resolve the original request after our timeout.
          // Do not leave that late stream recording in the background.
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        settled = true;
        globalThis.clearTimeout(timeoutId);
        resolve(stream);
      },
      (cause) => {
        if (settled) return;
        settled = true;
        globalThis.clearTimeout(timeoutId);
        reject(cause);
      },
    );
  });
}

export function preferredRecordingMimeType(
  isTypeSupported: (mimeType: string) => boolean = (mimeType) => MediaRecorder.isTypeSupported(mimeType),
): string {
  return MIME_CANDIDATES.find(isTypeSupported) ?? "";
}

export function recordingExtension(mimeType: string): string {
  if (mimeType.includes("mp4")) return "m4a";
  if (mimeType.includes("ogg")) return "ogg";
  return "webm";
}

/**
 * Owns microphone permission, MediaRecorder lifecycle, track cleanup and timing.
 * The editor only needs start/stop and receives one finished File.
 */
export function useUserVoiceRecorder(
  onComplete: (recording: RecordedUserVoice) => void,
  noiseCleanupEnabled = true,
) {
  const [status, setStatus] = useState<UserVoiceRecorderStatus>("idle");
  const [elapsedSec, setElapsedSec] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [noiseCleanupActive, setNoiseCleanupActive] = useState(false);
  const [noiseCleanupWarning, setNoiseCleanupWarning] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const noiseCleanupRef = useRef<(() => void) | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);
  const requestAttemptRef = useRef(0);
  const mountedRef = useRef(true);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  const releaseStream = useCallback(() => {
    noiseCleanupRef.current?.();
    noiseCleanupRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const start = useCallback(async (onStarted?: () => void) => {
    if (status !== "idle") return;
    const requestAttempt = ++requestAttemptRef.current;
    setError(null);
    setNoiseCleanupActive(false);
    setNoiseCleanupWarning(null);
    setElapsedSec(0);
    setStatus("requesting");
    cancelledRef.current = false;

    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        throw new Error("Microphone recording is not supported in this browser.");
      }
      const microphoneStream = await requestMicrophoneStream(
        navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices),
      );
      if (!mountedRef.current || cancelledRef.current || requestAttempt !== requestAttemptRef.current) {
        microphoneStream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = microphoneStream;
      const preparedStream = await prepareVoiceStream(microphoneStream, noiseCleanupEnabled);
      if (!mountedRef.current || cancelledRef.current || requestAttempt !== requestAttemptRef.current) {
        preparedStream.cleanup();
        microphoneStream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        return;
      }
      noiseCleanupRef.current = preparedStream.cleanup;
      setNoiseCleanupActive(preparedStream.active);
      setNoiseCleanupWarning(preparedStream.warning);
      const mimeType = preferredRecordingMimeType();
      const recorder = new MediaRecorder(preparedStream.stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        clearTimer();
        releaseStream();
        recorderRef.current = null;
        if (mountedRef.current) {
          setError("The microphone recording stopped unexpectedly.");
          setNoiseCleanupActive(false);
          setStatus("idle");
        }
      };
      recorder.onstop = () => {
        clearTimer();
        releaseStream();
        recorderRef.current = null;
        const durationSec = Math.max(0.1, (performance.now() - startedAtRef.current) / 1000);
        const blobType = recorder.mimeType || mimeType || chunksRef.current[0]?.type || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: blobType });
        chunksRef.current = [];
        if (mountedRef.current) {
          setNoiseCleanupActive(false);
          setStatus("idle");
        }
        if (!cancelledRef.current && blob.size > 0) {
          const stamp = new Date().toISOString().replace(/[:.]/g, "-");
          const file = new File([blob], `user-voice-${stamp}.${recordingExtension(blobType)}`, { type: blobType });
          onCompleteRef.current({ file, durationSec });
        }
      };

      recorder.start(250);
      startedAtRef.current = performance.now();
      setStatus("recording");
      onStarted?.();
      timerRef.current = window.setInterval(() => {
        setElapsedSec((performance.now() - startedAtRef.current) / 1000);
      }, 100);
    } catch (cause) {
      if (cancelledRef.current || requestAttempt !== requestAttemptRef.current) return;
      releaseStream();
      recorderRef.current = null;
      const message = cause instanceof DOMException && cause.name === "NotAllowedError"
        ? "Microphone access was denied. Allow it in your browser settings and try again."
        : cause instanceof Error ? cause.message : "Could not start microphone recording.";
      if (mountedRef.current) {
        setError(message);
        setStatus("idle");
      }
    }
  }, [clearTimer, noiseCleanupEnabled, releaseStream, status]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    setStatus("stopping");
    recorder.requestData();
    recorder.stop();
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    requestAttemptRef.current += 1;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    else releaseStream();
    clearTimer();
    if (mountedRef.current) {
      setStatus("idle");
      setElapsedSec(0);
    }
  }, [clearTimer, releaseStream]);

  useEffect(() => {
    // React Strict Mode deliberately runs setup → cleanup → setup in development.
    // Restore this guard during setup so the first simulated cleanup does not
    // make every later recorder callback look like it happened after unmount.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancelledRef.current = true;
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") recorder.stop();
      releaseStream();
      clearTimer();
    };
  }, [clearTimer, releaseStream]);

  return {
    status,
    elapsedSec,
    error,
    noiseCleanupActive,
    noiseCleanupWarning,
    start,
    stop,
    cancel,
  };
}
