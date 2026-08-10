// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OverlayClip } from "../../domain/types";
import OverlayVideoLayer from "./OverlayVideoLayer";

afterEach(cleanup);

const overlay: OverlayClip = {
  id: "ov1",
  clipId: "c1",
  startTimeSec: 0,
  durationSec: 2,
  inSec: 0,
  outSec: 2,
  blendMode: "normal",
  opacity: 1,
  volume: 0,
  layoutMode: "pip",
  x: 0.8,
  y: 0.2,
  width: 0.3,
  height: 0.2,
  fit: "cover",
  cornerRadius: 0.1,
};

describe("OverlayVideoLayer", () => {
  it("renders an editable PiP box and resizes it in frame-relative units", () => {
    const onChange = vi.fn();
    const { container } = render(
      <div><OverlayVideoLayer overlay={overlay} src="overlay.mp4" elapsedSec={0} playing={false} muted editable selected onChange={onChange} /></div>,
    );
    const layer = container.querySelector(".st-video-overlay-layer") as HTMLDivElement;
    expect((layer.querySelector("video") as HTMLVideoElement).style.opacity).toBe("1");
    vi.spyOn(layer.parentElement!, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 500, width: 1000, height: 500, toJSON: () => ({}),
    });
    const handle = screen.getByRole("button", { name: "Resize video overlay" });
    Object.defineProperty(handle, "setPointerCapture", { value: vi.fn() });
    Object.defineProperty(handle, "hasPointerCapture", { value: () => true });
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 100, clientY: 50 });
    const next = onChange.mock.calls[0][0];
    expect(next.width).toBeGreaterThan(overlay.width!);
    expect(next.height).toBeGreaterThan(overlay.height!);
  });

  it("applies the shared color grade to the overlay video", () => {
    const { container } = render(
      <OverlayVideoLayer overlay={{ ...overlay, colorAdjustments: { exposure: 30, warmth: 20 } }} src="overlay.mp4" elapsedSec={0} playing={false} muted />,
    );
    const video = container.querySelector("video") as HTMLVideoElement;
    expect(video.style.filter).not.toBe("");
    expect(video.style.filter).not.toBe("none");
  });
});
