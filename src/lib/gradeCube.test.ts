import { describe, it, expect } from "vitest";
import type { ColorAdjustments } from "../domain/types";
import {
  gradeCube, gradeSvgFilter, gradePixel, CUBE_SIZE, CURVE_SAMPLES, type Rgb,
} from "./grade";

function rows(cube: string): number[][] {
  return cube
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && !l.startsWith("LUT_3D_SIZE"))
    .map((l) => l.split(" ").map(Number));
}

describe("gradeCube", () => {
  it("declares its size and emits size^3 rows", () => {
    const cube = gradeCube({ warmth: 20 }, 5);
    expect(cube).toContain("LUT_3D_SIZE 5");
    expect(rows(cube)).toHaveLength(125);
  });

  it("defaults to the conventional 33-point lattice", () => {
    expect(gradeCube({ warmth: 20 })).toContain(`LUT_3D_SIZE ${CUBE_SIZE}`);
  });

  it("bakes the identity lattice for an identity Grade", () => {
    const size = 5;
    const last = size - 1;
    const r = rows(gradeCube({}, size));
    r.forEach((row, i) => {
      const ri = i % size;
      const gi = Math.floor(i / size) % size;
      const bi = Math.floor(i / (size * size));
      expect(row[0]).toBeCloseTo(ri / last, 4);
      expect(row[1]).toBeCloseTo(gi / last, 4);
      expect(row[2]).toBeCloseTo(bi / last, 4);
    });
  });

  it("varies red fastest, per the .cube format", () => {
    const size = 5;
    const r = rows(gradeCube({}, size));
    expect(r[1][0]).toBeGreaterThan(r[0][0]); // next row steps red
    expect(r[1][1]).toBeCloseTo(r[0][1], 6);  // green unchanged
    expect(r[size][1]).toBeGreaterThan(r[0][1]); // one green step later
  });

  it("keeps every value inside [0,1] under an extreme Grade", () => {
    const extreme: ColorAdjustments = {
      exposure: 100, contrast: 100, saturation: 100, colorTone: -100,
      warmth: 100, tint: -100, shadowWarmth: -100, highlightWarmth: 100,
    };
    for (const row of rows(gradeCube(extreme, 9))) {
      for (const v of row) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Drift guard (ADR-0010 Consequences): the preview's SVG filter and the
// export's baked LUT must stay two renderings of one transform. This evaluates
// the SVG the way a browser would — table lookup with linear interpolation,
// then the matrix — and holds it against gradePixel, which the .cube bakes.
// ---------------------------------------------------------------------------

function decode(filter: string): string {
  return decodeURIComponent(filter.match(/utf8,([^#]+)#g/)![1]);
}

function tableOf(svg: string, tag: string): number[] {
  return svg.match(new RegExp(`<${tag} type="table" tableValues="([^"]+)"`))![1].split(" ").map(Number);
}

/** SVG feComponentTransfer table lookup: linear interpolation between samples. */
function sampleTable(table: number[], x: number): number {
  const n = table.length - 1;
  const pos = Math.max(0, Math.min(1, x)) * n;
  const i = Math.min(n - 1, Math.floor(pos));
  return table[i] + (pos - i) * (table[i + 1] - table[i]);
}

function evalSvgPath(filter: string, rgb: Rgb): Rgb {
  const svg = decode(filter);
  const transferBlocks = [...svg.matchAll(/<feComponentTransfer>(.*?)<\/feComponentTransfer>/g)].map((m) => m[1]);
  const tablesFor = (block: string) => ["feFuncR", "feFuncG", "feFuncB"].map((t) => tableOf(block, t));
  const firstTables = tablesFor(transferBlocks[0]);
  const m = svg.match(/<feColorMatrix type="matrix" values="([^"]+)"/)![1].split(" ").map(Number);
  const c = rgb.map((v, i) => sampleTable(firstTables[i], v));
  const clamp = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);
  const matrixOut: Rgb = [
    clamp(m[0] * c[0] + m[1] * c[1] + m[2] * c[2] + m[4]),
    clamp(m[5] * c[0] + m[6] * c[1] + m[7] * c[2] + m[9]),
    clamp(m[10] * c[0] + m[11] * c[1] + m[12] * c[2] + m[14]),
  ];
  if (transferBlocks.length < 2) return matrixOut;
  const finalTables = tablesFor(transferBlocks[1]);
  return matrixOut.map((v, i) => sampleTable(finalTables[i], v)) as Rgb;
}

describe("preview/export drift guard", () => {
  const samples: Rgb[] = [
    [0, 0, 0], [1, 1, 1], [0.5, 0.5, 0.5],
    [0.8, 0.2, 0.2], [0.2, 0.8, 0.3], [0.15, 0.35, 0.75],
    [0.95, 0.85, 0.6], [0.05, 0.1, 0.12],
  ];

  const grades: [string, ColorAdjustments][] = [
    ["identity", {}],
    ["exposure", { exposure: 35 }],
    ["contrast", { contrast: -40 }],
    ["warmth + tint", { warmth: 45, tint: -25 }],
    ["saturation + hue", { saturation: 55, colorTone: -30 }],
    ["split-tone", { shadowWarmth: -70, highlightWarmth: 65 }],
    ["shadows lift", { shadows: 70 }],
    ["highlight recovery", { highlights: -65 }],
    ["shadows + highlights opposed", { shadows: 60, highlights: -60 }],
    ["teal/amber film look", { contrast: 22, saturation: 12, shadowWarmth: -55, highlightWarmth: 60, highlightTint: -12 }],
    ["full panel", { exposure: 12, contrast: 18, shadows: 40, highlights: -35, saturation: 20, warmth: 25, shadowWarmth: -30, highlightWarmth: 35 }],
    ["cotton candy Colorize", { colorize: { shadowColor: "#75c9ff", highlightColor: "#ffabd8", intensity: 42 } }],
  ];

  // The tables quantise the curve to CURVE_SAMPLES steps, so the SVG path can
  // only match gradePixel to within one interpolation interval.
  const tolerance = 2 / CURVE_SAMPLES;

  for (const [name, adj] of grades) {
    it(`agrees between the SVG path and gradePixel — ${name}`, () => {
      const filter = gradeSvgFilter(adj);
      for (const rgb of samples) {
        const viaSvg = filter === "none" ? rgb : evalSvgPath(filter, rgb);
        const viaPixel = gradePixel(adj, rgb);
        for (let i = 0; i < 3; i++) {
          expect(Math.abs(viaSvg[i] - viaPixel[i])).toBeLessThan(tolerance);
        }
      }
    });
  }

  it("the baked lattice reproduces gradePixel at its own grid points", () => {
    const adj: ColorAdjustments = { exposure: 20, shadowWarmth: -50, saturation: 30 };
    const size = 9;
    const last = size - 1;
    const r = rows(gradeCube(adj, size));
    for (let i = 0; i < r.length; i += 37) {
      const ri = i % size;
      const gi = Math.floor(i / size) % size;
      const bi = Math.floor(i / (size * size));
      const expected = gradePixel(adj, [ri / last, gi / last, bi / last]);
      for (let c = 0; c < 3; c++) expect(r[i][c]).toBeCloseTo(expected[c], 4);
    }
  });
});
