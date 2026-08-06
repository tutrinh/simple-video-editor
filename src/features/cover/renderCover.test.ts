import { describe, expect, it } from "vitest";
import type { CoverTitle } from "../../domain/types";
import { canvasDims } from "../export/export";
import { kenBurnsVisibleCenter, rotationCoverScale } from "../../studio/util";
import { coverCropRect, coverRenderScale, drawCoverPicture, resolveCoverTitle, visibleTitles } from "./renderCover";

const round = (r: { sx: number; sy: number; sw: number; sh: number }) => ({
  sx: Math.round(r.sx), sy: Math.round(r.sy), sw: Math.round(r.sw), sh: Math.round(r.sh),
});

/** Where the crop's centre sits as a 0..1 fraction of the source. */
const centreX = (r: { sx: number; sw: number }, fw: number) => (r.sx + r.sw / 2) / fw;

describe("coverCropRect — cover-fit floor", () => {
  it("is the identity when the source already matches the canvas", () => {
    const [w, h] = canvasDims("16:9");
    expect(round(coverCropRect(1920, 1080, w, h, 1, 0, 0)))
      .toEqual({ sx: 0, sy: 0, sw: 1920, sh: 1080 });
  });

  it("crops the sides — never letterboxes — taking 16:9 into 9:16", () => {
    // The whole reason a Cover recrops rather than centre-fitting: bars on a
    // thumbnail are just a worse thumbnail.
    const [w, h] = canvasDims("9:16");
    const r = round(coverCropRect(1920, 1080, w, h, 1, 0, 0));
    expect(r.sh).toBe(1080);           // full height retained
    expect(r.sw).toBe(608);            // 1080 * (1080/1920)
    expect(r.sy).toBe(0);
    expect(r.sx).toBe(Math.round((1920 - 608) / 2)); // centred by default
  });

  it("crops top and bottom taking 9:16 into 16:9", () => {
    const [w, h] = canvasDims("16:9");
    const r = round(coverCropRect(1080, 1920, w, h, 1, 0, 0));
    expect(r.sw).toBe(1080);
    expect(r.sh).toBe(608);
    expect(r.sx).toBe(0);
  });

  it("produces a crop of the canvas aspect for every aspect", () => {
    for (const aspect of ["16:9", "9:16", "1:1", "4:5"] as const) {
      const [w, h] = canvasDims(aspect);
      const r = coverCropRect(4000, 3000, w, h, 1, 0, 0);
      expect(r.sw / r.sh).toBeCloseTo(w / h, 5);
      // and never samples outside the source
      expect(r.sx).toBeGreaterThanOrEqual(0);
      expect(r.sy).toBeGreaterThanOrEqual(0);
      expect(r.sx + r.sw).toBeLessThanOrEqual(4000 + 1e-6);
      expect(r.sy + r.sh).toBeLessThanOrEqual(3000 + 1e-6);
    }
  });
});

describe("coverCropRect — zoom", () => {
  it("halves the sampled region at 2x", () => {
    const [w, h] = canvasDims("16:9");
    const one = coverCropRect(1920, 1080, w, h, 1, 0, 0);
    const two = coverCropRect(1920, 1080, w, h, 2, 0, 0);
    expect(two.sw).toBeCloseTo(one.sw / 2, 5);
    expect(two.sh).toBeCloseTo(one.sh / 2, 5);
  });

  it("keeps the crop centred at 2x with no pan", () => {
    const [w, h] = canvasDims("16:9");
    expect(round(coverCropRect(1920, 1080, w, h, 2, 0, 0)))
      .toEqual({ sx: 480, sy: 270, sw: 960, sh: 540 });
  });

  it("treats zoom below 1 as 1 rather than exposing background", () => {
    const [w, h] = canvasDims("16:9");
    expect(coverCropRect(1920, 1080, w, h, 0.5, 0, 0))
      .toEqual(coverCropRect(1920, 1080, w, h, 1, 0, 0));
  });

  it("survives a zoom that never got set", () => {
    const [w, h] = canvasDims("16:9");
    expect(coverCropRect(1920, 1080, w, h, NaN, NaN, NaN))
      .toEqual(coverCropRect(1920, 1080, w, h, 1, 0, 0));
  });
});

