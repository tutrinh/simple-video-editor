import type { LedMatrixEffect } from "../../domain/types";
import { canvasToPngBuffer, createOffscreenOrDomCanvas } from "../../lib/offscreenCanvas";

/** Large by design: dense one-pixel mosaics shimmer and break under social compression. */
export const LED_MATRIX_DEFAULT: Required<LedMatrixEffect> = {
  enabled: true,
  cellSizePx: 24,
  shape: "pixelate",
  backgroundColor: "#000000",
};

export const LED_MATRIX_SHAPES: ReadonlyArray<{ value: Required<LedMatrixEffect>["shape"]; label: string }> = [
  { value: "pixelate", label: "Mosaic" },
  { value: "pixelate-circle", label: "Circles" },
];

export const LED_MATRIX_MIN_CELL_PX = 16;
export const LED_MATRIX_MAX_CELL_PX = 48;

export function normalizeLedMatrixEffect(effect: LedMatrixEffect): Required<LedMatrixEffect> {
  const backgroundColor = /^#[0-9a-f]{6}$/i.test(effect.backgroundColor ?? "")
    ? effect.backgroundColor!
    : LED_MATRIX_DEFAULT.backgroundColor;
  return {
    enabled: effect.enabled !== false,
    cellSizePx: Math.round(Math.min(
      LED_MATRIX_MAX_CELL_PX,
      Math.max(LED_MATRIX_MIN_CELL_PX, effect.cellSizePx ?? LED_MATRIX_DEFAULT.cellSizePx),
    )),
    // Legacy LED/halftone values in saved Projects safely become Mosaic.
    shape: effect.shape === "pixelate-circle" ? "pixelate-circle" : "pixelate",
    backgroundColor,
  };
}

/** A Beat override wins; otherwise the Cut treatment flows through unchanged. */
export function effectiveLedMatrixEffect(
  beatEffect?: LedMatrixEffect,
  cutEffect?: LedMatrixEffect,
): Required<LedMatrixEffect> | null {
  const selected = beatEffect ?? cutEffect;
  if (!selected || selected.enabled === false) return null;
  return normalizeLedMatrixEffect(selected);
}

export function ledMatrixCellGeometry(cellSizePx: number): { size: number; radius: number } {
  const size = normalizeLedMatrixEffect({ cellSizePx }).cellSizePx;
  return { size, radius: size * 0.38 };
}

/** Full-frame circular aperture mask for export. Mosaic needs no sidecar. */
export async function renderLedMatrixToPng(
  effect: LedMatrixEffect,
  width: number,
  height: number,
): Promise<Uint8Array | null> {
  const normalized = normalizeLedMatrixEffect(effect);
  if (!normalized.enabled || normalized.shape !== "pixelate-circle") return null;
  const { canvas, ctx } = createOffscreenOrDomCanvas(width, height);
  if (!ctx) return null;

  const geometry = ledMatrixCellGeometry(normalized.cellSizePx);
  ctx.fillStyle = normalized.backgroundColor;
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = "destination-out";
  for (let y = 0; y < height; y += geometry.size) {
    for (let x = 0; x < width; x += geometry.size) {
      ctx.beginPath();
      ctx.arc(x + geometry.size / 2, y + geometry.size / 2, geometry.radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return canvasToPngBuffer(canvas);
}
