import { useState } from "react";
import type { Clip } from "../domain/types";
import { useProject } from "../state/ProjectContext";
import { sampleFrames, stillFrame } from "../lib/frameSampler";
import { runPool } from "../lib/pool";
import { multithreadReady } from "../lib/ffmpegEngine";
import { createClip, needsNormalize, normalizeTo1080p, isStillFile } from "../features/ingest/ingest";

export type IngestPhase = "pending" | "normalizing" | "ready" | "error";
export interface IngestStatus { phase: IngestPhase; progress: number; error?: string }

function normalizeConcurrency(): number {
  if (multithreadReady()) return 1;
  const mem = (navigator as { deviceMemory?: number }).deviceMemory;
  if (typeof mem === "number" && mem <= 4) return 1;
  return 2;
}

export function useClipIngest() {
  const { dispatch } = useProject();
  const [statuses, setStatuses] = useState<Record<string, IngestStatus>>({});
  const setStatus = (id: string, status: IngestStatus) =>
    setStatuses((previous) => ({ ...previous, [id]: status }));

  async function ingestFiles(files: File[]): Promise<Clip[]> {
    const usable = files.filter((file) =>
      isStillFile(file) || file.type.startsWith("video/") || /\.(mp4|mov|m4v|webm)$/i.test(file.name));
    if (usable.length === 0) return [];

    const created: Clip[] = [];
    for (const file of usable) {
      try { created.push(await createClip(file)); } catch { /* unreadable — skip */ }
    }
    if (created.length) dispatch({ type: "ADD_CLIPS", clips: created });

    void runPool(created, normalizeConcurrency(), async (clip) => {
      setStatus(clip.id, { phase: "pending", progress: 0 });
      try {
        const frame = clip.kind === "still"
          ? await stillFrame(clip.file)
          : (await sampleFrames(clip.file, 1))[0];
        if (frame) dispatch({ type: "SET_POSTER", id: clip.id, poster: frame.dataUrl });
      } catch { /* poster best-effort */ }

      if (needsNormalize(clip)) {
        setStatus(clip.id, { phase: "normalizing", progress: 0 });
        try {
          const blob = await normalizeTo1080p(clip.file, (progress) =>
            setStatus(clip.id, { phase: "normalizing", progress }));
          dispatch({ type: "SET_NORMALIZED", id: clip.id, normalized: blob });
          setStatus(clip.id, { phase: "ready", progress: 1 });
        } catch (error) {
          setStatus(clip.id, {
            phase: "error",
            progress: 0,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      } else {
        setStatus(clip.id, { phase: "ready", progress: 1 });
      }
    });

    return created;
  }

  return { ingestFiles, statuses };
}
