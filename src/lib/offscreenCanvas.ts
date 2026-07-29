/**
 * Canvas context helper supporting both DOM HTMLCanvasElement and OffscreenCanvas
 * in Web Workers and main thread environments.
 */
export interface AnyCanvas {
  width: number;
  height: number;
  getContext(contextId: "2d"): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  toBlob?(callback: (blob: Blob | null) => void, type?: string, quality?: number): void;
  convertToBlob?(options?: { type?: string; quality?: number }): Promise<Blob>;
}

export function createOffscreenOrDomCanvas(w: number, h: number): {
  canvas: AnyCanvas;
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
} {
  const width = Math.max(1, Math.round(w));
  const height = Math.max(1, Math.round(h));

  if (typeof OffscreenCanvas !== "undefined") {
    try {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext("2d");
      return { canvas: canvas as unknown as AnyCanvas, ctx };
    } catch {
      /* Fall back to DOM canvas below */
    }
  }

  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    return { canvas: canvas as unknown as AnyCanvas, ctx };
  }

  return {
    canvas: { width, height, getContext: () => null },
    ctx: null,
  };
}

export async function canvasToPngBuffer(canvas: AnyCanvas): Promise<Uint8Array | null> {
  if (canvas.convertToBlob) {
    try {
      const blob = await canvas.convertToBlob({ type: "image/png" });
      return new Uint8Array(await blob.arrayBuffer());
    } catch {
      /* Fall back to toBlob below */
    }
  }

  if (canvas.toBlob) {
    return new Promise((resolve) => {
      canvas.toBlob!(async (blob) => {
        if (!blob) {
          resolve(null);
          return;
        }
        resolve(new Uint8Array(await blob.arrayBuffer()));
      }, "image/png");
    });
  }

  return null;
}
