import type { SplitScreenConfig, SplitLayoutType, SplitScreenSlot } from "../../domain/types";

/**
 * Returns the number of slots required for a given split layout.
 */
export function getSlotCountForLayout(layout: SplitLayoutType): number {
  switch (layout) {
    case "v2-stacked":
    case "v2-side":
      return 2;
    case "3-row":
    case "3-col":
      return 3;
    case "4-grid":
      return 4;
    case "none":
    default:
      return 1;
  }
}

/**
 * Normalizes a SplitScreenConfig, ensuring correct number of slots with valid clip IDs and inSecs.
 */
export function normalizeSplitConfig(
  config: SplitScreenConfig | undefined,
  defaultClipId: string,
  defaultInSec: number = 0
): SplitScreenConfig {
  if (!config || config.layout === "none") {
    return { layout: "none", slots: [{ clipId: defaultClipId, inSec: defaultInSec, volume: 1 }] };
  }

  const requiredCount = getSlotCountForLayout(config.layout);
  const slots: SplitScreenSlot[] = [];

  for (let i = 0; i < requiredCount; i++) {
    const existing = config.slots[i];
    if (existing && existing.clipId) {
      slots.push({
        clipId: existing.clipId,
        inSec: Math.max(0, existing.inSec ?? 0),
        volume: existing.volume ?? (i === 0 ? 1 : 0),
        scale: Math.max(1, Math.min(3, existing.scale ?? 1)),
        panX: Math.max(-50, Math.min(50, existing.panX ?? 0)),
        panY: Math.max(-50, Math.min(50, existing.panY ?? 0)),
        rotation: Math.max(-180, Math.min(180, existing.rotation ?? 0)),
      });
    } else {
      slots.push({
        clipId: defaultClipId,
        inSec: defaultInSec,
        volume: i === 0 ? 1 : 0,
        scale: 1,
        panX: 0,
        panY: 0,
        rotation: 0,
      });
    }
  }

  return { layout: config.layout, slots };
}

/**
 * Returns CSS transform properties for a single slot element inside preview containers.
 */
export function getSlotTransformStyle(slot: SplitScreenSlot): React.CSSProperties {
  const scale = slot.scale ?? 1;
  const panX = slot.panX ?? 0;
  const panY = slot.panY ?? 0;
  const rotation = slot.rotation ?? 0;

  const transforms: string[] = [];
  if (scale !== 1) transforms.push(`scale(${scale})`);
  if (panX !== 0 || panY !== 0) transforms.push(`translate(${panX}%, ${panY}%)`);
  if (rotation !== 0) transforms.push(`rotate(${rotation}deg)`);

  if (transforms.length === 0) return {};
  return { transform: transforms.join(" "), transformOrigin: "center center" };
}


/**
 * Returns CSS style attributes for rendering split screen slots in StagePreview / FinalPreview.
 */
