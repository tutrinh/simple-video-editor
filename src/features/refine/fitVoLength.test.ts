import { describe, expect, it, vi } from "vitest";
import type { VoSegment } from "../../domain/types";
import { fitVoSegmentToVoice, MIN_FIT_VO_DURATION_SEC } from "./fitVoLength";

function segment(overrides: Partial<VoSegment> = {}): VoSegment {
  return {
    id: "vo1",
    text: "The surgery date is on a strip of tape inside my locker.",
    startTimeSec: 2,
    durationSec: 3,
    captionVisible: true,
    ...overrides,
  };
}

describe("fitVoSegmentToVoice", () => {
  it("snaps the segment length to the spoken duration, rounded to 0.1s", async () => {
    const result = await fitVoSegmentToVoice(segment(), async () => ({ durationSec: 4.2731 }));
    expect(result).toEqual({ ok: true, segment: expect.objectContaining({ durationSec: 4.3 }) });
  });

  it("leaves every other field of the segment alone", async () => {
    const result = await fitVoSegmentToVoice(
      segment({ volume: 0.6, fitToBeat: true, startTimeSec: 7 }),
      async () => ({ durationSec: 2 })
    );
    expect(result?.ok).toBe(true);
    if (result?.ok) {
      expect(result.segment.startTimeSec).toBe(7);
      expect(result.segment.volume).toBe(0.6);
      expect(result.segment.fitToBeat).toBe(true);
      expect(result.segment.id).toBe("vo1");
    }
  });

  it("synthesizes the trimmed text", async () => {
    const synth = vi.fn().mockResolvedValue({ durationSec: 2 });
    await fitVoSegmentToVoice(segment({ text: "  spoken line  " }), synth);
    expect(synth).toHaveBeenCalledWith("spoken line");
  });

  it("returns null for an empty segment instead of calling the engine", async () => {
    const synth = vi.fn();
    expect(await fitVoSegmentToVoice(segment({ text: "   " }), synth)).toBeNull();
    expect(synth).not.toHaveBeenCalled();
  });

  it("reports an unreadable duration rather than writing the floor", async () => {
    for (const durationSec of [0, -1, 0.2, Number.NaN]) {
      const result = await fitVoSegmentToVoice(segment(), async () => ({ durationSec }));
      expect(result).toEqual({ ok: false, error: "Couldn't read a duration from the voice." });
    }
  });

  it("treats a duration measuring exactly the floor as unreadable", async () => {
    const result = await fitVoSegmentToVoice(segment(), async () => ({
      durationSec: MIN_FIT_VO_DURATION_SEC,
    }));
    expect(result?.ok).toBe(false);
  });

  it("surfaces a synthesis failure as an error message", async () => {
    const result = await fitVoSegmentToVoice(segment(), async () => {
      throw new Error("ElevenLabs quota exceeded");
    });
    expect(result).toEqual({ ok: false, error: "ElevenLabs quota exceeded" });
  });

  it("stringifies a non-Error rejection", async () => {
    const result = await fitVoSegmentToVoice(segment(), async () => {
      throw "network down";
    });
    expect(result).toEqual({ ok: false, error: "network down" });
  });
});
