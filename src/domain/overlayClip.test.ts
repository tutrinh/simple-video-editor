import { describe, expect, it } from "vitest";
import type { Beat, OverlayClip } from "./types";
import { activeOverlayClips, attachOverlayToBeat, overlayCreationVisual, overlayTiming, overlayVisual, resolveOverlayClip } from "./overlayClip";

const beat = (id: string, clipId: string, durationSec: number, speed = 1): Beat => ({
  id,
  clipId,
  inSec: 0,
  outSec: durationSec,
  durationSec,
  speed,
  scriptText: "",
  captionText: "",
});

const overlay = (over: Partial<OverlayClip> = {}): OverlayClip => ({
  id: "ov1",
  clipId: "overlay-clip",
  startTimeSec: 0.5,
  durationSec: 2,
  inSec: 0,
  outSec: 2,
  blendMode: "normal",
  opacity: 1,
  volume: 0,
  ...over,
});

describe("overlay clip", () => {
  it("creates ordinary PiP footage fully opaque", () => {
    expect(overlayCreationVisual("interview.mp4")).toMatchObject({
      layoutMode: "pip",
      blendMode: "normal",
      opacity: 1,
    });
  });

  it("repairs the early un-authored 85% PiP default without overriding user opacity", () => {
    const beats = [beat("b1", "c1", 4)];
    expect(resolveOverlayClip(overlay({ layoutMode: "pip", opacity: 0.85 }), beats).opacity).toBe(1);
    expect(resolveOverlayClip(overlay({ layoutMode: "pip", opacity: 0.85, opacityAuthored: true }), beats).opacity).toBe(0.85);
  });
  it("keeps legacy overlays full-frame while normalizing PiP geometry", () => {
    expect(overlayVisual(overlay()).layoutMode).toBe("full");
    expect(overlayVisual(overlay({ layoutMode: "pip", width: 2, height: 0.01, x: 2, y: -1 }))).toMatchObject({
      layoutMode: "pip",
      width: 1,
      height: 0.1,
      x: 0.5,
      y: 0.05,
    });
  });

  it("derives attached timing from the current Beat durations", () => {
    const beats = [beat("b1", "c1", 2), beat("b2", "c2", 4, 2)];
    const attached = attachOverlayToBeat(overlay(), beats[1], beats);
    expect(attached).toMatchObject({ fitToBeat: true, attachedBeatId: "b2" });
    expect(overlayTiming(attached, beats)).toEqual({ startTimeSec: 2, durationSec: 2 });

    const resized = [beats[0], { ...beats[1], outSec: 6, durationSec: 6 }];
    expect(overlayTiming(attached, resized)).toEqual({ startTimeSec: 2, durationSec: 3 });
  });

  it("returns every active overlay in explicit Cut layer order", () => {
    const beats = [beat("b1", "c1", 4)];
    const overlays = [overlay({ id: "bottom" }), overlay({ id: "top" })];
    expect(activeOverlayClips(overlays, beats, 1).map((item) => item.id)).toEqual(["bottom", "top"]);
  });
});
