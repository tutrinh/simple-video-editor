import type { ColorAdjustments } from "../domain/types";

/**
 * A conservative, camera-agnostic normalization for flat-looking footage.
 *
 * This is deliberately a display look rather than a technical log transform:
 * without a known input transfer function there is no mathematically exact
 * conversion to Rec.709. The preset restores contrast and saturation while
 * using the Grade's tonal controls to keep the result from becoming harsh.
 */
export const AUTO_REC709_GRADE: Readonly<ColorAdjustments> = Object.freeze({
  contrast: 32,
  shadows: 6,
  highlights: -12,
  saturation: 24,
});

/** Return a fresh object so a Beat can safely own and fine-tune the preset. */
export function autoRec709Grade(): ColorAdjustments {
  return { ...AUTO_REC709_GRADE };
}

