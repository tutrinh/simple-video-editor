import { describe, it, expect } from "vitest";
import {
  rotationCoverScale, beatFrameFilters, beatRotationStyle, beatZoomStyle,
} from "./util";

const W = 1920, H = 1080; // 16:9

describe("rotationCoverScale", () => {
  it("is 1 when there is no rotation", () => {
    expect(rotationCoverScale(W, H, 0)).toBe(1);
    expect(rotationCoverScale(W, H, undefined)).toBe(1);
  });

  it("treats a sub-pixel angle as none", () => {
    expect(rotationCoverScale(W, H, 0.01)).toBe(1);
  });

  it("needs 16/9 to cover a quarter turn on 16:9", () => {
    expect(rotationCoverScale(W, H, 90)).toBeCloseTo(16 / 9, 4);
  });

  it("is symmetric in the sign of the angle", () => {
    for (const d of [1, 5, 12, 15]) {
      expect(rotationCoverScale(W, H, d)).toBeCloseTo(rotationCoverScale(W, H, -d), 9);
    }
  });

  it("grows monotonically from 0 to 45 degrees", () => {
    let prev = 0;
    for (let d = 0; d <= 45; d += 0.5) {
      const s = rotationCoverScale(W, H, d);
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
  });

  it("reports the zoom the hint suggests", () => {
    // Nothing applies these automatically any more; they only drive the
    // "zoom to N x to hide them" hint under the rotation slider.
    expect(rotationCoverScale(W, H, 0.5)).toBeCloseTo(1.016, 2);
    expect(rotationCoverScale(W, H, 1)).toBeCloseTo(1.031, 2);
    expect(rotationCoverScale(W, H, 5)).toBeCloseTo(1.151, 2);
    expect(rotationCoverScale(W, H, 15)).toBeCloseTo(1.426, 2);
  });

  it("costs a square frame less than a wide one at the same angle", () => {
    expect(rotationCoverScale(1080, 1080, 15)).toBeCloseTo(1.225, 2);
  });

  it("depends on the frame's aspect", () => {
    // A square needs less cover than 16:9 at the same angle.
    expect(rotationCoverScale(1080, 1080, 10)).toBeLessThan(rotationCoverScale(W, H, 10));
  });
});

describe("zoom and rotation are separate", () => {
  it("emits one chain per adjustment, each self-contained", () => {
    const rotOnly = beatFrameFilters(W, H, { rotation: 6 }).base;
    const zoomOnly = beatFrameFilters(W, H, { zoom: 2 }).base;
    expect(rotOnly.join(",")).not.toContain("crop=");
    expect(zoomOnly.filter((f) => f.startsWith("crop="))).toHaveLength(1);
    expect(zoomOnly.join(",")).not.toContain("rotate=");
  });

  it("runs rotation before zoom when both are set", () => {
    const base = beatFrameFilters(W, H, { zoom: 2, rotation: 6 }).base;
    expect(base[0]).toMatch(/^rotate=/);
    expect(base[1]).toMatch(/^scale=/);
    expect(base[2]).toMatch(/^crop=/);
  });

  it("leaves the zoom's own scale untouched by the rotation", () => {
    const withRot = beatFrameFilters(W, H, { zoom: 3, rotation: 6 }).base;
    const withoutRot = beatFrameFilters(W, H, { zoom: 3 }).base;
    expect(withRot.slice(1)).toEqual(withoutRot);
  });

  it("ignores the zoom focus entirely — rotation always pivots on the centre", () => {
    // The pivot bug: CSS rotated about the zoom focus while ffmpeg rotated about
    // the frame centre.
    const a = beatFrameFilters(W, H, { rotation: 8, zoomX: 0, zoomY: 0 }).base;
    const b = beatFrameFilters(W, H, { rotation: 8, zoomX: 50, zoomY: -50 }).base;
    expect(a).toEqual(b);
  });

  it("still tracks focus on the zoom crop", () => {
    const centred = beatFrameFilters(W, H, { zoom: 2 }).base;
    const panned = beatFrameFilters(W, H, { zoom: 2, zoomX: 50 }).base;
    expect(centred[1]).not.toBe(panned[1]);
  });
});

describe("beatFrameFilters", () => {
  it("emits nothing for a beat with neither zoom nor rotation", () => {
    expect(beatFrameFilters(W, H, {})).toEqual({ base: [], introZoom: null });
  });

  it("is the rotate filter alone — no cover scale, no crop", () => {
    // Auto-cover is gone: a tilt no longer silently crops the shot. The exposed
    // corners are left for the editor to zoom away or keep.
    const { base } = beatFrameFilters(W, H, { rotation: 6 });
    expect(base).toHaveLength(1);
    expect(base[0]).toMatch(/^rotate=angle=/);
    expect(base[0]).toContain("ow=iw:oh=ih");
    expect(base[0]).toContain("fillcolor=black");
  });

  it("omits the rotate filter when the angle is zero", () => {
    const { base } = beatFrameFilters(W, H, { zoom: 1.5 });
    expect(base.join(",")).not.toContain("rotate=");
    expect(base.join(",")).toContain("scale=");
  });

  it("passes the angle through unnegated — ffmpeg and CSS both turn clockwise", () => {
    // A negation here inverted the export relative to the preview.
    const { base } = beatFrameFilters(W, H, { rotation: 10 });
    expect(Number(base[0].match(/angle=(-?[\d.]+)/)![1])).toBeCloseTo(10 * Math.PI / 180, 6);
  });

  it("agrees in sign with the preview transform", () => {
    for (const deg of [-12, -3, 3, 12]) {
      const rad = Number(beatFrameFilters(W, H, { rotation: deg }).base[0].match(/angle=(-?[\d.]+)/)![1]);
      const css = Number(beatRotationStyle(W, H, deg).transform!.match(/rotate\((-?[\d.]+)deg\)/)![1]);
      expect(Math.sign(rad)).toBe(Math.sign(css));
      expect(rad).toBeCloseTo((css * Math.PI) / 180, 6);
    }
  });

  it("does not scale the frame at all", () => {
    expect(beatFrameFilters(W, H, { rotation: 8 }).base.join(",")).not.toContain("scale=");
  });

  it("keeps rotation in the base chain for an intro zoom", () => {
    // The base sits before split=2, so the rotation outlives the intro window.
    const { base, introZoom } = beatFrameFilters(W, H, { zoom: 2, zoomScope: "intro", rotation: 6 });
    expect(base.join(",")).toContain("rotate=");
    expect(introZoom).not.toBeNull();
    expect(introZoom!.join(",")).not.toContain("rotate=");
  });

  it("splits the intro case into the same two chains, not a rescaled hybrid", () => {
    const beat = { zoom: 2, zoomX: 10, zoomY: -5, rotation: 6 };
    const entire = beatFrameFilters(W, H, { ...beat, zoomScope: "entire" as const });
    const intro = beatFrameFilters(W, H, { ...beat, zoomScope: "intro" as const });
    expect(intro.base).toEqual(entire.base.slice(0, 1));   // rotation
    expect(intro.introZoom).toEqual(entire.base.slice(1)); // zoom
  });

  it("has no intro branch when the scope is entire", () => {
    expect(beatFrameFilters(W, H, { zoom: 2, zoomScope: "entire" }).introZoom).toBeNull();
  });
});

describe("beatRotationStyle", () => {
  it("returns nothing without a rotation", () => {
    expect(beatRotationStyle(W, H, 0)).toEqual({});
    expect(beatRotationStyle(W, H, undefined)).toEqual({});
  });

  it("rotates about the centre, never the zoom focus", () => {
    expect(beatRotationStyle(W, H, 5).transformOrigin).toBe("50% 50%");
  });

  it("rotates without scaling — the exposed corners are left showing", () => {
    const s = beatRotationStyle(W, H, 5);
    expect(s.transform).toBe("rotate(5.00deg)");
    expect(s.transform).not.toContain("scale(");
  });

  it("is unaffected by zoom — it does not take zoom arguments at all", () => {
    expect(beatRotationStyle(W, H, 5)).toEqual(beatRotationStyle(W, H, 5));
  });
});

describe("beatZoomStyle", () => {
  it("returns nothing at 1x", () => {
    expect(beatZoomStyle(1, 0, 0)).toEqual({});
    expect(beatZoomStyle(undefined)).toEqual({});
  });

  it("pivots on the focus point", () => {
    expect(beatZoomStyle(2, 50, -50).transformOrigin).toBe("100.00% 0.00%");
  });

  it("drops out when the zoom is inactive, leaving rotation untouched", () => {
    expect(beatZoomStyle(2, 0, 0, false)).toEqual({});
    expect(beatRotationStyle(W, H, 5).transform).toContain("rotate(5.00deg)");
  });

  it("carries no rotation of its own", () => {
    expect(beatZoomStyle(2, 0, 0).transform).not.toContain("rotate");
  });
});
