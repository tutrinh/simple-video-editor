import type { ProjectState } from "../state/projectReducer";
import type { Clip } from "../domain/types";
import { getClipBlobUrl } from "./blobUrlCache";
import { collectTitleFonts, stripTitleFonts, reinjectTitleFonts, titleFontKeys } from "./titleFontPersist";

const DB_NAME = "vidstr_projects_db";
const DB_VERSION = 2;
const ACTIVE_PROJECT_KEY = "simple_editor_active_project_id";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      return reject(new Error("IndexedDB is not supported in this environment"));
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains("projects")) {
        db.createObjectStore("projects", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("media_blobs")) {
        db.createObjectStore("media_blobs", { keyPath: "clipId" });
      }
      // v2: uploaded per-beat title fonts (structured clone preserves the File).
      if (!db.objectStoreNames.contains("title_fonts")) {
        db.createObjectStore("title_fonts", { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export interface SavedProjectMeta {
  id: string;
  title: string;
  clipCount: number;
  beatCount: number;
  updatedAt: number;
}

export async function saveProjectToStorage(state: ProjectState, projectId?: string): Promise<string> {
  const db = await openDB();
  const id = projectId || state.clips[0]?.id || "active-project";
  const title = state.title || "Untitled project";
  const updatedAt = Date.now();

  // 1. Save media Blobs to media_blobs object store
  const mediaTx = db.transaction("media_blobs", "readwrite");
  const mediaStore = mediaTx.objectStore("media_blobs");

  for (const clip of state.clips) {
    if (clip.file || clip.normalized) {
      mediaStore.put({
        clipId: clip.id,
        fileBlob: clip.file,
        normalizedBlob: clip.normalized,
        poster: clip.poster,
      });
    }
  }

  // 1b. Save uploaded per-beat title fonts (structured clone keeps the File),
  //     keyed per project so different projects can't collide or leak.
  const titleFonts = collectTitleFonts(state);
  if (titleFonts.length) {
    const fontTx = db.transaction("title_fonts", "readwrite");
    const fontStore = fontTx.objectStore("title_fonts");
    for (const { key, file } of titleFonts) {
      fontStore.put({ key: `${id}:${key}`, fontBlob: file });
    }
  }

  // 2. Prepare serializable state without non-serializable File/Blob objects
  //    (clip media and title-font Files are stored out-of-band above).
  const stripped = stripTitleFonts(state);
  const serializableClips = stripped.clips.map(({ file, normalized, ...rest }) => rest);
  const serializableState = {
    ...stripped,
    clips: serializableClips,
  };

  const projectRecord = {
    id,
    title,
    clipCount: state.clips.length,
    beatCount: state.cut?.beats.length ?? 0,
    updatedAt,
    stateJson: JSON.stringify(serializableState),
  };

  const projTx = db.transaction("projects", "readwrite");
  const projStore = projTx.objectStore("projects");
  projStore.put(projectRecord);

  if (typeof localStorage !== "undefined") {
    localStorage.setItem(ACTIVE_PROJECT_KEY, id);
  }

  return id;
}

export async function loadProjectFromStorage(projectId?: string): Promise<ProjectState | null> {
  const db = await openDB();
  const id = projectId || (typeof localStorage !== "undefined" ? localStorage.getItem(ACTIVE_PROJECT_KEY) : null);
  if (!id) return null;

  const projTx = db.transaction("projects", "readonly");
  const projStore = projTx.objectStore("projects");

  const projectRecord: any = await new Promise((resolve) => {
    const req = projStore.get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });

  if (!projectRecord || !projectRecord.stateJson) return null;

  const parsedState: ProjectState = JSON.parse(projectRecord.stateJson);

  // Rehydrate File and Blob objects from media_blobs object store
  const mediaTx = db.transaction("media_blobs", "readonly");
  const mediaStore = mediaTx.objectStore("media_blobs");

  const rehydratedClips: Clip[] = await Promise.all(
    parsedState.clips.map(async (clip) => {
      const mediaRecord: any = await new Promise((resolve) => {
        const req = mediaStore.get(clip.id);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      });

      if (!mediaRecord) return clip;

      const fileBlob = mediaRecord.fileBlob as File;
      const normalizedBlob = mediaRecord.normalizedBlob as Blob;

      // Pre-warm permanent Blob URL cache
      if (fileBlob) getClipBlobUrl(fileBlob);
      if (normalizedBlob) getClipBlobUrl(normalizedBlob);

      return {
        ...clip,
        file: fileBlob || clip.file,
        normalized: normalizedBlob || clip.normalized,
        poster: mediaRecord.poster || clip.poster,
      };
    })
  );

  // Rehydrate uploaded per-beat title fonts from the title_fonts store.
  const fontKeys = titleFontKeys(parsedState);
  const fontMap = new Map<string, Blob>();
  if (fontKeys.length) {
    const fontTx = db.transaction("title_fonts", "readonly");
    const fontStore = fontTx.objectStore("title_fonts");
    const results = await Promise.all(
      fontKeys.map(
        (k) =>
          new Promise<{ k: string; blob: Blob | null }>((resolve) => {
            const req = fontStore.get(`${id}:${k}`);
            req.onsuccess = () => resolve({ k, blob: (req.result as { fontBlob?: Blob } | undefined)?.fontBlob ?? null });
            req.onerror = () => resolve({ k, blob: null });
          }),
      ),
    );
    for (const r of results) if (r.blob) fontMap.set(r.k, r.blob);
  }

  return reinjectTitleFonts(
    {
      ...parsedState,
      clips: rehydratedClips,
    },
    fontMap,
  );
}

export async function listSavedProjects(): Promise<SavedProjectMeta[]> {
  const db = await openDB();
  const projTx = db.transaction("projects", "readonly");
  const projStore = projTx.objectStore("projects");

  return new Promise((resolve) => {
    const req = projStore.getAll();
    req.onsuccess = () => {
      const results: any[] = req.result || [];
      const metas = results.map((r) => ({
        id: r.id,
        title: r.title || "Untitled project",
        clipCount: r.clipCount || 0,
        beatCount: r.beatCount || 0,
        updatedAt: r.updatedAt || Date.now(),
      }));
      metas.sort((a, b) => b.updatedAt - a.updatedAt);
      resolve(metas);
    };
    req.onerror = () => resolve([]);
  });
}

export async function deleteProjectFromStorage(id: string): Promise<void> {
  const db = await openDB();
  const projTx = db.transaction("projects", "readwrite");
  const projStore = projTx.objectStore("projects");

  const projectRecord: any = await new Promise((resolve) => {
    const req = projStore.get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });

  if (projectRecord && projectRecord.stateJson) {
    try {
      const parsed: ProjectState = JSON.parse(projectRecord.stateJson);
      const mediaTx = db.transaction("media_blobs", "readwrite");
      const mediaStore = mediaTx.objectStore("media_blobs");
      for (const clip of parsed.clips) {
        mediaStore.delete(clip.id);
      }
      const fontKeys = titleFontKeys(parsed);
      if (fontKeys.length) {
        const fontTx = db.transaction("title_fonts", "readwrite");
        const fontStore = fontTx.objectStore("title_fonts");
        for (const k of fontKeys) fontStore.delete(`${id}:${k}`);
      }
    } catch (e) {
      console.error("Error cleaning up media_blobs on project delete:", e);
    }
  }

  projStore.delete(id);

  if (typeof localStorage !== "undefined" && localStorage.getItem(ACTIVE_PROJECT_KEY) === id) {
    localStorage.removeItem(ACTIVE_PROJECT_KEY);
  }
}
