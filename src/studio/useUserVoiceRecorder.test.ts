import { afterEach, describe, expect, it, vi } from "vitest";
import { preferredRecordingMimeType, recordingExtension, requestMicrophoneStream } from "./useUserVoiceRecorder";

afterEach(() => {
  vi.useRealTimers();
});

describe("user voice recorder format selection", () => {
  it("prefers Opus WebM and falls back to a supported container", () => {
    expect(preferredRecordingMimeType((type) => type === "audio/webm;codecs=opus")).toBe("audio/webm;codecs=opus");
    expect(preferredRecordingMimeType((type) => type === "audio/mp4")).toBe("audio/mp4");
    expect(preferredRecordingMimeType(() => false)).toBe("");
  });

  it("uses extensions compatible with recorder MIME types", () => {
    expect(recordingExtension("audio/webm;codecs=opus")).toBe("webm");
    expect(recordingExtension("audio/mp4")).toBe("m4a");
    expect(recordingExtension("audio/ogg;codecs=opus")).toBe("ogg");
  });
});

describe("microphone permission request", () => {
  it("requests stereo capture when the microphone supports it", async () => {
    const stream = { getTracks: () => [] } as unknown as MediaStream;
    const getUserMedia = vi.fn().mockResolvedValue(stream);

    await expect(requestMicrophoneStream(getUserMedia)).resolves.toBe(stream);
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: expect.objectContaining({ channelCount: { ideal: 2 } }),
    });
  });

  it("rejects instead of leaving Record Beat stuck when the browser never resolves permission", async () => {
    vi.useFakeTimers();
    let outcome = "pending";

    void requestMicrophoneStream(
      () => new Promise<MediaStream>(() => {}),
      1_000,
    ).then(
      () => { outcome = "resolved"; },
      () => { outcome = "rejected"; },
    );

    await vi.advanceTimersByTimeAsync(1_001);
    expect(outcome).toBe("rejected");
  });

  it("stops a microphone stream that arrives after the request timed out", async () => {
    vi.useFakeTimers();
    const stop = vi.fn();
    let resolveRequest!: (stream: MediaStream) => void;
    const result = requestMicrophoneStream(
      () => new Promise<MediaStream>((resolve) => { resolveRequest = resolve; }),
      1_000,
    );
    const rejected = expect(result).rejects.toThrow("did not open the microphone prompt");

    await vi.advanceTimersByTimeAsync(1_001);
    await rejected;
    resolveRequest({ getTracks: () => [{ stop }] } as unknown as MediaStream);
    await Promise.resolve();

    expect(stop).toHaveBeenCalledOnce();
  });

  it("explains when permission is granted but the browser cannot start the microphone", async () => {
    vi.useFakeTimers();
    const result = requestMicrophoneStream(
      () => new Promise<MediaStream>(() => {}),
      1_000,
      () => Promise.resolve("granted"),
    );
    const rejected = expect(result).rejects.toThrow(
      "Microphone access is already allowed, but this browser could not start it",
    );

    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1_001);
    await rejected;
  });
});
