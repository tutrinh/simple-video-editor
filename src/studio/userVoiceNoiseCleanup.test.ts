import { describe, expect, it, vi } from "vitest";
import {
  prepareVoiceStream,
  type NoiseCleanupRuntime,
} from "./userVoiceNoiseCleanup";

function streamWithTracks(tracks: Array<{ stop(): void; applyConstraints(constraints: MediaTrackConstraints): Promise<void> }>) {
  return {
    getTracks: () => tracks,
    getAudioTracks: () => tracks,
  } as unknown as MediaStream;
}

describe("user voice noise cleanup", () => {
  it("leaves the microphone stream untouched when cleanup is disabled", async () => {
    const microphone = streamWithTracks([]);
    const runtime = { createContext: vi.fn() } as unknown as NoiseCleanupRuntime;

    const prepared = await prepareVoiceStream(microphone, false, runtime);

    expect(prepared.stream).toBe(microphone);
    expect(prepared.active).toBe(false);
    expect(prepared.warning).toBeNull();
    expect(runtime.createContext).not.toHaveBeenCalled();
  });

  it("records the RNNoise output and releases every processing resource", async () => {
    const applyConstraints = vi.fn().mockResolvedValue(undefined);
    const microphone = streamWithTracks([{ stop: vi.fn(), applyConstraints }]);
    const outputStop = vi.fn();
    const output = streamWithTracks([{ stop: outputStop, applyConstraints: vi.fn() }]);
    const source = { connect: vi.fn(), disconnect: vi.fn() };
    const destination = { stream: output, connect: vi.fn(), disconnect: vi.fn() };
    const filter = { connect: vi.fn(), disconnect: vi.fn(), destroy: vi.fn() };
    const context = {
      state: "suspended" as AudioContextState,
      audioWorklet: { addModule: vi.fn().mockResolvedValue(undefined) },
      createMediaStreamSource: vi.fn(() => source),
      createMediaStreamDestination: vi.fn(() => destination),
      resume: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const runtime: NoiseCleanupRuntime = {
      createContext: () => context,
      addWorklet: (audioContext) => audioContext.audioWorklet.addModule("rnnoise-worklet.js"),
      loadBinary: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      createFilter: vi.fn(() => filter),
    };

    const prepared = await prepareVoiceStream(microphone, true, runtime);
    prepared.cleanup();
    prepared.cleanup();

    expect(prepared.stream).toBe(output);
    expect(prepared.active).toBe(true);
    expect(runtime.createFilter).toHaveBeenCalledWith(context, expect.any(ArrayBuffer), 2);
    expect(source.connect).toHaveBeenCalledWith(filter);
    expect(filter.connect).toHaveBeenCalledWith(destination);
    expect(applyConstraints).toHaveBeenCalledWith({ noiseSuppression: false });
    expect(outputStop).toHaveBeenCalledOnce();
    expect(source.disconnect).toHaveBeenCalledOnce();
    expect(filter.destroy).toHaveBeenCalledOnce();
    expect(context.close).toHaveBeenCalledOnce();
  });

  it("falls back to the original stream when AudioWorklet setup fails", async () => {
    const microphone = streamWithTracks([]);
    const close = vi.fn().mockResolvedValue(undefined);
    const runtime = {
      createContext: () => ({
        state: "running",
        audioWorklet: { addModule: vi.fn() },
        close,
      }),
      addWorklet: vi.fn().mockRejectedValue(new Error("worklet unavailable")),
      loadBinary: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      createFilter: vi.fn(),
    } as unknown as NoiseCleanupRuntime;

    const prepared = await prepareVoiceStream(microphone, true, runtime);

    expect(prepared.stream).toBe(microphone);
    expect(prepared.active).toBe(false);
    expect(prepared.warning).toContain("browser’s microphone processing");
    expect(close).toHaveBeenCalledOnce();
  });
});
