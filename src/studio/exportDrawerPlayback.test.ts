import { describe, expect, it, vi } from "vitest";
import { pauseExportDrawerMedia } from "./exportDrawerPlayback";

describe("export drawer playback lifecycle", () => {
  it("pauses every playing media element when the drawer closes", () => {
    const preview = { pause: vi.fn() };
    const renderedExport = { pause: vi.fn() };
    const musicSample = { pause: vi.fn() };
    const root = {
      querySelectorAll: vi.fn(() => [preview, renderedExport, musicSample]),
    };

    pauseExportDrawerMedia(root);

    expect(preview.pause).toHaveBeenCalledOnce();
    expect(renderedExport.pause).toHaveBeenCalledOnce();
    expect(musicSample.pause).toHaveBeenCalledOnce();
  });
});
