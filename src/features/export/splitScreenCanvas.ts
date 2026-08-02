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

    const slotFilters: string[] = [
      `scale=${scaledW}:${scaledH}:force_original_aspect_ratio=increase:flags=fast_bilinear`,
      `crop=${slotW}:${slotH}`,
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
