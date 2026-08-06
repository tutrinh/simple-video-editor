import { describe, expect, it } from "vitest";
import {
  COVER_JPEG_QUALITY,
  YOUTUBE_MAX_BYTES,
  coverEncodeOptions,
  coverExtension,
  coverFileName,
  coverMime,
  exceedsYouTubeLimit,
  formatCoverSize,
  aspectResolutionLabel,
} from "./coverExport";
import { canvasDims, projectFileBase } from "../export/export";

describe("projectFileBase", () => {
  it("hyphenates spaces and keeps case, so a Cover sits beside its video", () => {
    expect(projectFileBase("My Summer Trip")).toBe("My-Summer-Trip");
  });

  it("strips characters a filesystem or a platform would object to", () => {
    expect(projectFileBase("Trip: Day 1/2 <draft>")).toBe("Trip-Day-12-draft");
  });

  it("falls back rather than producing a nameless file", () => {
    expect(projectFileBase("")).toBe("highlight");
    expect(projectFileBase("   ")).toBe("highlight");
    // A title made entirely of stripped characters is the case that used to
    // yield a bare extension.
    expect(projectFileBase("///")).toBe("highlight");
    expect(projectFileBase("", "project")).toBe("project");
  });

  it("collapses runs of whitespace to a single hyphen", () => {
    expect(projectFileBase("a    b")).toBe("a-b");
  });
});

describe("coverFileName", () => {
  it("is one-based", () => {
    expect(coverFileName("My Trip", 0, "jpeg")).toBe("My-Trip-cover-1.jpg");
    expect(coverFileName("My Trip", 1, "jpeg")).toBe("My-Trip-cover-2.jpg");
  });

  it("uses .jpg rather than .jpeg, which is what every platform expects", () => {
    expect(coverFileName("t", 0, "jpeg").endsWith(".jpg")).toBe(true);
    expect(coverFileName("t", 0, "png").endsWith(".png")).toBe(true);
  });

  it("survives an unnamed project and a negative index", () => {
    expect(coverFileName("", 0, "png")).toBe("highlight-cover-1.png");
    expect(coverFileName("t", -5, "png")).toBe("t-cover-1.png");
  });
});

describe("coverEncodeOptions", () => {
  it("passes quality for JPEG", () => {
    expect(coverEncodeOptions("jpeg")).toEqual(["image/jpeg", COVER_JPEG_QUALITY]);
  });

  it("passes no quality for PNG", () => {
    // toBlob ignores quality for PNG, but passing one reads as though it does
    // something — and it is how you end up debugging a 'quality slider' that
    // never had an effect.
    expect(coverEncodeOptions("png")).toEqual(["image/png", undefined]);
  });

  it("agrees with coverMime and coverExtension", () => {
    for (const f of ["jpeg", "png"] as const) {
      expect(coverEncodeOptions(f)[0]).toBe(coverMime(f));
    }
    expect(coverExtension("jpeg")).toBe("jpg");
    expect(coverExtension("png")).toBe("png");
  });
});

describe("formatCoverSize", () => {
  it("reads in KB below a megabyte", () => {
    expect(formatCoverSize(412 * 1024)).toBe("412 KB");
    expect(formatCoverSize(1023 * 1024)).toBe("1023 KB");
  });

  it("switches to MB at a megabyte", () => {
    expect(formatCoverSize(1024 * 1024)).toBe("1.0 MB");
    expect(formatCoverSize(2.4 * 1024 * 1024)).toBe("2.4 MB");
  });

  it("never shows a negative or NaN size", () => {
    expect(formatCoverSize(0)).toBe("0 KB");
    expect(formatCoverSize(-5)).toBe("0 KB");
    expect(formatCoverSize(NaN)).toBe("0 KB");
  });
});

describe("exceedsYouTubeLimit", () => {
  it("is exactly 2MB, and 2MB itself passes", () => {
    expect(YOUTUBE_MAX_BYTES).toBe(2097152);
    expect(exceedsYouTubeLimit(YOUTUBE_MAX_BYTES)).toBe(false);
    expect(exceedsYouTubeLimit(YOUTUBE_MAX_BYTES + 1)).toBe(true);
  });

  it("clears a typical JPEG and catches a typical photographic PNG", () => {
    expect(exceedsYouTubeLimit(412 * 1024)).toBe(false);
    expect(exceedsYouTubeLimit(3.2 * 1024 * 1024)).toBe(true);
  });
});

describe("aspectResolutionLabel", () => {
  it("reports what each aspect actually exports at", () => {
    expect(aspectResolutionLabel("16:9")).toBe("1920 × 1080");
    expect(aspectResolutionLabel("9:16")).toBe("1080 × 1920");
    expect(aspectResolutionLabel("1:1")).toBe("1080 × 1080");
    expect(aspectResolutionLabel("4:5")).toBe("1080 × 1350");
  });

  it("is derived from canvasDims, so it cannot claim a size the renderer won't produce", () => {
    for (const aspect of ["16:9", "9:16", "1:1", "4:5"] as const) {
      const [w, h] = canvasDims(aspect);
      expect(aspectResolutionLabel(aspect)).toBe(`${w} × ${h}`);
    }
  });

  it("matches the aspect it names", () => {
    for (const aspect of ["16:9", "9:16", "1:1", "4:5"] as const) {
      const [a, b] = aspect.split(":").map(Number);
      const [w, h] = aspectResolutionLabel(aspect).split(" × ").map(Number);
      expect(w / h).toBeCloseTo(a / b, 5);
    }
  });
});
