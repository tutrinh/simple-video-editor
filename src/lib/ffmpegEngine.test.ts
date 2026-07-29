import { afterEach, describe, expect, it, vi } from "vitest";

const loadCalls: string[] = [];

vi.mock("@ffmpeg/ffmpeg", () => ({
  FFmpeg: class {
    on() {}
    terminate() {}
    writeFile() { return Promise.resolve(); }
    exec() { return Promise.resolve(0); }
    readFile() { return Promise.resolve(new Uint8Array([1, 2, 3])); }
    load(urls: { coreURL: string }) {
      loadCalls.push(urls.coreURL);
      if (urls.coreURL.includes("/ffmpeg-mt/")) return new Promise<boolean>(() => {});
      return Promise.resolve(true);
    }
  },
}));

describe("runIsolated multithreaded fallback", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
    loadCalls.length = 0;
  });

  it("keeps MT disabled unless the browser explicitly opts in", async () => {
    vi.stubGlobal("crossOriginIsolated", true);
    vi.stubGlobal("localStorage", { getItem: () => null });

    const { multithreadReady } = await import("./ffmpegEngine");

    expect(multithreadReady()).toBe(false);
  });

  it("times out a hung MT core load and retries with the ST core", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("location", { href: "http://localhost/" });
    vi.stubGlobal("crossOriginIsolated", true);
    vi.stubGlobal("localStorage", { getItem: () => "on", setItem: vi.fn() });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));

    const { runIsolated } = await import("./ffmpegEngine");
    const resultPromise = runIsolated(
      [{ name: "in.mp4", data: new Uint8Array([1]) }],
      ["-i", "in.mp4", "out.mp4"],
      "out.mp4",
      undefined,
      10,
    );

    await vi.advanceTimersByTimeAsync(10);

    await expect(resultPromise).resolves.toEqual(new Uint8Array([1, 2, 3]));
    expect(loadCalls.some((url) => url.includes("/ffmpeg-mt/"))).toBe(true);
    expect(loadCalls.some((url) => url.includes("/ffmpeg-st/"))).toBe(true);
  });
});
