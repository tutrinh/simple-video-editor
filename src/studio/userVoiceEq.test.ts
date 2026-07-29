import { describe, expect, it, vi } from "vitest";
import {
  clampUserVoiceEqDb,
  createUserVoiceEqGraph,
  userVoiceAudioSettings,
  userVoiceEqFilterChain,
} from "./userVoiceEq";

function node() {
  return {
    connect: vi.fn(),
    disconnect: vi.fn(),
    frequency: { value: 0 },
    gain: { value: 0 },
    type: "",
  };
}

describe("userVoiceEq", () => {
  it("defaults old segments to neutral EQ and clamps supported values", () => {
    expect(userVoiceAudioSettings({ volume: 2 })).toEqual({
      volume: 1.5,
      levelDb: 0,
      bassDb: 0,
      trebleDb: 0,
      voiceEffect: "none",
    });
    expect(clampUserVoiceEqDb(-30)).toBe(-12);
    expect(clampUserVoiceEqDb(30)).toBe(12);
  });

  it("builds the matching FFmpeg bass and treble chain", () => {
    expect(userVoiceEqFilterChain(4, -3)).toBe("bass=f=200:g=4,treble=f=3000:g=-3");
    expect(userVoiceEqFilterChain(4, -3, "vintage-phone")).toBe(
      "highpass=f=280,lowpass=f=3600,bass=f=200:g=4,treble=f=3000:g=-3",
    );
    expect(userVoiceEqFilterChain(0, 0, "walkie-talkie")).toBe(
      "highpass=f=450,lowpass=f=2600,bass=f=200:g=0,treble=f=3000:g=0",
    );
    expect(userVoiceEqFilterChain(0, 0, "megaphone")).toBe(
      "highpass=f=650,lowpass=f=4500,bass=f=200:g=0,treble=f=3000:g=0",
    );
    expect(userVoiceEqFilterChain(0, 0, "underwater")).toBe(
      "highpass=f=20,lowpass=f=700,bass=f=200:g=0,treble=f=3000:g=0",
    );
  });

  it("wires low shelf, high shelf, and volume gain for browser preview", () => {
    const source = node();
    const highpass = node();
    const lowpass = node();
    const bass = node();
    const treble = node();
    const gain = node();
    const context = {
      createMediaElementSource: vi.fn(() => source),
      createBiquadFilter: vi.fn()
        .mockReturnValueOnce(highpass)
        .mockReturnValueOnce(lowpass)
        .mockReturnValueOnce(bass)
        .mockReturnValueOnce(treble),
      createGain: vi.fn(() => gain),
      destination: node(),
    };
    const audio = { volume: 0.5 };
    const graph = createUserVoiceEqGraph(
      audio as HTMLAudioElement,
      context as unknown as AudioContext,
    );

    graph.set({ volume: 0.7, levelDb: 6, bassDb: 5, trebleDb: -2, voiceEffect: "vintage-phone" });

    expect(highpass.type).toBe("highpass");
    expect(highpass.frequency.value).toBe(280);
    expect(lowpass.type).toBe("lowpass");
    expect(lowpass.frequency.value).toBe(3_600);
    expect(bass.type).toBe("lowshelf");
    expect(bass.frequency.value).toBe(200);
    expect(bass.gain.value).toBe(5);
    expect(treble.type).toBe("highshelf");
    expect(treble.frequency.value).toBe(3000);
    expect(treble.gain.value).toBe(-2);
    expect(gain.gain.value).toBeCloseTo(1.3967, 3);
    expect(audio.volume).toBe(1);
    expect(source.connect).toHaveBeenCalledWith(highpass);
    expect(highpass.connect).toHaveBeenCalledWith(lowpass);
    expect(lowpass.connect).toHaveBeenCalledWith(bass);

    graph.set({ volume: 1.5, levelDb: 0, bassDb: 0, trebleDb: 0, voiceEffect: "walkie-talkie" });
    expect(gain.gain.value).toBe(1.5);
    expect(highpass.frequency.value).toBe(450);
    expect(lowpass.frequency.value).toBe(2_600);

    graph.destroy();
    expect(source.disconnect).toHaveBeenCalledOnce();
    expect(highpass.disconnect).toHaveBeenCalledOnce();
    expect(lowpass.disconnect).toHaveBeenCalledOnce();
    expect(gain.disconnect).toHaveBeenCalledOnce();
  });
});
