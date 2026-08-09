import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import type { LedMatrixEffect } from "../../domain/types";
import { normalizeLedMatrixEffect } from "./ledMatrix";

interface Props {
  effect: LedMatrixEffect | null;
  exportWidth: number;
  exportHeight: number;
  children: ReactNode;
}

function drawMedia(
  ctx: CanvasRenderingContext2D,
  media: HTMLVideoElement | HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const sourceWidth = media instanceof HTMLVideoElement ? media.videoWidth : media.naturalWidth;
  const sourceHeight = media instanceof HTMLVideoElement ? media.videoHeight : media.naturalHeight;
  if (!(sourceWidth > 0 && sourceHeight > 0 && width > 0 && height > 0)) return false;

  const style = getComputedStyle(media);
  const fit = style.objectFit || "fill";
  const previousFilter = ctx.filter;
  ctx.filter = style.filter && style.filter !== "none" ? style.filter : "none";
  try {
    if (fit === "cover") {
      const scale = Math.max(width / sourceWidth, height / sourceHeight);
      const cropWidth = width / scale;
      const cropHeight = height / scale;
      const sourceX = (sourceWidth - cropWidth) / 2;
      const sourceY = (sourceHeight - cropHeight) / 2;
      ctx.drawImage(media, sourceX, sourceY, cropWidth, cropHeight, x, y, width, height);
    } else if (fit === "contain") {
      const scale = Math.min(width / sourceWidth, height / sourceHeight);
      const drawWidth = sourceWidth * scale;
      const drawHeight = sourceHeight * scale;
      ctx.drawImage(media, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
    } else {
      ctx.drawImage(media, x, y, width, height);
    }
  } finally {
    ctx.filter = previousFilter;
  }
  return true;
}

/** Draws real low-resolution frames, then lets CSS enlarge those pixels. */
export default function PixelatePreview({ effect, exportWidth, exportHeight, children }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hasFrame, setHasFrame] = useState(false);
  const hasFrameRef = useRef(false);
  const normalized = effect ? normalizeLedMatrixEffect(effect) : null;
  const active = normalized?.enabled && (normalized.shape === "pixelate" || normalized.shape === "pixelate-circle");

  useLayoutEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas || !active) {
      hasFrameRef.current = false;
      setHasFrame(false);
      return;
    }

    canvas.width = Math.max(1, Math.ceil(exportWidth / normalized.cellSizePx));
    canvas.height = Math.max(1, Math.ceil(exportHeight / normalized.cellSizePx));
    let ctx: CanvasRenderingContext2D | null = null;
    try { ctx = canvas.getContext("2d"); } catch { return; }
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;

    let raf = 0;
    const draw = () => {
      const hostRect = host.getBoundingClientRect();
      if (hostRect.width > 0 && hostRect.height > 0) {
        ctx!.fillStyle = "#000";
        ctx!.fillRect(0, 0, canvas.width, canvas.height);
        let drewFrame = false;
        const media = host.querySelectorAll<HTMLVideoElement | HTMLImageElement>("video, img");
        media.forEach((item) => {
          if (item instanceof HTMLVideoElement && item.readyState < 2) return;
          if (item instanceof HTMLImageElement && !item.complete) return;
          const rect = item.getBoundingClientRect();
          const x = (rect.left - hostRect.left) / hostRect.width * canvas.width;
          const y = (rect.top - hostRect.top) / hostRect.height * canvas.height;
          const width = rect.width / hostRect.width * canvas.width;
          const height = rect.height / hostRect.height * canvas.height;
          try { drewFrame = drawMedia(ctx!, item, x, y, width, height) || drewFrame; } catch { /* keep source visible */ }
        });
        if (drewFrame && !hasFrameRef.current) {
          hasFrameRef.current = true;
          setHasFrame(true);
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [active, exportHeight, exportWidth, normalized?.cellSizePx]);

  return (
    <div ref={hostRef} style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <div
        data-pixel-source
        style={{
          position: "absolute",
          inset: 0,
          // Keep media mounted and playing so the canvas can sample it, but do
          // not composite the processed frame over a second visible copy.
          visibility: active && hasFrame ? "hidden" : "visible",
        }}
      >
        {children}
      </div>
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          imageRendering: "pixelated",
          visibility: active && hasFrame ? "visible" : "hidden",
          pointerEvents: "none",
          zIndex: 1,
        }}
      />
    </div>
  );
}
