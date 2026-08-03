import { beforeEach, describe, expect, it, vi } from "vitest";

const synthesizeEleven = vi.fn(async () => ({
  data: new Uint8Array([4, 2]),
  durationSec: 1.25,
  words: [{ text: "Hello", start: 0, end: 1.25 }],
}));

vi.mock("./elevenLabs", () => ({
  DEFAULT_ELEVEN_VOICE: "voice-default",
  synthesizeEleven,
}));

vi.mock("./kokoroTts", () => ({
  synthesizeVoiceover: vi.fn(),
}));

const { synthesizeVoiceover } = await import("./tts");
const { resetNarrationMemoryCacheForTests } = await import("./narrationCache");

const options = {
  engine: "elevenlabs" as const,
  elevenVoiceId: "voice-a",
  elevenModel: "eleven_multilingual_v2",
  elevenStability: 0.5,
  elevenStyle: 0,
  speed: 1,
};

beforeEach(() => {
  synthesizeEleven.mockClear();
  resetNarrationMemoryCacheForTests();
});

describe("synthesizeVoiceover persistent reuse", () => {
  it("charges the provider once across repeated preview/export calls", async () => {
    const preview = await synthesizeVoiceover("Hello from the project", options);
    const exported = await synthesizeVoiceover("Hello from the project", options);

    expect(synthesizeEleven).toHaveBeenCalledOnce();
    expect(preview.cacheHit).toBe(false);
    expect(exported.cacheHit).toBe(true);
    expect([...exported.data]).toEqual([4, 2]);
  });

  it("calls the provider again only for an explicit regeneration", async () => {
    await synthesizeVoiceover("Keep this performance", options);
    await synthesizeVoiceover("Keep this performance", options, { forceRefresh: true });
    await synthesizeVoiceover("Keep this performance", options);

    expect(synthesizeEleven).toHaveBeenCalledTimes(2);
  });
});
