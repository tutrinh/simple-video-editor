// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { KNOWN_RATES, formatFps, measureVideoFps, snapFps } from "./videoFps";

describe("snapFps", () => {
  it("reports each expected rate as itself", () => {
    for (const rate of KNOWN_RATES) expect(snapFps(rate)).toBe(rate);
  });

  it("absorbs the measurement error around each rate", () => {
    expect(snapFps(23.976)).toBe(24);
    expect(snapFps(29.97)).toBe(30);
    expect(snapFps(59.94)).toBe(60);
    expect(snapFps(119.88)).toBe(120);
    expect(snapFps(30.4)).toBe(30);
    expect(snapFps(58.2)).toBe(60);
  });

  it("has enough room between rates that a sloppy measurement still lands right", () => {
    // The tightest pair is 24 and 30, a 25% step. Nothing here is marginal.
    expect(snapFps(26)).toBe(24);
    expect(snapFps(28)).toBe(30);
    expect(snapFps(50)).toBe(60);
    expect(snapFps(95)).toBe(120);
  });

  it("resolves a midpoint by proportion rather than absolute distance", () => {
    // 45 is 15 from either neighbour, but proportionally much nearer 60.
    expect(snapFps(45)).toBe(60);
  });

  it("still answers for a rate outside the expected set", () => {
    // Imported footage is expected to be one of the four, so an odd measurement
    // is treated as a bad reading of the nearest rather than a new rate.
    expect(snapFps(15)).toBe(24);
    expect(snapFps(240)).toBe(120);
  });

  it("passes nonsense straight through rather than inventing a rate", () => {
    expect(snapFps(0)).toBe(0);
    expect(snapFps(-5)).toBe(-5);
    expect(snapFps(Number.NaN)).toBeNaN();
  });
});

describe("formatFps", () => {
  it("writes every expected rate as a plain whole number", () => {
    for (const rate of KNOWN_RATES) expect(formatFps(rate)).toBe(String(rate));
  });

  it("still writes a fractional rate readably", () => {
    // snapFps cannot currently produce one, but a Project saved when broadcast
    // rates were recognised can still hold 29.97 — so it must render.
    expect(formatFps(29.97)).toBe("29.97");
    expect(formatFps(23.976)).toBe("23.98");
  });

  it("writes nothing for a rate it cannot express", () => {
    expect(formatFps(0)).toBe("");
    expect(formatFps(Number.NaN)).toBe("");
  });
});

/**
 * A real <video> with its playback stubbed to report frames at a chosen rate.
 * Real, not a plain object, because the measurement parks a detached element in
 * the document — so it has to actually be a Node.
 */
function fakeVideo(fps: number, options: { frames?: number; support?: boolean } = {}) {
  const frames = options.frames ?? 40;
  let presented = 7; // Deliberately non-zero: playback may already be underway.
  let mediaTime = 1.5;

  const video = document.createElement("video");
  let paused = false;
  Object.defineProperty(video, "paused", { get: () => paused, configurable: true });
  Object.defineProperty(video, "currentTime", {
    value: 1.5, writable: true, configurable: true,
  });

  video.play = vi.fn(async () => {});
  video.pause = vi.fn(() => { paused = true; });

  const target = video as unknown as Record<string, unknown>;
  target.cancelVideoFrameCallback = vi.fn();
  target.requestVideoFrameCallback = options.support === false
    ? undefined
    : vi.fn((cb: (now: number, meta: { mediaTime: number; presentedFrames: number }) => void) => {
        if (presented - 7 >= frames) return 0;
        presented += 1;
        mediaTime += 1 / fps;
        setTimeout(() => cb(performance.now(), { mediaTime, presentedFrames: presented }), 0);
        return presented;
      });

  return video;
}

afterEach(() => vi.useRealTimers());

describe("measureVideoFps", () => {
  it("derives the rate from the slope of frames against media time", async () => {
    expect(await measureVideoFps(fakeVideo(60))).toBe(60);
    expect(await measureVideoFps(fakeVideo(30))).toBe(30);
    expect(await measureVideoFps(fakeVideo(24))).toBe(24);
    expect(await measureVideoFps(fakeVideo(120))).toBe(120);
  });

  it("returns undefined when the browser cannot report frames", async () => {
    expect(await measureVideoFps(fakeVideo(60, { support: false }))).toBeUndefined();
  });

  it("returns undefined rather than guessing from too few frames", async () => {
    // Only three frames arrive, then the source stops reporting.
    expect(await measureVideoFps(fakeVideo(60, { frames: 3 }), { timeoutMs: 50 })).toBeUndefined();
  });

  it("returns undefined when playback is refused", async () => {
    const video = fakeVideo(60);
    (video as unknown as { play: () => Promise<void> }).play = () => Promise.reject(new Error("blocked"));
    expect(await measureVideoFps(video, { timeoutMs: 50 })).toBeUndefined();
  });

  it("parks a detached element in the document while measuring, then removes it", async () => {
    // A <video> outside the document may never present a frame to the
    // compositor, so requestVideoFrameCallback never fires and the measurement
    // silently times out. Parking it is the whole reason ingest reports a rate.
    const video = fakeVideo(60);
    expect(video.isConnected).toBe(false);

    let connectedDuringMeasure = false;
    const originalRvfc = (video as unknown as Record<string, unknown>).requestVideoFrameCallback as (
      cb: (now: number, meta: { mediaTime: number; presentedFrames: number }) => void,
    ) => number;
    (video as unknown as Record<string, unknown>).requestVideoFrameCallback = (
      cb: (now: number, meta: { mediaTime: number; presentedFrames: number }) => void,
    ) => {
      if (video.isConnected) connectedDuringMeasure = true;
      return originalRvfc(cb);
    };

    await measureVideoFps(video);
    expect(connectedDuringMeasure).toBe(true);
    expect(video.isConnected).toBe(false);
  });

  it("leaves an already-attached element in the document", async () => {
    const video = fakeVideo(60);
    document.body.appendChild(video);
    await measureVideoFps(video);
    expect(video.isConnected).toBe(true);
    video.remove();
  });

  it("leaves the element paused and back where it started", async () => {
    const video = fakeVideo(60);
    await measureVideoFps(video);
    expect(video.paused).toBe(true);
    expect(video.currentTime).toBe(1.5);
    expect(video.muted).toBe(false);
  });
});
