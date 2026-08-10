// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rampDurationSec, SPEED_RAMP_DEFAULT } from "../../domain/speedRamp";
import SpeedRampGraph, { SpeedRampBand, formatRampFrame, rampBoundaryAtTargetFrame, rampFrameAtProgress, rampProgressAtFrame, speedRampGraphPoints } from "./SpeedRampGraph";

afterEach(cleanup);

describe("SpeedRampGraph", () => {
  it("converts ramp positions to exact 30fps boundaries", () => {
    expect(rampFrameAtProgress(0.5, 3)).toBe(45);
    expect(rampProgressAtFrame(45, 3)).toBe(0.5);
    expect(formatRampFrame(0.5, 3)).toBe("00:01:15 · F45");
  });

  it("solves a boundary against the duration of the resulting curve", () => {
    const targetFrame = 50;
    const point = rampBoundaryAtTargetFrame(SPEED_RAMP_DEFAULT, "firstPoint", targetFrame, 6);
    const next = { ...SPEED_RAMP_DEFAULT, firstPoint: point };
    expect(rampFrameAtProgress(point, rampDurationSec(6, next))).toBe(targetFrame);
  });

  it("lays out start, middle, and end handles over the authored curve", () => {
    const points = speedRampGraphPoints({
      ...SPEED_RAMP_DEFAULT,
      startSpeed: 1,
      middleSpeed: 3,
      endSpeed: 0.5,
      firstPoint: 0.25,
      secondPoint: 0.75,
    });

    expect(points.start.x).toBe(14);
    expect(points.middle.x).toBe(160);
    expect(points.end.x).toBe(306);
    expect(points.middle.y).toBeLessThan(points.start.y);
    expect(points.start.y).toBeLessThan(points.end.y);
  });

  it("exposes three accessible handles and updates a dragged speed", () => {
    const onChange = vi.fn();
    const { container } = render(<SpeedRampGraph ramp={{ ...SPEED_RAMP_DEFAULT }} interactive onChange={onChange} />);
    const handles = screen.getAllByRole("slider");
    expect(handles.map((handle) => handle.getAttribute("aria-label"))).toEqual([
      "start speed",
      "middle speed",
      "end speed",
    ]);

    const svg = container.querySelector("svg")!;
    vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 320, bottom: 128, width: 320, height: 128, toJSON: () => ({}),
    });
    Object.defineProperty(handles[0], "setPointerCapture", { value: vi.fn() });
    fireEvent.pointerDown(handles[0], { pointerId: 1, clientX: 14, clientY: 14 });

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ startSpeed: 4, preset: "custom" }));
  });

  it("shows two linked Bézier controls for a custom curve", () => {
    render(<SpeedRampGraph ramp={{ ...SPEED_RAMP_DEFAULT, curve: "custom" }} interactive onChange={vi.fn()} />);
    expect(screen.getByRole("slider", { name: "Bézier control one" })).toBeTruthy();
    expect(screen.getByRole("slider", { name: "Bézier control two" })).toBeTruthy();
  });

  it("lets a Bézier handle move horizontally to sharpen the shoulder", () => {
    const onChange = vi.fn();
    const { container } = render(
      <SpeedRampGraph ramp={{ ...SPEED_RAMP_DEFAULT, curve: "custom" }} interactive onChange={onChange} />,
    );
    const svg = container.querySelector("svg")!;
    vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 320, bottom: 128, width: 320, height: 128, toJSON: () => ({}),
    });
    const handle = screen.getByRole("slider", { name: "Bézier control one" });
    Object.defineProperty(handle, "setPointerCapture", { value: vi.fn() });
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 100, clientY: 100 });

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      curve: "custom",
      curveInX: expect.any(Number),
    }));
    expect(onChange.mock.calls[0][0].curveInX).toBeGreaterThan(SPEED_RAMP_DEFAULT.curveInX);
  });

  it("sets a ramp boundary to the frame-snapped preview playhead", () => {
    const onChange = vi.fn();
    const durationSec = rampDurationSec(6, SPEED_RAMP_DEFAULT);
    render(
      <SpeedRampGraph
        ramp={{ ...SPEED_RAMP_DEFAULT }}
        interactive
        durationSec={durationSec}
        sourceWindowSec={6}
        playheadProgress={0.51}
        onChange={onChange}
      />,
    );

    const targetFrame = rampFrameAtProgress(0.51, durationSec);
    expect(document.querySelector(".st-speed-ramp-playhead-readout")?.textContent).toContain(`F${targetFrame}`);
    fireEvent.click(screen.getByRole("button", { name: "Set ramp-in at current frame" }));
    const next = onChange.mock.calls[0][0];
    expect(next.preset).toBe("custom");
    expect(rampFrameAtProgress(next.firstPoint, rampDurationSec(6, next))).toBe(targetFrame);
  });
});

describe("SpeedRampBand", () => {
  it("presents the primary workflow as before, focus, and after speed bands", () => {
    render(<SpeedRampBand ramp={{ ...SPEED_RAMP_DEFAULT }} durationSec={4} />);
    expect(screen.getByText("BEFORE")).toBeTruthy();
    expect(screen.getByText("FOCUS")).toBeTruthy();
    expect(screen.getByText("AFTER")).toBeTruthy();
  });

  it("drags a transition boundary on the frame grid", () => {
    const onChange = vi.fn();
    const { container } = render(
      <SpeedRampBand ramp={{ ...SPEED_RAMP_DEFAULT }} durationSec={4} sourceWindowSec={6} interactive onChange={onChange} />,
    );
    const band = container.querySelector(".st-speed-ramp-band") as HTMLDivElement;
    vi.spyOn(band, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 400, bottom: 48, width: 400, height: 48, toJSON: () => ({}),
    });
    const handle = screen.getByRole("button", { name: "Move start of focus speed" });
    Object.defineProperty(handle, "setPointerCapture", { value: vi.fn() });
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 120 });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ preset: "custom" }));
  });
});
