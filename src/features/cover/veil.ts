import type { Veil, VeilDirection } from "../../domain/types";
import { colorizeRgb } from "../../lib/colorize";

// The Veil: a colour laid over a Cover's picture, beneath its Stickers and
// Titles, so the photograph recedes and the text above it reads (ADR-0021).
//
// Nothing in this codebase drew a gradient before — every `linear-gradient` in
// src/ is UI chrome — so there is no existing renderer to stay in step with. The
// geometry is kept pure because the canvas cannot be asserted in this project's
// default `node` test environment.

/** A bottom-darkening fade: the standard treatment for text sitting low. */
export const DEFAULT_VEIL: Veil = {
  mode: "linear",
  color: "#000000",
  opacity: 0,
  toColor: "#000000",
  toOpacity: 0.8,
  direction: "down",
};

/** Expand `#abc` to `#aabbcc` so one hex parser can serve both forms. */
function expandHex(hex: string): string {
  const short = (hex || "").match(/^#?([0-9a-f]{3})$/i);
  if (!short) return hex;
  return `#${short[1].split("").map((c) => c + c).join("")}`;
}

/**
 * A canvas fill string. Reuses `colorizeRgb` for the channels rather than
 * re-parsing hex, so there stays one hex reader in the codebase; the opacity is
 * clamped here because a stored Veil can carry anything.
 */
export function veilRgba(hex: string, opacity: number): string {
  const [r, g, b] = colorizeRgb(expandHex(hex), "#000000");
  const a = Number.isFinite(opacity) ? Math.max(0, Math.min(1, opacity)) : 0;
  const ch = (v: number) => Math.round(v * 255);
  return `rgba(${ch(r)}, ${ch(g)}, ${ch(b)}, ${a})`;
}

/**
 * The gradient's endpoints, as `createLinearGradient(x0, y0, x1, y1)` takes
 * them. The from-stop sits at the edge the direction points *away* from, so
 * "down" runs top → bottom and darkens the bottom.
 */
export function veilEndpoints(
  direction: VeilDirection,
  w: number,
  h: number,
): [number, number, number, number] {
  switch (direction) {
    case "down": return [0, 0, 0, h];
    case "up": return [0, h, 0, 0];
    case "right": return [0, 0, w, 0];
    case "left": return [w, 0, 0, 0];
  }
}

/** Lay the Veil over the whole frame. A no-op when there isn't one. */
export function drawVeil(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  veil: Veil | undefined,
  w: number,
  h: number,
): void {
  if (!veil) return;
  ctx.save();
  if (veil.mode === "solid") {
    ctx.fillStyle = veilRgba(veil.color, veil.opacity);
  } else {
    const [x0, y0, x1, y1] = veilEndpoints(veil.direction, w, h);
    const gradient = ctx.createLinearGradient(x0, y0, x1, y1);
    gradient.addColorStop(0, veilRgba(veil.color, veil.opacity));
    gradient.addColorStop(1, veilRgba(veil.toColor, veil.toOpacity));
    ctx.fillStyle = gradient;
  }
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}