describe("coverCropRect — focus", () => {
  it("clamps flush to the edges at the extremes and never samples outside", () => {
    const [w, h] = canvasDims("16:9");
    const right = coverCropRect(1920, 1080, w, h, 2, 50, 0);
    expect(right.sx + right.sw).toBeCloseTo(1920, 5);
    const left = coverCropRect(1920, 1080, w, h, 2, -50, 0);
    expect(left.sx).toBeCloseTo(0, 5);
    const bottom = coverCropRect(1920, 1080, w, h, 2, 0, 50);
    expect(bottom.sy + bottom.sh).toBeCloseTo(1080, 5);
  });

  it("agrees with the Beat's own focus rule, so a seeded framing matches", () => {
    // kenBurnsVisibleCenter is where the existing pipeline says the visible
    // centre lands. A Cover seeded from a Beat has to land in the same place or
    // "the Beat's value transfers as-is" is a lie.
    const [w, h] = canvasDims("16:9");
    for (const [zoom, focus] of [[2, 50], [2, -50], [3, 25], [1.5, 0], [2, 0]] as const) {
      const r = coverCropRect(1920, 1080, w, h, zoom, focus, 0);
      expect(centreX(r, 1920)).toBeCloseTo(kenBurnsVisibleCenter(zoom, focus), 6);
    }
  });

  it("pans across a mismatched source even at zoom 1", () => {
    // This is what makes a 16:9 capture into a real 9:16 cover: at zoom 1 there
    // is still leftover width to choose from, so the subject can be re-centred.
    const [w, h] = canvasDims("9:16");
    const left = coverCropRect(1920, 1080, w, h, 1, -50, 0);
    const mid = coverCropRect(1920, 1080, w, h, 1, 0, 0);
    const right = coverCropRect(1920, 1080, w, h, 1, 50, 0);
    expect(left.sx).toBeCloseTo(0, 5);
    expect(right.sx + right.sw).toBeCloseTo(1920, 5);
    expect(mid.sx).toBeGreaterThan(left.sx);
    expect(right.sx).toBeGreaterThan(mid.sx);
  });

  it("cannot pan when the source already matches the canvas at zoom 1", () => {
    const [w, h] = canvasDims("16:9");
    expect(coverCropRect(1920, 1080, w, h, 1, 50, 50))
      .toEqual(coverCropRect(1920, 1080, w, h, 1, -50, -50));
  });
});

describe("coverCropRect — degenerate input", () => {
  it("does not divide by zero or return a negative region", () => {
    for (const [fw, fh] of [[0, 0], [-100, 100], [NaN, 1080], [1, 1]]) {
      const r = coverCropRect(fw, fh, 1920, 1080, 1, 0, 0);
      expect(r.sw).toBeGreaterThan(0);
      expect(r.sh).toBeGreaterThan(0);
      expect(Number.isFinite(r.sx)).toBe(true);
      expect(Number.isFinite(r.sy)).toBe(true);
    }
  });
});

function title(over: Partial<CoverTitle> = {}): CoverTitle {
  return {
    id: "t1", enabled: true, text: "HELLO", fontId: "", fontFile: null,
    weight: 700, sizePx: 90, letterSpacing: 0, arcDeg: 0, shadow: true,
    color: "#ffffff", posX: 0, posY: 0, ...over,
  };
}

describe("visibleTitles", () => {
  it("drops disabled layers and blank text", () => {
    const kept = visibleTitles([
      title({ id: "a" }),
      title({ id: "b", enabled: false }),
      title({ id: "c", text: "" }),
      title({ id: "d", text: "   " }),
    ]);
    expect(kept.map((t) => t.id)).toEqual(["a"]);
  });
});

describe("coverRenderScale — the preview/download parity bug", () => {
  // The on-screen canvas and the downloaded file were the same renderCover call
  // at two sizes, which made everything relative agree — crop, Veil, Stickers —
  // and left Titles behind, because sizePx is absolute. The proof drew a 120px
  // title into a 900px frame and the download drew the same 120px into a 1920px
  // frame, so it wrapped in one and not the other.
  it("is 1 at the Cover's true output size", () => {
    for (const aspect of ["16:9", "9:16", "1:1", "4:5"] as const) {
      const [w] = canvasDims(aspect);
      expect(coverRenderScale(aspect, w)).toBe(1);
    }
  });

  it("is the fraction of full width the render is happening at", () => {
    const [full] = canvasDims("9:16"); // 1080
    expect(coverRenderScale("9:16", full / 2)).toBeCloseTo(0.5, 6);
    expect(coverRenderScale("9:16", 506)).toBeCloseTo(506 / full, 6);
  });

  it("accounts for the aspects having different widths", () => {
    // 16:9 is 1920 wide and 9:16 is 1080, so the same canvas width is a very
    // different fraction of each. Scaling off a constant would be wrong for one.
    expect(coverRenderScale("16:9", 960)).toBeCloseTo(0.5, 6);
    expect(coverRenderScale("9:16", 960)).toBeCloseTo(960 / 1080, 6);
  });

  it("never returns 0 or NaN, which would collapse or erase the title", () => {
    expect(coverRenderScale("9:16", 0)).toBe(1);
    expect(coverRenderScale("9:16", NaN)).toBe(1);
    expect(coverRenderScale("9:16", -100)).toBe(1);
  });
});

