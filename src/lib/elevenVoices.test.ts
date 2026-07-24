import { describe, it, expect } from "vitest";
import { orderElevenVoices, type ElevenVoice } from "./elevenLabs";

const v = (id: string, label: string, category?: string): ElevenVoice => ({ id, label, category });

describe("orderElevenVoices", () => {
  it("sorts cloned/generated first, then professional, then premade", () => {
    const input = [
      v("1", "Stock A", "premade"),
      v("2", "Pro B", "professional"),
      v("3", "My Clone", "cloned"),
      v("4", "Stock C", "premade"),
      v("5", "Designed", "generated"),
    ];
    expect(orderElevenVoices(input).map((x) => x.id)).toEqual(["3", "5", "2", "1", "4"]);
  });

  it("tags cloned/generated voices with (custom)", () => {
    const out = orderElevenVoices([v("3", "My Clone", "cloned"), v("1", "Stock", "premade")]);
    expect(out[0].label).toBe("My Clone (custom)");
    expect(out[1].label).toBe("Stock");
  });

  it("does not double-tag an already-tagged label", () => {
    const out = orderElevenVoices([v("3", "My Clone (custom)", "cloned")]);
    expect(out[0].label).toBe("My Clone (custom)");
  });

  it("keeps API order within the same rank (stable)", () => {
    const out = orderElevenVoices([v("a", "A", "premade"), v("b", "B", "premade"), v("c", "C", "premade")]);
    expect(out.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });
});
