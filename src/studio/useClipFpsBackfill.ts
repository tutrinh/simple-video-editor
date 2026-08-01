import { useEffect, useRef } from "react";
import type { Clip } from "../domain/types";
import { measureBlobFps } from "../lib/videoFps";

/**
 * Fill in the frame rate of Clips that do not carry one.
 *
 * Frame rate is measured at import, so every Clip in a Project saved before that
 * existed has none — and the badge in the Clip panel would stay blank forever
 * without this. Runs one Clip at a time: measuring means decoding and briefly
 * playing the file, and doing several at once competes for decoders.
 *
 * Each Clip is attempted at most once per session. A file that cannot report a
 * rate stays blank rather than being retried on every render.
 */
export function useClipFpsBackfill(
  clips: Clip[],
  onMeasured: (clipId: string, fps: number) => void,
): void {
  const attempted = useRef(new Set<string>());
  const running = useRef(false);
  // Held in a ref so a re-render with a new callback identity cannot restart the
  // queue or leave the loop calling a stale one.
  const report = useRef(onMeasured);
  report.current = onMeasured;

  useEffect(() => {
    const pending = clips.filter((clip) =>
      clip.kind !== "still"
      && !clip.isTemplatePlaceholder
      && !clip.fps
      && clip.file
      && !attempted.current.has(clip.id));
    if (!pending.length || running.current) return;

    let cancelled = false;
    running.current = true;

    (async () => {
      for (const clip of pending) {
        if (cancelled) break;
        attempted.current.add(clip.id);
        const fps = await measureBlobFps(clip.file).catch(() => undefined);
        if (cancelled) break;
        if (fps) report.current(clip.id, fps);
      }
      running.current = false;
    })();

    return () => {
      cancelled = true;
      running.current = false;
    };
  }, [clips]);
}
