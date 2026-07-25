import { describe, it, expect } from "vitest";
import { needsNormalize, isStillFile } from "./ingest";

describe("needsNormalize", () => {
  it("flags clips whose long edge exceeds 1080p", () => {
    expect(needsNormalize({ width: 3840, height: 2160 })).toBe(true); // 4K landscape
    expect(needsNormalize({ width: 2160, height: 3840 })).toBe(true); // 4K portrait
  });
  it("passes clips at or under 1080p", () => {
    expect(needsNormalize({ width: 1920, height: 1080 })).toBe(false);
    expect(needsNormalize({ width: 1080, height: 1920 })).toBe(false); // 1080p portrait
    expect(needsNormalize({ width: 1280, height: 720 })).toBe(false);
  });
  it("never normalizes a Still, however large (ADR-0012)", () => {
    // libx264 would make a one-frame video out of the photo.
    expect(needsNormalize({ width: 6000, height: 4000, kind: "still" })).toBe(false);
    expect(needsNormalize({ width: 6000, height: 4000, kind: "video" })).toBe(true);
  });
});

const f = (name: string, type = "") => ({ name, type });

describe("isStillFile", () => {
  it("accepts image MIME types", () => {
    for (const t of ["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif", "image/bmp"]) {
      expect(isStillFile(f("upload", t)), t).toBe(true);
    }
  });

  it("rejects video MIME types", () => {
    for (const t of ["video/mp4", "video/quicktime", "video/webm", "video/x-m4v"]) {
      expect(isStillFile(f("upload", t)), t).toBe(false);
    }
  });

  it("falls back to the extension when the browser gave no type", () => {
    for (const n of ["a.jpg", "a.jpeg", "a.png", "a.webp", "a.avif", "a.bmp", "a.gif"]) {
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
