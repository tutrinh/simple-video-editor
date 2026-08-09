import { describe, expect, it } from "vitest";
import type { LedMatrixEffect } from "../../domain/types";
import {
  effectiveLedMatrixEffect,
  LED_MATRIX_DEFAULT,
  LED_MATRIX_SHAPES,
  ledMatrixCellGeometry,
  normalizeLedMatrixEffect,
} from "./ledMatrix";

describe("pixel effects", () => {
  it("defaults to a large compression-safe Mosaic", () => {
    expect(LED_MATRIX_DEFAULT.cellSizePx).toBe(24);
    expect(LED_MATRIX_DEFAULT.shape).toBe("pixelate");
    expect(LED_MATRIX_DEFAULT.backgroundColor).toBe("#000000");
    expect(normalizeLedMatrixEffect({ enabled: true }).cellSizePx).toBe(24);
    expect(normalizeLedMatrixEffect({ cellSizePx: 2 }).cellSizePx).toBe(16);
  });

  it("offers only Mosaic and Circles", () => {
    expect(LED_MATRIX_SHAPES.map((shape) => shape.value)).toEqual(["pixelate", "pixelate-circle"]);
    expect(normalizeLedMatrixEffect({ shape: "pixelate-circle" }).shape).toBe("pixelate-circle");
  });

  it("safely migrates legacy styles to Mosaic", () => {
    const legacy = { shape: "halftone", blendMode: "screen", intensity: 0.5 } as unknown as LedMatrixEffect;
    expect(normalizeLedMatrixEffect(legacy).shape).toBe("pixelate");
  });

  it("normalizes a custom Circles background color", () => {
    expect(normalizeLedMatrixEffect({ backgroundColor: "#ff5a36" }).backgroundColor).toBe("#ff5a36");
    expect(normalizeLedMatrixEffect({ backgroundColor: "not-a-color" }).backgroundColor).toBe("#000000");
  });

  it("lets a Beat override or disable the Cut treatment", () => {
    expect(effectiveLedMatrixEffect(undefined, undefined)).toBeNull();
    expect(effectiveLedMatrixEffect(undefined, { enabled: true, cellSizePx: 32 })?.cellSizePx).toBe(32);
    expect(effectiveLedMatrixEffect({ enabled: true, cellSizePx: 20 }, { enabled: true, cellSizePx: 32 })?.cellSizePx).toBe(20);
    expect(effectiveLedMatrixEffect({ enabled: false }, { enabled: true })).toBeNull();
  });

  it("builds a broad circle inside every pixel cell", () => {
    const cell = ledMatrixCellGeometry(24);
    expect(cell.size).toBe(24);
    expect(cell.radius).toBeGreaterThan(8);
    expect(cell.radius).toBeLessThan(12);
  });
});
