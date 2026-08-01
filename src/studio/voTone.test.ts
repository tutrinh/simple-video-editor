import { describe, expect, it, vi } from "vitest";
import { createVoToneGraph, hasVoTone, voToneFilterChain } from "./voTone";
import { USER_VOICE_BASS_HZ, USER_VOICE_TREBLE_HZ, userVoiceEqFilterChain } from "./userVoiceEq";

describe("hasVoTone", () => {
  it("is false for neutral or missing values", () => {
    expect(hasVoTone(undefined, undefined)).toBe(false);
    expect(hasVoTone(0, 0)).toBe(false);
  });

  it("is true when either shelf is moved", () => {
    expect(hasVoTone(3, 0)).toBe(true);
    expect(hasVoTone(0, -2)).toBe(true);
  });

  it("treats an out-of-range value as its clamp, not as neutral", () => {
    expect(hasVoTone(99, 0)).toBe(true);
  });

  it("is false for non-finite values, which clamp to neutral", () => {
    expect(hasVoTone(Number.NaN, Number.NaN)).toBe(false);
  });

  it("is true for a character effect even with both shelves flat", () => {
    expect(hasVoTone(0, 0, "megaphone")).toBe(true);
    expect(hasVoTone(0, 0, "none")).toBe(false);
    expect(hasVoTone(0, 0, undefined)).toBe(false);
  });
});

describe("voToneFilterChain", () => {
  it("builds the same shelves the User VO track uses, with no character band", () => {
    expect(voToneFilterChain(4, -3)).toBe(
      `bass=f=${USER_VOICE_BASS_HZ}:g=4,treble=f=${USER_VOICE_TREBLE_HZ}:g=-3`,
    );
  });

  it("clamps to the shared ±12 dB range", () => {
    expect(voToneFilterChain(99, -99)).toBe(
      `bass=f=${USER_VOICE_BASS_HZ}:g=12,treble=f=${USER_VOICE_TREBLE_HZ}:g=-12`,
    );
  });

  it("treats missing values as neutral", () => {
    expect(voToneFilterChain(undefined, undefined)).toBe(
      `bass=f=${USER_VOICE_BASS_HZ}:g=0,treble=f=${USER_VOICE_TREBLE_HZ}:g=0`,
    );
  });

  it("puts the character band before the shelves, matching the User VO chain", () => {
    expect(voToneFilterChain(2, -1, "walkie-talkie")).toBe(
      `highpass=f=450,lowpass=f=2600,bass=f=${USER_VOICE_BASS_HZ}:g=2,treble=f=${USER_VOICE_TREBLE_HZ}:g=-1`,
    );
    expect(voToneFilterChain(2, -1, "walkie-talkie")).toBe(userVoiceEqFilterChain(2, -1, "walkie-talkie"));
  });
});

describe("createVoToneGraph", () => {
  function fakeContext() {
    const filters: { type: string; frequency: { value: number }; gain: { value: number }; connect: unknown; disconnect: unknown }[] = [];
    const makeFilter = () => {
      const f = {
        type: "",
        frequency: { value: 0 },
        gain: { value: 0 },
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      filters.push(f);
      return f;
    };
    const source = { connect: vi.fn(), disconnect: vi.fn() };
    const context = {
      destination: {},
      createMediaElementSource: vi.fn(() => source),
      createBiquadFilter: vi.fn(makeFilter),
    } as unknown as AudioContext;
    return { context, filters, source };
  }

  const audio = {} as HTMLAudioElement;

  it("wires a low shelf and a high shelf at the shared frequencies", () => {
    const { context, filters } = fakeContext();
    const graph = createVoToneGraph(audio, context);

    expect(graph).not.toBeNull();
    expect(filters.map((f) => f.type)).toEqual(["highpass", "lowpass", "lowshelf", "highshelf"]);
    expect(filters[2].frequency.value).toBe(USER_VOICE_BASS_HZ);
    expect(filters[3].frequency.value).toBe(USER_VOICE_TREBLE_HZ);
  });

  it("does not create a gain node — level stays with audio.volume", () => {
    const { context } = fakeContext();
    createVoToneGraph(audio, context);
    expect((context as unknown as { createGain?: unknown }).createGain).toBeUndefined();
  });

  it("applies and clamps shelf gains through set()", () => {
    const { context, filters } = fakeContext();
    const graph = createVoToneGraph(audio, context)!;

    graph.set(5, -4, "none");
    expect(filters[2].gain.value).toBe(5);
    expect(filters[3].gain.value).toBe(-4);

    graph.set(99, -99, "none");
    expect(filters[2].gain.value).toBe(12);
    expect(filters[3].gain.value).toBe(-12);

    graph.set(undefined, undefined, undefined);
    expect(filters[2].gain.value).toBe(0);
    expect(filters[3].gain.value).toBe(0);
  });

  it("moves the band-limit filters for a character, and opens them for clean", () => {
    const { context, filters } = fakeContext();
    const graph = createVoToneGraph(audio, context)!;

    graph.set(0, 0, "megaphone");
    expect(filters[0].frequency.value).toBe(650);
    expect(filters[1].frequency.value).toBe(4_500);

    // Clean must reopen the band rather than leave the previous character in place.
    graph.set(0, 0, "none");
    expect(filters[0].frequency.value).toBe(20);
    expect(filters[1].frequency.value).toBe(20_000);
  });

  it("disconnects everything on destroy", () => {
    const { context, filters, source } = fakeContext();
    const graph = createVoToneGraph(audio, context)!;

    graph.destroy();
    expect(source.disconnect).toHaveBeenCalled();
    for (const f of filters) expect(f.disconnect).toHaveBeenCalled();
  });

  it("returns null instead of throwing when the element is already routed", () => {
    // createMediaElementSource throws on a second call for the same element; playback
    // must survive that rather than losing the narration.
    const context = {
      destination: {},
      createMediaElementSource: () => { throw new Error("already connected"); },
      createBiquadFilter: vi.fn(),
    } as unknown as AudioContext;

    expect(createVoToneGraph(audio, context)).toBeNull();
  });
});
