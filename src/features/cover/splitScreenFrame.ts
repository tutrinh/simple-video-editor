import type { SplitLayoutType, SplitScreenSlot } from "../../domain/types";
import { coverCropRect } from "./renderCover";

// The THIRD encoding of the split-screen layout (ADR-0021). `getSplitLayoutCss`
// expresses it as CSS grid templates and `buildSplitScreenFilterGraph` re-derives
// it as cols/rows for ffmpeg; this one draws it. They were deliberately not
// unified, to keep this work away from the shipped encoder and its golden tests.
//
// This one follows the CSS PREVIEW, because capture is a WYSIWYG gesture off
// StagePreview. Pan used to be where that diverged — the ffmpeg path discarded
// panX/panY entirely (ARCHITECTURE_BACKLOG defect 3, since fixed) — so a test
// binds this renderer's effective displacement to `slotPanOffset`, which is what
// the encoder emits.
//
// It composites at CAPTURE time, into the stored frame — a Cover keeps its
// pixels, so there is nothing left to lay out by the time renderCover runs.

export interface SlotRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Columns × rows, matching `getSplitLayoutCss`'s grid templates one for one. */
const GRID: Record<SplitLayoutType, [cols: number, rows: number]> = {
  "none": [1, 1],
  "v2-stacked": [1, 2],
  "v2-side": [2, 1],
  "3-row": [1, 3],
  "3-col": [3, 1],
  "4-grid": [2, 2],
};

/**
 * Where each slot sits on a w×h frame, in reading order — the order
 * `buildSplitScreenFilterGraph`'s `xstack` also uses.
 *
 * Boundaries are rounded rather than sizes, so adjacent rects share an edge
 * exactly. Rounding sizes instead leaves a seam of background showing through on
 * any dimension that does not divide evenly, which at 1080/3 would be invisible
 * and at 1000/3 would not.
 */
export function splitSlotRects(layout: SplitLayoutType, w: number, h: number): SlotRect[] {
  const [cols, rows] = GRID[layout] ?? GRID.none;
  const edge = (i: number, n: number, total: number) => Math.round((i * total) / n);
  const rects: SlotRect[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x0 = edge(c, cols, w);
      const y0 = edge(r, rows, h);
      rects.push({ x: x0, y: y0, width: edge(c + 1, cols, w) - x0, height: edge(r + 1, rows, h) - y0 });
    }
  }
  return rects;
}

export interface SlotSource {
  image: CanvasImageSource;
  width: number;
  height: number;
}

/**
 * Draw the slots onto a w×h context.
 *
 * Each slot reproduces the preview's `overflow: hidden` cell containing media at
 * `object-fit: cover` under `transform: scale() translate() rotate()` about the
 * centre. The canvas calls are issued in that same order, so they compose to the
 * same matrix — note the translate lands *inside* the scale, exactly as CSS
 * applies it, which is why a panned slot at 2× moves twice as far.
 */
export function drawSplitScreenToCanvas(
  ctx: CanvasRenderingContext2D,
  layout: SplitLayoutType,
  slots: SplitScreenSlot[],
  sources: (SlotSource | undefined)[],
  w: number,
  h: number,
): void {
  const rects = splitSlotRects(layout, w, h);
  for (let i = 0; i < rects.length; i++) {
    const rect = rects[i];
    const source = sources[i];
    const slot = slots[i];

    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.width, rect.height);
    ctx.clip();

    // The preview cell's black backing. Without it a slot with no source shows
    // whatever the neighbouring slot spilled, rather than reading as empty.
    ctx.fillStyle = "#000000";
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);

    if (source) {
      ctx.translate(rect.x + rect.width / 2, rect.y + rect.height / 2);
      const scale = slot?.scale ?? 1;
      ctx.scale(scale, scale);
      ctx.translate(((slot?.panX ?? 0) / 100) * rect.width, ((slot?.panY ?? 0) / 100) * rect.height);
      ctx.rotate(((slot?.rotation ?? 0) * Math.PI) / 180);

      // object-fit: cover, which is coverCropRect with no zoom and no focus.
      const crop = coverCropRect(source.width, source.height, rect.width, rect.height, 1, 0, 0);
      ctx.drawImage(
        source.image,
        crop.sx, crop.sy, crop.sw, crop.sh,
        -rect.width / 2, -rect.height / 2, rect.width, rect.height,
      );
    }

    ctx.restore();
  }
}

/**
 * The source time a slot shows when the Beat is at `atSec`.
 *
 * Slots run together off the Beat's clock from their own in-points, so a slot's
 * own time is its in-point plus however far into the Beat we are.
 */
export function slotSourceTime(slotInSec: number, beatInSec: number, atSec: number): number {
  return Math.max(0, (slotInSec ?? 0) + Math.max(0, atSec - beatInSec));
}
