import { describe, it, expect } from "vitest";
import { gradeSvgFilter, matrixStep, CURVE_SAMPLES } from "./grade";

/** Pull the decoded SVG source back out of the CSS url(data:...) wrapper. */
function decode(filter: string): string {
  const m = filter.match(/utf8,([^#]+)#g/);
  if (!m) throw new Error(`not a data-URI filter: ${filter}`);
  return decodeURIComponent(m[1]);
}

function tableOf(filter: string, tag: "feFuncR" | "feFuncG" | "feFuncB"): number[] {
  const m = decode(filter).match(new RegExp(`<${tag} type="table" tableValues="([^"]+)"`));
  if (!m) throw new Error(`no ${tag} in filter`);
  return m[1].split(" ").map(Number);
}

describe("gradeSvgFilter", () => {
  it("returns 'none' for an identity Grade", () => {
    expect(gradeSvgFilter(undefined)).toBe("none");
    expect(gradeSvgFilter({})).toBe("none");
    expect(gradeSvgFilter({ warmth: 0 })).toBe("none");
  });

  it("emits one data-URI filter carrying both steps in order", () => {
    const svg = decode(gradeSvgFilter({ exposure: 20, saturation: 30 }));
    expect(svg).toContain("<feComponentTransfer>");
    expect(svg).toContain("<feColorMatrix");
    expect(svg.indexOf("feComponentTransfer")).toBeLessThan(svg.indexOf("feColorMatrix"));
  });

  it("applies Colorize as a final component-transfer after the corrective matrix", () => {
    const svg = decode(gradeSvgFilter({ colorize: { shadowColor: "#75c9ff", highlightColor: "#ffabd8", intensity: 40 } }));
    expect(svg.match(/<feComponentTransfer>/g)).toHaveLength(2);
    expect(svg.lastIndexOf("feComponentTransfer")).toBeGreaterThan(svg.indexOf("feColorMatrix"));
  });

  it("pins filter interpolation to sRGB", () => {
    // Without this SVG filters run in linearRGB and would diverge from the
    // .cube bake, which is exactly the class of mismatch ADR-0010 removes.
    expect(decode(gradeSvgFilter({ exposure: 20 }))).toContain('color-interpolation-filters="sRGB"');
  });

  it("emits a full table per channel", () => {
    const f = gradeSvgFilter({ contrast: 25 });
    for (const tag of ["feFuncR", "feFuncG", "feFuncB"] as const) {
      expect(tableOf(f, tag)).toHaveLength(CURVE_SAMPLES);
    }
  });

  it("produces a non-linear table for split-tone", () => {
    // The old preview folded split-tone into global white balance at 0.4x, which
    // is linear and could never bend the curve. This is that regression's guard.
    const t = tableOf(gradeSvgFilter({ shadowWarmth: 80 }), "feFuncR");
    const mid = Math.floor(CURVE_SAMPLES / 2);
    const linear = (t[0] + t[CURVE_SAMPLES - 1]) / 2;
    expect(Math.abs(t[mid] - linear)).toBeGreaterThan(0.005);
  });

  it("bends shadows and highlights in opposite directions", () => {
    const t = tableOf(gradeSvgFilter({ shadowWarmth: -70, highlightWarmth: 70 }), "feFuncR");
    const lo = Math.floor(CURVE_SAMPLES * 0.1);
    const hi = Math.floor(CURVE_SAMPLES * 0.9);
    expect(t[lo]).toBeLessThan(lo / (CURVE_SAMPLES - 1));
    expect(t[hi]).toBeGreaterThan(hi / (CURVE_SAMPLES - 1));
  });

  it("carries the matrix step verbatim", () => {
    const adj = { saturation: 40, colorTone: 20, warmth: 15 };
    const svg = decode(gradeSvgFilter(adj));
    const expected = matrixStep(adj).map((n) => Number(n.toFixed(5)).toString()).join(" ");
    expect(svg).toContain(`values="${expected}"`);
  });

  it("emits a matrix that tracks saturation", () => {
    const flat = decode(gradeSvgFilter({ saturation: -100 }));
    const punchy = decode(gradeSvgFilter({ saturation: 100 }));
    expect(flat).not.toEqual(punchy);
  });

  it("URI-encodes the payload so it is a legal CSS url()", () => {
    const f = gradeSvgFilter({ warmth: 30 });
    expect(f.startsWith("url('data:image/svg+xml;utf8,")).toBe(true);
    expect(f.endsWith("#g')")).toBe(true);
    expect(f).not.toContain('"');
  });
});