describe("resolveCoverTitle scaling", () => {
  const t = title({ sizePx: 120, letterSpacing: 4 });

  it("leaves an output-size render untouched", async () => {
    const out = await resolveCoverTitle(t, 1);
    expect(out.sizePx).toBe(120);
    expect(out.letterSpacing).toBe(4);
  });

  it("scales the absolute pixel sizes, so a proof is a faithful miniature", async () => {
    const out = await resolveCoverTitle(t, 0.5);
    expect(out.sizePx).toBe(60);
    expect(out.letterSpacing).toBe(2);
  });

  it("keeps the ratio of title size to frame width constant across sizes", async () => {
    // This ratio IS the thing that differed between preview and download.
    const full = await resolveCoverTitle(t, 1);
    const proof = await resolveCoverTitle(t, 900 / 1080);
    expect(proof.sizePx / 900).toBeCloseTo(full.sizePx / 1080, 6);
  });

  it("leaves an unset letterSpacing unset rather than turning it into 0", async () => {
    const out = await resolveCoverTitle(title({ letterSpacing: undefined }), 0.5);
    expect(out.letterSpacing).toBeUndefined();
  });
});

// A recording stub, since canvas cannot be inspected in this environment.
function fakeCtx() {
  const ops: { op: string; args: number[] }[] = [];
  const push = (op: string, ...args: number[]) => { ops.push({ op, args }); };
  const ctx = {
    save: () => push("save"),
    restore: () => push("restore"),
    translate: (...a: number[]) => push("translate", ...a),
    rotate: (...a: number[]) => push("rotate", ...a),
    scale: (...a: number[]) => push("scale", ...a),
    drawImage: (_img: unknown, ...a: number[]) => push("drawImage", ...a),
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, ops };
}

const img = {} as CanvasImageSource;
const crop = { sx: 10, sy: 20, sw: 300, sh: 400 };

describe("drawCoverPicture — rotation", () => {
  it("draws straight into the frame when there is no rotation", () => {
    const { ctx, ops } = fakeCtx();
    drawCoverPicture(ctx, img, crop, 1080, 1920, 0);
    expect(ops.filter((o) => o.op === "rotate")).toHaveLength(0);
    expect(ops.filter((o) => o.op === "scale")).toHaveLength(0);
    expect(ops.find((o) => o.op === "drawImage")!.args)
      .toEqual([10, 20, 300, 400, 0, 0, 1080, 1920]);
  });

  it("rotates about the centre", () => {
    const { ctx, ops } = fakeCtx();
    drawCoverPicture(ctx, img, crop, 1080, 1920, 5);
    expect(ops.find((o) => o.op === "translate")!.args).toEqual([540, 960]);
    expect(ops.find((o) => o.op === "rotate")!.args[0]).toBeCloseTo((5 * Math.PI) / 180, 8);
    // and the image is drawn centred on that origin
    const draw = ops.find((o) => o.op === "drawImage")!.args;
    expect(draw.slice(4)).toEqual([-540, -960, 1080, 1920]);
  });

  it("scales up to cover, so a rotation never shows the corners it exposes", () => {
    // A Beat leaves those corners visible on purpose; a cover image with wedges
    // of background in the corners just reads as broken.
    const { ctx, ops } = fakeCtx();
    drawCoverPicture(ctx, img, crop, 1080, 1920, 5);
    const scale = ops.find((o) => o.op === "scale")!.args;
    expect(scale[0]).toBe(rotationCoverScale(1080, 1920, 5));
    expect(scale[0]).toBeGreaterThan(1);
    expect(scale[0]).toBe(scale[1]); // uniform — never distorts the picture
  });

  it("scales by the same amount whichever way it leans", () => {
    const { ctx: a, ops: opsA } = fakeCtx();
    const { ctx: b, ops: opsB } = fakeCtx();
    drawCoverPicture(a, img, crop, 1080, 1920, 7);
    drawCoverPicture(b, img, crop, 1080, 1920, -7);
    expect(opsA.find((o) => o.op === "scale")!.args[0])
      .toBe(opsB.find((o) => o.op === "scale")!.args[0]);
  });

  it("brackets its work so the rotation cannot leak into the Veil or the text", () => {
    const { ctx, ops } = fakeCtx();
    drawCoverPicture(ctx, img, crop, 1080, 1920, 5);
    expect(ops[0].op).toBe("save");
    expect(ops[ops.length - 1].op).toBe("restore");
  });

  it("treats a missing or broken rotation as none", () => {
    for (const bad of [undefined, NaN]) {
      const { ctx, ops } = fakeCtx();
      drawCoverPicture(ctx, img, crop, 1080, 1920, bad as number);
      expect(ops.filter((o) => o.op === "rotate")).toHaveLength(0);
    }
  });
});
