import { describe, expect, it } from "vitest";
import { analyzeMusicChannels, isSupportedMusicImport, isVideoMusicImport, musicTrackGain, snapBeatEndToMusicCue } from "./musicTrack";

describe("music track analysis", () => {
  it("detects spaced transient changes and returns a bounded waveform", () => {
    const sampleRate = 1000;
    const samples = new Float32Array(5000);
    for (const second of [1, 2, 3, 4]) {
      for (let index = second * sampleRate; index < second * sampleRate + 30; index++) samples[index] = 1;
    }
    const result = analyzeMusicChannels([samples], sampleRate, 100);
    expect(result.durationSec).toBe(5);
    expect(result.waveform).toHaveLength(100);
    expect(result.waveform.every((value) => value >= 0 && value <= 1)).toBe(true);
    expect(result.cueMarkers.length, JSON.stringify(result.cueMarkers)).toBeGreaterThan(0);
    for (const second of [1, 2, 3, 4]) {
      expect(result.cueMarkers.some((marker) => Math.abs(marker.timeSec - second) < 0.08), JSON.stringify(result.cueMarkers)).toBe(true);
    }
  });

  it("classifies audio and video imports", () => {
    expect(isSupportedMusicImport({ name: "song.mp3", type: "audio/mpeg" })).toBe(true);
    expect(isVideoMusicImport({ name: "performance.mov", type: "video/quicktime" })).toBe(true);
    expect(isVideoMusicImport({ name: "song.webm", type: "audio/webm" })).toBe(false);
    expect(isSupportedMusicImport({ name: "notes.txt", type: "text/plain" })).toBe(false);
  });

  it("mutes preview and export gain without changing the saved level", () => {
    expect(musicTrackGain({ volume: 0.65, muted: false })).toBe(0.65);
    expect(musicTrackGain({ volume: 0.65, muted: true })).toBe(0);
  });

  it("snaps a Beat end to an absolute cue using existing trim rules", () => {
    const beat = { id: "b1", clipId: "c1", inSec: 1, outSec: 4, durationSec: 3, scriptText: "", captionText: "" };
    expect(snapBeatEndToMusicCue(beat, 10, 5, 9.2)).toMatchObject({ durationSec: 4.2, inSec: 1, outSec: 5.2, durationPreset: "custom" });
    expect(snapBeatEndToMusicCue(beat, 10, 5, 4)).toBeNull();
  });
});
