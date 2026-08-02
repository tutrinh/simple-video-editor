import type { ProjectState } from "../state/projectReducer";
import type { Clip, ProjectTemplate } from "../domain/types";
import { getClipBlobUrl } from "./blobUrlCache";
import { migrateCutSpeeds } from "../domain/beatTiming";
import { stripTitleFonts, reinjectTitleFonts, titleFontKeys, promoteTitleFontsToAppLibrary } from "./titleFontPersist";
import { collectUserVoiceFiles, reinjectUserVoiceFiles, stripUserVoiceFiles, userVoiceKeys } from "./userVoicePersist";
import { appFontFileName } from "./fontLibrary";
import { fetchMusicFile, uploadMusic } from "./musicLibrary";

const DB_NAME = "vidstr_projects_db";
const DB_VERSION = 5;
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
      // v3: reusable project templates. Structured clone also preserves the
      // optional inspiration-video File retained by newer templates.
      if (!db.objectStoreNames.contains("templates")) {
        db.createObjectStore("templates", { keyPath: "id" });
      }
      // v4: microphone recordings used by User VO timeline segments.
      if (!db.objectStoreNames.contains("user_voice")) {
        db.createObjectStore("user_voice", { keyPath: "key" });
      }
      // v5: one analyzed, audio-only music track per project.
      if (!db.objectStoreNames.contains("music_tracks")) {
        db.createObjectStore("music_tracks", { keyPath: "projectId" });
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

  const musicTx = db.transaction("music_tracks", "readwrite");
  const musicStore = musicTx.objectStore("music_tracks");
  // New music assets live in MUSIC_DIR and the project keeps only fileName.
  // The IndexedDB store remains a migration source for older saved projects.
  if (state.musicTrack?.file && !state.musicTrack.fileName) musicStore.put({ projectId: id, fileBlob: state.musicTrack.file });
  else musicStore.delete(id);

  // Custom fonts are app assets in public/fonts/. Projects retain only their
  // app-font:<filename> reference; the title_fonts store is legacy read-only.
  const userVoiceFiles = collectUserVoiceFiles(state);
  if (userVoiceFiles.length) {
    const voiceTx = db.transaction("user_voice", "readwrite");
    const voiceStore = voiceTx.objectStore("user_voice");
    for (const { key, file } of userVoiceFiles) {
      voiceStore.put({ key: `${id}:${key}`, audioBlob: file });
    }
  }

  // 2. Prepare serializable state without non-serializable File/Blob objects.
  //    Clip media remains out-of-band; app fonts are represented by filename.
  const stripped = stripUserVoiceFiles(stripTitleFonts(state));
  const serializableClips = stripped.clips.map(({ file, normalized, ...rest }) => rest);
  const serializableMusicTrack = stripped.musicTrack
    ? (({ file: _file, ...track }) => track)(stripped.musicTrack)
    : undefined;
  const serializableState = {
    ...stripped,
    clips: serializableClips,
    musicTrack: serializableMusicTrack,
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

  let musicFile: File | undefined;
  let musicFileName = parsedState.musicTrack?.fileName;
  if (parsedState.musicTrack) {
    if (musicFileName) {
      try { musicFile = await fetchMusicFile(musicFileName); } catch { /* fall through to legacy project blob */ }
    }
    if (!musicFile) {
      const musicTx = db.transaction("music_tracks", "readonly");
      const musicRecord: any = await new Promise((resolve) => {
        const req = musicTx.objectStore("music_tracks").get(id);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      });
      const blob = musicRecord?.fileBlob as Blob | undefined;
      if (blob) {
        musicFile = blob instanceof File
          ? blob
          : new File([blob], parsedState.musicTrack.name, { type: blob.type || "audio/wav" });
        try { musicFileName = await uploadMusic(musicFile); } catch { /* legacy project remains usable */ }
      }
    }
  }

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

  const voiceMap = new Map<string, Blob>();
  const voiceKeys = userVoiceKeys(parsedState);
  if (voiceKeys.length) {
    const voiceTx = db.transaction("user_voice", "readonly");
    const voiceStore = voiceTx.objectStore("user_voice");
    const results = await Promise.all(
      voiceKeys.map((key) => new Promise<{ key: string; blob: Blob | null }>((resolve) => {
        const req = voiceStore.get(`${id}:${key}`);
        req.onsuccess = () => resolve({ key, blob: (req.result as { audioBlob?: Blob } | undefined)?.audioBlob ?? null });
        req.onerror = () => resolve({ key, blob: null });
      })),
    );
    for (const result of results) if (result.blob) voiceMap.set(result.key, result.blob);
  }

  const rehydrated = reinjectUserVoiceFiles(reinjectTitleFonts(
    {
      ...parsedState,
      clips: rehydratedClips,
      musicTrack: parsedState.musicTrack && musicFile
        ? { ...parsedState.musicTrack, file: musicFile, ...(musicFileName ? { fileName: musicFileName } : {}) }
        : undefined,
      cut: migrateCutSpeeds(parsedState.cut, rehydratedClips),
    },
    fontMap,
  ), voiceMap);
  const promoted = await promoteTitleFontsToAppLibrary(rehydrated);

  // Once a legacy embedded face has reached public/fonts/, remove its old
  // project-scoped duplicate from IndexedDB. Failed promotions remain intact.
  const promotedFontKeys: string[] = [];
  for (let beatIndex = 0; beatIndex < (rehydrated.cut?.beats.length ?? 0); beatIndex++) {
    const beforeBeat = rehydrated.cut!.beats[beatIndex];
    const afterBeat = promoted.cut!.beats[beatIndex];
    for (let layerIndex = 0; layerIndex < (beforeBeat.titleLayers?.length ?? 0); layerIndex++) {
      const before = beforeBeat.titleLayers![layerIndex];
      const after = afterBeat.titleLayers?.[layerIndex];
      if (before.fontFile instanceof File && after && appFontFileName(after.fontId)) {
        promotedFontKeys.push(`${id}:${beforeBeat.id}:${before.id}`);
      }
    }
  }
  if (promotedFontKeys.length) {
    try {
      const cleanupTx = db.transaction("title_fonts", "readwrite");
      const store = cleanupTx.objectStore("title_fonts");
      promotedFontKeys.forEach((key) => store.delete(key));
      await new Promise<void>((resolve) => {
        cleanupTx.oncomplete = () => resolve();
        cleanupTx.onerror = () => resolve();
        cleanupTx.onabort = () => resolve();
      });
    } catch { /* legacy cleanup is best-effort */ }
  }
  return promoted;
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
      // Fonts are app-wide assets and must survive project deletion. Legacy
      // title_fonts records are intentionally not treated as project-owned.
      const voiceKeys = userVoiceKeys(parsed);
      if (voiceKeys.length) {
        const voiceTx = db.transaction("user_voice", "readwrite");
        const voiceStore = voiceTx.objectStore("user_voice");
        for (const key of voiceKeys) voiceStore.delete(`${id}:${key}`);
      }
      const musicTx = db.transaction("music_tracks", "readwrite");
      musicTx.objectStore("music_tracks").delete(id);
    } catch (e) {
      console.error("Error cleaning up media_blobs on project delete:", e);
    }
  }

  projStore.delete(id);

  if (typeof localStorage !== "undefined" && localStorage.getItem(ACTIVE_PROJECT_KEY) === id) {
    localStorage.removeItem(ACTIVE_PROJECT_KEY);
  }
}

// ---------------------------------------------------------------------------
// Template CRUD — structured records with an optional inspiration-video File
// ---------------------------------------------------------------------------

export async function saveTemplate(template: ProjectTemplate): Promise<void> {
  const db = await openDB();
  const tx = db.transaction("templates", "readwrite");
  tx.objectStore("templates").put({ ...template, updatedAt: Date.now() });
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadAllTemplates(): Promise<ProjectTemplate[]> {
  const db = await openDB();
  const tx = db.transaction("templates", "readonly");
  return new Promise<ProjectTemplate[]>((resolve, reject) => {
    const req = tx.objectStore("templates").getAll();
    req.onsuccess = () => {
      const list: ProjectTemplate[] = (req.result ?? []) as ProjectTemplate[];
      list.sort((a, b) => b.updatedAt - a.updatedAt);
      resolve(list);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function deleteTemplate(id: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction("templates", "readwrite");
  tx.objectStore("templates").delete(id);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
