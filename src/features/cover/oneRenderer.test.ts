import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// ADR-0021's load-bearing claim is that a Cover has ONE renderer: the canvas the
// author edits is the canvas that downloads. Nothing in the type system enforces
// that — someone adding a "quick thumbnail" or an export-time redraw would break
// it silently, and the parity bugs in ARCHITECTURE_BACKLOG Candidate B are what
// that looks like a year later.
//
// This lives at source level for the same reason lookNotGlobal.test.ts does: the
// defect is the PRESENCE of a second drawing path, which no runtime assertion
// over a correct render can see.

const read = (p: string) => fs.readFileSync(path.resolve(p), "utf8");

const COVER_DIR = path.resolve("src/features/cover");
const coverFiles = fs.readdirSync(COVER_DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

/** Every source file that could plausibly draw, minus the renderer itself. */
function otherSources(): { name: string; text: string }[] {
  const dirs = ["src/studio", "src/features/cover", "src/features/export"];
  const out: { name: string; text: string }[] = [];
  for (const dir of dirs) {
    for (const f of fs.readdirSync(path.resolve(dir))) {
      if (!/\.tsx?$/.test(f) || /\.test\.tsx?$/.test(f)) continue;
      if (dir === "src/features/cover" && f === "renderCover.ts") continue;
      out.push({ name: `${dir}/${f}`, text: read(path.join(dir, f)) });
    }
  }
  return out;
}

describe("one renderer", () => {
  it("draws a Cover's Veil in exactly one place", () => {
    const offenders = otherSources().filter((s) => {
      // veil.ts declares it; renderCover.ts (already excluded) is the one caller.
      const calls = s.text.replace(/export function drawVeil\s*\(/g, "");
      return /\bdrawVeil\s*\(/.test(calls);
    });
    expect(offenders.map((s) => s.name)).toEqual([]);
  });

  it("routes the drawer's preview and its download through the same call", () => {
    const drawer = read("src/studio/CoverDrawer.tsx");
    // Exactly one renderCover call site, inside `paint`.
    expect(drawer.match(/renderCover\s*\(/g) ?? []).toHaveLength(1);
    // And both consumers reach it through paint() rather than re-implementing.
    expect(drawer).toMatch(/const paint = useCallback/);
    const paintCalls = drawer.match(/await paint\(/g) ?? [];
    expect(paintCalls.length).toBeGreaterThanOrEqual(3); // proof, size readout, download
  });

  it("keeps the Grade ahead of the Veil, which cannot be seen in a passing render", () => {
    // Reversed, gradePixel would grade the Veil and the text along with the
    // picture — a subtly wrong image, not a crash.
    const source = read("src/features/cover/renderCover.ts");
    const grade = source.indexOf("applyGradeToCanvas(ctx");
    const veil = source.indexOf("drawVeil(ctx");
    const sticker = source.indexOf("drawSticker(ctx");
    const title = source.indexOf("drawTitleLayer(ctx");
    expect(grade).toBeGreaterThan(-1);
    expect(veil).toBeGreaterThan(grade);
    expect(sticker).toBeGreaterThan(veil);
    expect(title).toBeGreaterThan(sticker);
  });

  it("tells the title renderer what size it is drawing at", () => {
    // "One renderer" only buys parity if it is scale-INVARIANT. A Title's sizePx
    // is absolute, so calling resolveCoverTitle without a scale draws the same
    // pixel size into the 900px proof and the 1080px download — which is how the
    // on-screen canvas and the downloaded file came to disagree about wrapping.
    const source = read("src/features/cover/renderCover.ts");
    expect(source).toMatch(/coverRenderScale\(cover\.aspect,\s*w\)/);
    expect(source).toMatch(/resolveCoverTitle\(title,\s*scale\)/);
  });

  it("never reaches for the 0.7-quality vision sampler", () => {
    // sampleFrameAt exists for Claude's vision, where small cheap frames are the
    // point. A Cover that used it would look soft and nobody would know why.
    for (const f of coverFiles) {
      expect(read(path.join("src/features/cover", f))).not.toMatch(/\bsampleFrameAt\b/);
    }
  });
});

describe("leaf artifact", () => {
  it("stores no pointer back into the Cut", () => {
    // A Cover keeps its pixels precisely so editing the Cut cannot reach it.
    const types = read("src/domain/types.ts");
    const coverBlock = types.slice(types.indexOf("export interface Cover {"));
    const body = coverBlock.slice(0, coverBlock.indexOf("\n}"));
    for (const forbidden of ["beatId", "clipId", "atSec", "sourceBeatId"]) {
      expect(body).not.toContain(forbidden);
    }
    expect(body).toContain("sourceLabel");
  });

  it("resolves the provenance label nowhere", () => {
    // sourceLabel is for the author's eye. If anything ever parses it back into
    // a Beat reference, the leaf property is gone without the type changing.
    const offenders = otherSources().filter((s) => /sourceLabel\s*\.(match|split|replace|indexOf)/.test(s.text));
    expect(offenders.map((s) => s.name)).toEqual([]);
  });
});

describe("title fields reach every surface", () => {
  // TitleLayerSettings -> TitleRenderLayer is mapped BY HAND in four places
  // (export.ts twice, FinalPreview, resolveCoverTitle). Adding a field means
  // four edits, and missing one produces a property that works in the preview
  // and vanishes from the export — the exact drift ARCHITECTURE_BACKLOG
  // Candidate B is about. Until one resolver exists, this is the guard.
  // Enumerated by hand once and it was WRONG — ExportView builds two more, via
  // the intermediate TitleLayer and PreviewTitleLayer types, so a title rotation
  // reached the editor and the Cover but never the export panel. Discovered by
  // hand, not by this test. So the list is now derived, not written down.
  function mappingSites(): string[] {
    const dirs = ["src/features/export", "src/features/cover", "src/studio"];
    const hits: string[] = [];
    for (const dir of dirs) {
      for (const f of fs.readdirSync(path.resolve(dir))) {
        if (!/\.tsx?$/.test(f) || /\.test\.tsx?$/.test(f)) continue;
        // The editor WRITES arcDeg as a patch rather than mapping a layer; it is
        // the authoring surface, not a hop in the chain.
        if (f === "TitleTreatmentEditor.tsx") continue;
        if (read(path.join(dir, f)).includes("arcDeg:")) hits.push(`${dir}/${f}`);
      }
    }
    return hits;
  }

  it("maps every visual field at every site that builds a render layer", () => {
    // Anchored on arcDeg — the neighbouring visual field — rather than counting
    // file-wide, because a Beat has its own unrelated `rotation` in export.ts.
    const missing: string[] = [];
    const sites = mappingSites();
    // If this ever drops to zero the check has quietly stopped checking.
    expect(sites.length).toBeGreaterThan(2);
    for (const site of sites) {
      const lines = read(site).split("\n");
      lines.forEach((line, i) => {
        if (!line.includes("arcDeg:")) return;
        const near = lines.slice(i, i + 3).join(" ");
        if (!/\brotation:/.test(near)) missing.push(`${site}:${i + 1}`);
      });
    }
    expect(missing).toEqual([]);
  });
});
