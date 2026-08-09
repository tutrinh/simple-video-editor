import { describe, it, expect, vi } from "vitest";
import { needsNormalize, isHeicFile, isStillFile, prepareStillFile, COVER_FILE_ACCEPT } from "./ingest";

const { heicToMock } = vi.hoisted(() => ({ heicToMock: vi.fn() }));
vi.mock("heic-to", () => ({ heicTo: heicToMock }));

describe("needsNormalize", () => {
  it("never normalizes 4K or high-resolution video clips on import", () => {
    expect(needsNormalize({ width: 3840, height: 2160 })).toBe(false); // 4K landscape
    expect(needsNormalize({ width: 2160, height: 3840 })).toBe(false); // 4K portrait
  });
  it("passes clips at or under 1080p", () => {
    expect(needsNormalize({ width: 1920, height: 1080 })).toBe(false);
    expect(needsNormalize({ width: 1080, height: 1920 })).toBe(false); // 1080p portrait
    expect(needsNormalize({ width: 1280, height: 720 })).toBe(false);
  });
  it("never normalizes a Still or oversized video clip", () => {
    expect(needsNormalize({ width: 6000, height: 4000, kind: "still" })).toBe(false);
    expect(needsNormalize({ width: 6000, height: 4000, kind: "video" })).toBe(false);
  });
});

const f = (name: string, type = "") => ({ name, type });

describe("isStillFile", () => {
  it("accepts image MIME types", () => {
    for (const t of ["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif", "image/bmp", "image/heic", "image/heif"]) {
      expect(isStillFile(f("upload", t)), t).toBe(true);
    }
  });

  it("rejects video MIME types", () => {
    for (const t of ["video/mp4", "video/quicktime", "video/webm", "video/x-m4v"]) {
      expect(isStillFile(f("upload", t)), t).toBe(false);
    }
  });

  it("falls back to the extension when the browser gave no type", () => {
    for (const n of ["a.jpg", "a.jpeg", "a.png", "a.webp", "a.avif", "a.bmp", "a.gif", "a.heic", "a.heif"]) {
      expect(isStillFile(f(n)), n).toBe(true);
    }
    for (const n of ["a.mp4", "a.mov", "a.webm", "a.m4v", "a.avi"]) {
      expect(isStillFile(f(n)), n).toBe(false);
    }
  });

  it("is case-insensitive on the extension", () => {
    expect(isStillFile(f("HOLIDAY.JPG"))).toBe(true);
    expect(isStillFile(f("Holiday.PnG"))).toBe(true);
    expect(isStillFile(f("CLIP.MOV"))).toBe(false);
  });

  it("does not confuse .webm with .webp", () => {
    expect(isStillFile(f("loop.webm"))).toBe(false);
    expect(isStillFile(f("loop.webp"))).toBe(true);
  });

  it("lets MIME win over a misleading extension", () => {
    // Some pipelines rename on the way out; trust what the browser decoded.
    expect(isStillFile(f("photo.mp4", "image/jpeg"))).toBe(true);
    expect(isStillFile(f("clip.png", "video/mp4"))).toBe(false);
  });

  it("rejects what is neither, rather than guessing", () => {
    expect(isStillFile(f("notes"))).toBe(false);
    expect(isStillFile(f("archive.zip"))).toBe(false);
    expect(isStillFile(f("track.mp3", "audio/mpeg"))).toBe(false);
    expect(isStillFile(f(".jpg.txt"))).toBe(false);
  });

  it("only matches the extension at the end of the name", () => {
    expect(isStillFile(f("my.png.mov"))).toBe(false);
    expect(isStillFile(f("my.mov.png"))).toBe(true);
  });
});

describe("HEIC imports", () => {
  it("recognizes both Apple extensions and MIME types", () => {
    expect(isHeicFile(f("IMG_0001.HEIC"))).toBe(true);
    expect(isHeicFile(f("upload", "image/heic"))).toBe(true);
    expect(isHeicFile(f("upload", "image/heif"))).toBe(true);
  });

  it("does not let a misleading HEIC extension override a video MIME", () => {
    expect(isHeicFile(f("clip.heic", "video/mp4"))).toBe(false);
  });

  it("advertises HEIC and HEIF in still-image file pickers", () => {
    expect(COVER_FILE_ACCEPT).toContain("image/heic");
    expect(COVER_FILE_ACCEPT).toContain(".heic");
    expect(COVER_FILE_ACCEPT).toContain(".heif");
  });

  it("converts HEIC bytes to a JPEG File at the import boundary", async () => {
    heicToMock.mockResolvedValueOnce(new Blob(["jpeg"], { type: "image/jpeg" }));
    const source = new File(["heic"], "IMG_0001.HEIC", { type: "image/heic", lastModified: 123 });

    const prepared = await prepareStillFile(source);

    expect(heicToMock).toHaveBeenCalledWith({ blob: source, type: "image/jpeg", quality: 0.95 });
    expect(prepared.name).toBe("IMG_0001.jpg");
    expect(prepared.type).toBe("image/jpeg");
    expect(prepared.lastModified).toBe(123);
  });

  it("leaves ordinary still files untouched", async () => {
    const source = new File(["jpeg"], "photo.jpg", { type: "image/jpeg" });
    await expect(prepareStillFile(source)).resolves.toBe(source);
  });
});
