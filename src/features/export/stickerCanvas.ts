/**
 * stickerCanvas.ts — Off-screen canvas renderer for the FFmpeg sticker pipeline.
 *
 * Given a StickerClip and the target canvas dimensions (w × h), renders the
 * sticker (PNG or SVG data-URL) onto a full-frame transparent RGBA canvas with
 * the sticker's posX/posY/scale/rotation applied, and returns the resulting PNG
 * bytes for FFmpeg input.
 *
 * This mirrors the titleCanvas.ts / captionCanvas.ts pattern (ADR-0008): the
 * same positioning math is shared with the live preview, so export exactly
 * matches what you see in StagePreview.
 */

import type { StickerClip } from "../../domain/types";

/**
 * Returns an HTMLImageElement loaded from a data: URL.
 * Resolves immediately if the browser decodes it synchronously (SVG/PNG).
 */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/**
 * Render a single sticker frame to a full-frame PNG Uint8Array.
 *
 * @param sticker  The StickerClip descriptor (posX, posY, scale, rotation, opacity).
 * @param w        Canvas width  (e.g. 1920 for 16:9, 1080 for 9:16).
 * @param h        Canvas height.
 * @returns        PNG bytes suitable for an FFmpeg `-i sticker_N.png` input,
 *                 or null on failure (the sticker is silently skipped in export).
 */
export async function renderStickerToPng(
  sticker: StickerClip,
  w: number,
  h: number,
): Promise<Uint8Array | null> {
  try {
    const img = await loadImage(sticker.src);

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    // The sticker's natural size: target ~15% of the shorter dimension, then
    // multiply by the user's scale slider.
    const baseSize = Math.min(w, h) * 0.15;
    const drawW = baseSize * sticker.scale;
    const drawH = img.naturalWidth > 0
      ? (drawW * img.naturalHeight) / img.naturalWidth
      : drawW;

    // Centre-anchored positioning:  posX/posY are %-offsets from the canvas centre.
    const cx = w / 2 + (sticker.posX / 100) * w;
    const cy = h / 2 + (sticker.posY / 100) * h;

    ctx.save();
    ctx.globalAlpha = sticker.opacity;
    ctx.translate(cx, cy);
    ctx.rotate((sticker.rotation * Math.PI) / 180);
    ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();

    return new Promise<Uint8Array | null>((resolve) => {
      canvas.toBlob((blob) => {
        if (!blob) { resolve(null); return; }
        blob.arrayBuffer().then((ab) => resolve(new Uint8Array(ab))).catch(() => resolve(null));
      }, "image/png");
    });
  } catch (err) {
    console.warn("renderStickerToPng failed for sticker", sticker.id, err);
    return null;
  }
}
