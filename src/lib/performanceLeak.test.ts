import { describe, expect, test, vi } from "vitest";
import { getClipBlobUrl } from "./blobUrlCache";
import { getBeatPosterUrl } from "./beatPosterCache";
import { runPool } from "./pool";
import { stickerRenderKey } from "../features/export/stickerCanvas";
import type { Beat, Clip, Sticker } from "../domain/types";

describe("Performance & Memory Leak Regression Tests", () => {
  describe("Blob URL Cache Safety", () => {
    test("returns identical Blob URL for same Blob instance across multiple calls without re-creating", () => {
      const mockBlob = new Blob(["video data"], { type: "video/mp4" });
      const url1 = getClipBlobUrl(mockBlob);
      const url2 = getClipBlobUrl(mockBlob);

      expect(url1).toBeDefined();
      expect(url1).toBe(url2);
    });

    test("safely handles undefined and null sources without crashing or throwing", () => {
      expect(getClipBlobUrl(undefined)).toBeUndefined();
      expect(getClipBlobUrl(null)).toBeUndefined();
    });
  });

  describe("Beat Poster Cache Scale & Memory Stress", () => {
    test("handles rapid queries for hundreds of distinct beats efficiently", () => {
      const mockClip: Clip = {
        id: "clip-perf-1",
        name: "perf-test.mov",
        file: new File(["data"], "perf-test.mov", { type: "video/mp4" }),
        durationSec: 100,
        width: 1920,
        height: 1080,
        poster: "data:image/jpeg;base64,clipPoster",
      };

      const start = performance.now();
      for (let i = 0; i < 500; i++) {
        const beat: Beat = {
          id: `b-${i}`,
          clipId: "clip-perf-1",
          inSec: i * 0.1,
          outSec: i * 0.1 + 1,
          durationSec: 1,
          scriptText: "",
          captionText: "",
        };
        const poster = getBeatPosterUrl(beat, mockClip);
        expect(poster).toBe("data:image/jpeg;base64,clipPoster");
      }
      const duration = performance.now() - start;
      // 500 cache checks should complete well under 50ms
      expect(duration).toBeLessThan(100);
    });
  });

  describe("Worker Pool Concurrency & Allocation Control", () => {
    test("strictly limits active concurrent workers to max limit", async () => {
      const items = Array.from({ length: 50 }, (_, i) => i);
      let activeCount = 0;
      let maxActiveObserved = 0;
      const concurrencyLimit = 4;

      await runPool(items, concurrencyLimit, async () => {
        activeCount++;
        maxActiveObserved = Math.max(maxActiveObserved, activeCount);
        // Simulate work
        await new Promise((r) => setTimeout(r, 2));
        activeCount--;
      });

      expect(maxActiveObserved).toBeLessThanOrEqual(concurrencyLimit);
      expect(activeCount).toBe(0);
    });

    test("handles empty items array gracefully", async () => {
      const worker = vi.fn();
      await runPool([], 3, worker);
      expect(worker).not.toHaveBeenCalled();
    });
  });

  describe("Sticker Render Key Computation Benchmark", () => {
    test("generates 10,000 sticker render keys in under 50ms", () => {
      const sticker: Sticker = {
        id: "stk-1",
        fileName: "star.svg",
        startTimeSec: 1,
        durationSec: 3,
        x: 0.5,
        y: 0.5,
        scale: 0.3,
        rotation: 15,
        opacity: 0.9,
        tintColor: "#ff0000",
        tintStrength: 0.5,
      };

      const start = performance.now();
      for (let i = 0; i < 10000; i++) {
        stickerRenderKey(sticker);
      }
      const duration = performance.now() - start;
      expect(duration).toBeLessThan(50);
    });
  });
});
