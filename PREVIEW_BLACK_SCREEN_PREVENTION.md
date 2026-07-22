# 🛡️ Prevention Guide: Black Video Preview Screen Bug & Permanent Architecture Fix

This document documents the root cause, permanent fix, and strict architectural rules to prevent the **Black Video Preview Screen** issue in the **Simple Video Editor** workspace.

---

## 1. Root Cause Analysis

The black video preview screen occurred due to a combination of **Blob URL lifecycle mismanagement** and **HTML5 Video API asynchronous seek latency**:

### Primary Root Cause: Premature Blob URL Revocation (`URL.revokeObjectURL`)
1. In `FinalPreview.tsx` and `StagePreview.tsx`, `clipUrlMap` was generated using `useMemo` with `URL.createObjectURL(src)`.
2. Every time project state changed (adding an overlay, duplicating an overlay, tweaking volume or caption text), `clips` or component dependencies updated, triggering the `useEffect` cleanup function.
3. The cleanup function executed `for (const url of clipUrlMap.values()) URL.revokeObjectURL(url)`.
4. **The Critical Failure**: This revoked the active Blob URL **while the active HTML5 `<video>` elements were currently reading and decoding video frames from it**.
5. The browser's HTML5 MediaEngine threw an immediate `MEDIA_ERR_SRC_NOT_SUPPORTED` / `ERR_FILE_NOT_FOUND` error, destroying the video buffer and rendering a solid **BLACK SQUARE**.

### Secondary Root Cause: Asynchronous Seeking & Early Returns
- **Asynchronous Seek Latency**: Setting `video.currentTime = inSec` is asynchronous in browser MediaEngines. Evaluating `if (video.currentTime >= outSec) pause()` on frame 1 of a beat transition checked stale end timestamps from previous beats, freezing the video before playback started.
- **React Rules of Hooks**: Placing `if (mode === "cut") return (...)` above `useEffect`/`useMemo` hooks caused hook count mismatches (1 hook vs 5 hooks), crashing React component trees.

---

## 2. Permanent Architectural Fix

### Permanent Blob URL Cache (`src/lib/blobUrlCache.ts`)
We implemented a module-level, WeakMap-backed Blob URL cache ([`blobUrlCache.ts`](file:///Users/prime/Documents/Web/projects/simple-video-editor/src/lib/blobUrlCache.ts)):

```ts
import { getClipBlobUrl } from "../lib/blobUrlCache";

// Guarantees ONE stable, cached Blob URL per File/Blob reference.
// Prevents premature revocation while <video> elements are active.
const blobUrl = getClipBlobUrl(clip.normalized ?? clip.file);
```

### Stable Frame Syncing & Auto-Rewind
- **Master Clock Sync**: Video pause/step logic is evaluated against the master clock (`beatElapsed`) rather than asynchronous `video.currentTime`.
- **Active Frame Sync**: A dedicated `useEffect` continuously syncs `v.currentTime = beat.inSec + (beatElapsed / duration) * span` when paused, ensuring a video frame is always visible.
- **Auto-Rewind**: Clicking **Play** when at the end of a cut (`elapsed >= totalCutDuration`) automatically rewinds to `0.0s`.

---

## 3. Strict Rules for Future Changes (What to Avoid)

All developers and AI agents modifying video rendering components **MUST** observe the following rules:

### 🚫 DO NOT:
1. **NEVER call `URL.createObjectURL` inside `useMemo` or render passes**. Always use `getClipBlobUrl(fileOrBlob)`.
2. **NEVER call `URL.revokeObjectURL` in component cleanup effects** for clips that are still active in the project state.
3. **NEVER place conditional returns (e.g. `if (mode === "cut") return`) above React Hooks**. Call ALL Hooks unconditionally at the top level of the component.
4. **NEVER rely on raw `video.currentTime` for pause/freeze checks** without checking `beatElapsed` from performance clock ticks.

### ✅ DO:
1. **Always use `getClipBlobUrl`** from [`src/lib/blobUrlCache.ts`](file:///Users/prime/Documents/Web/projects/simple-video-editor/src/lib/blobUrlCache.ts).
2. **Always wrap preview stages in `PreviewErrorBoundary`** so isolated render errors fall back gracefully without blanking the page.
3. **Run `npm test && npm run build`** to verify 0 errors before committing.
