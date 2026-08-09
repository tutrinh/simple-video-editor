import { useId } from "react";
import type { LedMatrixEffect } from "../../domain/types";
import { ledMatrixCellGeometry, normalizeLedMatrixEffect } from "./ledMatrix";

interface Props {
  effect: LedMatrixEffect;
  width: number;
  height: number;
}

/** Circular cutout mask placed over the sampled mosaic preview. */
export default function LedMatrixOverlay({ effect, width, height }: Props) {
  const normalized = normalizeLedMatrixEffect(effect);
  const cell = ledMatrixCellGeometry(normalized.cellSizePx);
  const patternId = `pixel-circle-${useId().replace(/:/g, "")}`;
  const coverMaskId = `${patternId}-cover`;
  if (!normalized.enabled || normalized.shape !== "pixelate-circle") return null;

  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 4 }}
    >
      <defs>
        <pattern id={patternId} width={cell.size} height={cell.size} patternUnits="userSpaceOnUse">
          <rect width={cell.size} height={cell.size} fill="#fff" />
          <circle cx={cell.size / 2} cy={cell.size / 2} r={cell.radius} fill="#000" />
        </pattern>
        <mask id={coverMaskId}>
          <rect width={width} height={height} fill={`url(#${patternId})`} />
        </mask>
      </defs>
      <rect width={width} height={height} fill={normalized.backgroundColor} mask={`url(#${coverMaskId})`} />
    </svg>
  );
}
