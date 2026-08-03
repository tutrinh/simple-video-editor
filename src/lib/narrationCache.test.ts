import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Narration, TtsOptions } from "./tts";
import {
  getOrCreateNarration,
  narrationCacheKey,
  narrationCacheStatus,
  resetNarrationMemoryCacheForTests,
} from "./narrationCache";

const baseOptions: TtsOptions = {
  engine: "elevenlabs",
  elevenVoiceId: "voice-a",
  elevenModel: "eleven_multilingual_v2",
  speed: 1,
  elevenStability: 0.5,
  elevenStyle: 0,
};

function narration(seed: number): Narration {
  return { data: new Uint8Array([seed, seed + 1]), ext: "mp3", durationSec: seed };
}

beforeEach(() => resetNarrationMemoryCacheForTests());

describe("persistent narration asset cache", () => {
  it("generates identical narration once and then returns the saved asset", async () => {
    const producer = vi.fn(async () => narration(1));

    const first = await getOrCreateNarration("  Hello world  ", baseOptions, producer);
    const second = await getOrCreateNarration("Hello world", baseOptions, producer);

    expect(producer).toHaveBeenCalledOnce();
    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(true);
    expect([...second.data]).toEqual([1, 2]);
    expect((await narrationCacheStatus("Hello world", baseOptions)).cached).toBe(true);
  });

  it("invalidates when a synthesis setting changes", async () => {
    const firstKey = await narrationCacheKey("Same script", baseOptions);
    const secondKey = await narrationCacheKey("Same script", { ...baseOptions, elevenVoiceId: "voice-b" });
    const speedKey = await narrationCacheKey("Same script", { ...baseOptions, speed: 0.9 });

    expect(secondKey.key).not.toBe(firstKey.key);
    expect(speedKey.key).not.toBe(firstKey.key);
  });

  it("deduplicates simultaneous preview and export requests", async () => {
    let release!: (value: Narration) => void;
    const producer = vi.fn(() => new Promise<Narration>((resolve) => { release = resolve; }));

    const preview = getOrCreateNarration("Shared line", baseOptions, producer);
    const exportRender = getOrCreateNarration("Shared line", baseOptions, producer);
    await vi.waitFor(() => expect(producer).toHaveBeenCalledOnce());
    release(narration(2));

    const [fromPreview, fromExport] = await Promise.all([preview, exportRender]);
    expect(producer).toHaveBeenCalledOnce();
    expect([...fromPreview.data]).toEqual([2, 3]);
    expect([...fromExport.data]).toEqual([2, 3]);
  });

  it("regenerates only when explicitly forced", async () => {
    const producer = vi.fn()
      .mockResolvedValueOnce(narration(3))
      .mockResolvedValueOnce(narration(7));

    await getOrCreateNarration("Regenerate me", baseOptions, producer);
    const refreshed = await getOrCreateNarration("Regenerate me", baseOptions, producer, true);
    const reused = await getOrCreateNarration("Regenerate me", baseOptions, producer);

    expect(producer).toHaveBeenCalledTimes(2);
    expect([...refreshed.data]).toEqual([7, 8]);
    expect([...reused.data]).toEqual([7, 8]);
    expect(reused.cacheHit).toBe(true);
  });
});
