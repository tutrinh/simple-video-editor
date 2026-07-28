import { describe, expect, it, vi } from "vitest";
import { activePreviewMedia, playPreviewMedia } from "./previewPlayback";

describe("split-screen preview playback", () => {
  it("starts both the top and bottom videos from the play gesture", async () => {
    const top = { play: vi.fn(async () => {}), pause: vi.fn() };
    const bottom = { play: vi.fn(async () => {}), pause: vi.fn() };

    const media = activePreviewMedia(top, true, [top, bottom]);
    await playPreviewMedia(media);

    expect(top.play).toHaveBeenCalledOnce();
    expect(bottom.play).toHaveBeenCalledOnce();
  });

  it("starts a moving split slot when the primary slot is a still", async () => {
    const movingSlot = { play: vi.fn(async () => {}), pause: vi.fn() };

    const media = activePreviewMedia(null, true, [null, movingSlot]);
    await playPreviewMedia(media);

    expect(movingSlot.play).toHaveBeenCalledOnce();
  });
});