export function getSplitLayoutCss(layout: SplitLayoutType): React.CSSProperties {
  switch (layout) {
    case "v2-stacked":
      return { display: "grid", gridTemplateRows: "1fr 1fr", gridTemplateColumns: "1fr", width: "100%", height: "100%" };
    case "v2-side":
      return { display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr", width: "100%", height: "100%" };
    case "3-row":
      return { display: "grid", gridTemplateRows: "1fr 1fr 1fr", gridTemplateColumns: "1fr", width: "100%", height: "100%" };
    case "3-col":
      return { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gridTemplateRows: "1fr", width: "100%", height: "100%" };
    case "4-grid":
      return { display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", width: "100%", height: "100%" };
    case "none":
    default:
      return { width: "100%", height: "100%" };
  }
}


/**
 * How far a slot's pan moves its picture, in output pixels.
 *
 * The preview applies `transform: scale(s) translate(panX%, panY%)` to media
 * that fills the slot, so the percentage resolves against the SLOT's size — and
 * because the scale sits outside the translate in the transform list, the
 * displacement is multiplied by it. A slot at 2× therefore pans twice as far for
 * the same slider position.
 *
 * Pure and exported so the export path and any future canvas path derive the
 * displacement from one place rather than two (ARCHITECTURE_BACKLOG defect 3 is
 * what the second one looks like).
 */
export function slotPanOffset(
  slot: Pick<SplitScreenSlot, "panX" | "panY" | "scale">,
  slotW: number,
  slotH: number,
): { dx: number; dy: number } {
  const scale = slot.scale ?? 1;
  return {
    dx: Math.round(slotW * scale * ((slot.panX ?? 0) / 100)),
    dy: Math.round(slotH * scale * ((slot.panY ?? 0) / 100)),
  };
}

/**
 * `crop` x/y expressions that shift the window opposite to the pan.
 *
 * Moving the picture right means taking the crop window from further LEFT, so
 * the offset is subtracted from the centred default. Returned as expressions
 * over `in_w`/`in_h` because the scaled size is not known until runtime —
 * `force_original_aspect_ratio=increase` depends on the source's own dimensions.
 *
 * Returns null for an unpanned slot so the emitted filter stays byte-identical
 * to what it was before pan was honoured. crop clips x/y into range itself, so a
 * pan that would push past the edge holds there; the CSS preview would show the
 * cell's black backing instead. They agree everywhere short of that limit.
 *
 * No commas: a filtergraph is comma-separated, and an expression containing one
 * would need escaping that is easy to get subtly wrong.
 */
export function slotCropExpr(
  slot: Pick<SplitScreenSlot, "panX" | "panY" | "scale">,
  slotW: number,
  slotH: number,
): { x: string; y: string } | null {
  const { dx, dy } = slotPanOffset(slot, slotW, slotH);
  if (dx === 0 && dy === 0) return null;
  return {
    x: `(in_w-out_w)/2-(${dx})`,
    y: `(in_h-out_h)/2-(${dy})`,
  };
}

/**
 * Generates FFmpeg filtergraph strings for multi-slot split screen composition.
 */
export function buildSplitScreenFilterGraph(
  config: SplitScreenConfig,
  canvasW: number,
  canvasH: number,
  inputIndexOffset: number = 0
): { filterGraph: string; outputLabel: string } {
  const { layout, slots } = config;
  if (layout === "none" || slots.length < 2) {
    return { filterGraph: "", outputLabel: `[${inputIndexOffset}:v]` };
  }

  const inputLabels: string[] = [];
  const chains: string[] = [];

  let cols = 1;
  let rows = 1;
  if (layout === "v2-stacked") { cols = 1; rows = 2; }
  else if (layout === "v2-side") { cols = 2; rows = 1; }
  else if (layout === "3-row") { cols = 1; rows = 3; }
  else if (layout === "3-col") { cols = 3; rows = 1; }
  else if (layout === "4-grid") { cols = 2; rows = 2; }

  const slotW = Math.round(canvasW / cols);
  const slotH = Math.round(canvasH / rows);

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const idx = inputIndexOffset + i;
    const label = `split_slot_${i}`;
    const scale = slot.scale ?? 1;
    const rot = slot.rotation ?? 0;

    const scaledW = Math.round(slotW * scale);
    const scaledH = Math.round(slotH * scale);

    const crop = slotCropExpr(slot, slotW, slotH);
    const slotFilters: string[] = [
      `scale=${scaledW}:${scaledH}:force_original_aspect_ratio=increase:flags=fast_bilinear`,
      crop ? `crop=${slotW}:${slotH}:${crop.x}:${crop.y}` : `crop=${slotW}:${slotH}`,
    ];


    if (rot !== 0) {
      const rad = (rot * Math.PI) / 180;
      slotFilters.push(`rotate=${rad.toFixed(4)}:ow=${slotW}:oh=${slotH}`);
    }

    chains.push(`[${idx}:v]${slotFilters.join(",")}[${label}]`);
    inputLabels.push(`[${label}]`);
  }

  if (layout === "v2-stacked") {
    chains.push(`${inputLabels.join("")}vstack=inputs=2[v_split]`);
  } else if (layout === "v2-side") {
    chains.push(`${inputLabels.join("")}hstack=inputs=2[v_split]`);
  } else if (layout === "3-row") {
    chains.push(`${inputLabels.join("")}vstack=inputs=3[v_split]`);
  } else if (layout === "3-col") {
    chains.push(`${inputLabels.join("")}hstack=inputs=3[v_split]`);
  } else if (layout === "4-grid") {
    const xstackLayout = `0_0|w0_0|0_h0|w0_h0`;
    chains.push(`${inputLabels.join("")}xstack=inputs=4:layout=${xstackLayout}[v_split]`);
  }

  return {
    filterGraph: chains.join("; "),
    outputLabel: "[v_split]",
  };
}
