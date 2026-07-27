export const TIMELINE_ZOOM_MIN = 1;
export const TIMELINE_ZOOM_MAX = 8;
export const TIMELINE_ZOOM_STEP = 0.5;

export function clampTimelineZoom(value: number): number {
  if (!Number.isFinite(value)) return TIMELINE_ZOOM_MIN;
  return Math.min(TIMELINE_ZOOM_MAX, Math.max(TIMELINE_ZOOM_MIN, value));
}

/** Pixel width of the one shared time canvas. Zoom 1 always fits the viewport. */
export function timelineCanvasWidth(viewportWidth: number, zoom: number): number {
  return Math.max(1, viewportWidth) * clampTimelineZoom(zoom);
}

/** Keep the time under a viewport-space anchor fixed while changing scale. */
export function anchoredScrollLeft(
  oldScrollLeft: number,
  anchorX: number,
  oldCanvasWidth: number,
  newCanvasWidth: number,
  viewportWidth: number,
): number {
  if (oldCanvasWidth <= 0 || newCanvasWidth <= 0) return 0;
  const anchorRatio = (oldScrollLeft + anchorX) / oldCanvasWidth;
  const desired = anchorRatio * newCanvasWidth - anchorX;
  return Math.min(Math.max(0, newCanvasWidth - viewportWidth), Math.max(0, desired));
}
