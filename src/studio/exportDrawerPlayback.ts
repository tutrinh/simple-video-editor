interface MediaContainer {
  querySelectorAll(selector: string): Iterable<{ pause: () => void }>;
}

export function pauseExportDrawerMedia(root: MediaContainer | null) {
  if (!root) return;
  for (const media of root.querySelectorAll("video, audio")) media.pause();
}
