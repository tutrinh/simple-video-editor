import { describe, expect, it, vi } from "vitest";
import { activePreviewMedia, applyPreviewSpeed, playPreviewMedia } from "./previewPlayback";

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

  it("applies slow motion to every moving source in Beat and Cut playback", () => {
    const primary = { playbackRate: 1, defaultPlaybackRate: 1 };
    const secondSlot = { playbackRate: 1, defaultPlaybackRate: 1 };

    applyPreviewSpeed([primary, secondSlot], 0.5);

    expect(primary).toMatchObject({ playbackRate: 0.5, defaultPlaybackRate: 0.5 });
    expect(secondSlot).toMatchObject({ playbackRate: 0.5, defaultPlaybackRate: 0.5 });
  });
});
