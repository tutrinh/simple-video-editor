// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const synthesizeVoiceover = vi.fn(async () => ({
  data: new Uint8Array([1, 2, 3]),
  ext: "mp3" as const,
  durationSec: 2,
  cacheHit: true,
}));

vi.mock("../lib/tts", () => ({ synthesizeVoiceover }));
vi.mock("../lib/blobUrlCache", () => ({ getClipBlobUrl: () => "blob:cached-voice" }));
vi.mock("./voTone", () => ({
  hasVoTone: () => false,
  createVoToneGraph: () => null,
}));

const { useGeneratedVoicePlayback } = await import("./useGeneratedVoicePlayback");

const baseProps = {
  segments: [{
    id: "vo-1",
    text: "A prepared narration",
    startTimeSec: 0,
    durationSec: 2,
    captionVisible: true,
    volume: 0.8,
  }],
  userVoiceSegments: [],
  elapsedSec: 0.5,
  playing: true,
  enabled: true,
  muted: false,
  synthesis: {
    engine: "elevenlabs" as const,
    elevenVoiceId: "voice-a",
    elevenModel: "eleven_multilingual_v2",
    speed: 1,
  },
  volume: 0.75,
};

beforeEach(() => {
  synthesizeVoiceover.mockClear();
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

describe("generated VO in the editor preview", () => {
  it("plays the prepared narration at the selected Beat's absolute time", async () => {
    renderHook(() => useGeneratedVoicePlayback(baseProps));

    await waitFor(() => expect(synthesizeVoiceover).toHaveBeenCalledOnce());
    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled());
    expect(synthesizeVoiceover).toHaveBeenCalledWith(
      "A prepared narration",
      baseProps.synthesis,
    );
  });

  it("does not request narration when generated VO is disabled", async () => {
    renderHook(() => useGeneratedVoicePlayback({ ...baseProps, enabled: false }));
    await Promise.resolve();
    expect(synthesizeVoiceover).not.toHaveBeenCalled();
  });
});
