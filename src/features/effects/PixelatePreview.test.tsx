// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PixelatePreview from "./PixelatePreview";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PixelatePreview", () => {
  it("keeps preview media mounted when the effect is toggled", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const mounted = vi.fn();
    const unmounted = vi.fn();
    function Media() {
      useEffect(() => {
        mounted();
        return unmounted;
      }, []);
      return <video />;
    }

    const { rerender } = render(
      <PixelatePreview effect={null} exportWidth={1920} exportHeight={1080}>
        <Media />
      </PixelatePreview>,
    );
    rerender(
      <PixelatePreview effect={{ enabled: true, shape: "pixelate" }} exportWidth={1920} exportHeight={1080}>
        <Media />
      </PixelatePreview>,
    );

    expect(mounted).toHaveBeenCalledTimes(1);
    expect(unmounted).not.toHaveBeenCalled();
  });

  it("uses a low-resolution canvas instead of browser compositor scaling", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const { container } = render(
      <PixelatePreview
        effect={{ enabled: true, shape: "pixelate", cellSizePx: 24 }}
        exportWidth={1920}
        exportHeight={1080}
      >
        <video />
      </PixelatePreview>,
    );

    const canvas = container.querySelector("canvas");
    expect(canvas).not.toBeNull();
    expect(canvas?.width).toBe(80);
    expect(canvas?.height).toBe(45);
  });

  it("uses the same low-resolution canvas for circular pixels", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const { container } = render(
      <PixelatePreview
        effect={{ enabled: true, shape: "pixelate-circle", cellSizePx: 24 }}
        exportWidth={1920}
        exportHeight={1080}
      >
        <video />
      </PixelatePreview>,
    );

    expect(container.querySelector("canvas")?.width).toBe(80);
    expect(container.querySelector("canvas")?.height).toBe(45);
  });

  it("replaces the visible source instead of compositing over it", () => {
    const filterAtDraw = vi.fn();
    const context = {
      fillRect: vi.fn(),
      drawImage: vi.fn(() => filterAtDraw(context.filter)),
      imageSmoothingEnabled: true,
      fillStyle: "",
      filter: "none",
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      objectFit: "cover",
      filter: "contrast(1.2) saturate(1.3)",
    } as CSSStyleDeclaration);
    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
    vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(1920);
    vi.spyOn(HTMLImageElement.prototype, "naturalHeight", "get").mockReturnValue(1080);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, top: 0, right: 192, bottom: 108, left: 0,
      width: 192, height: 108, toJSON: () => ({}),
    });
    let frame: FrameRequestCallback | undefined;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frame = callback;
      return 1;
    });

    const { container } = render(
      <PixelatePreview effect={{ enabled: true, shape: "pixelate" }} exportWidth={1920} exportHeight={1080}>
        <img alt="" />
      </PixelatePreview>,
    );
    act(() => frame?.(0));

    expect(context.drawImage).toHaveBeenCalled();
    expect(filterAtDraw).toHaveBeenCalledWith("contrast(1.2) saturate(1.3)");
    const source = container.querySelector("[data-pixel-source]") as HTMLElement;
    const canvas = container.querySelector("canvas") as HTMLElement;
    expect(source.style.visibility).toBe("hidden");
    expect(canvas.style.visibility).toBe("visible");
    expect(canvas.style.opacity).toBe("");
    expect(canvas.style.mixBlendMode).toBe("");
  });
});
