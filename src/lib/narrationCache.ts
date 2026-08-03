import type { Narration, TtsOptions } from "./tts";

const DB_NAME = "vidstr_narration_assets_db";
const DB_VERSION = 1;
const STORE_NAME = "assets";
const CACHE_FORMAT_VERSION = 1;
const MAX_CACHE_ENTRIES = 300;
const MAX_CACHE_BYTES = 128 * 1024 * 1024;

interface NarrationRecord {
  key: string;
  descriptor: string;
  data: ArrayBuffer;
  ext: Narration["ext"];
  durationSec: number;
  words?: Narration["words"];
  byteLength: number;
  createdAt: number;
  lastUsedAt: number;
}

export interface NarrationCacheStatus {
  key: string;
  cached: boolean;
}

const memoryCache = new Map<string, NarrationRecord>();
const inFlight = new Map<string, Promise<Narration>>();

function normalizedDescriptor(text: string, opts: TtsOptions): string {
  const normalizedText = text.trim().replace(/\r\n/g, "\n");
  return JSON.stringify({
    cacheFormat: CACHE_FORMAT_VERSION,
    text: normalizedText,
    engine: opts.engine,
    voice: opts.engine === "kokoro" ? (opts.voice ?? null) : null,
    elevenVoiceId: opts.engine === "elevenlabs" ? (opts.elevenVoiceId ?? null) : null,
    elevenModel: opts.engine === "elevenlabs" ? (opts.elevenModel ?? null) : null,
    speed: opts.speed ?? 1,
    elevenStability: opts.engine === "elevenlabs" ? (opts.elevenStability ?? null) : null,
    elevenStyle: opts.engine === "elevenlabs" ? (opts.elevenStyle ?? null) : null,
  });
}

function fallbackHash(value: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 0x01000193);
    h2 = Math.imul(h2 ^ code, 0x85ebca6b);
  }
  return `${(h1 >>> 0).toString(16).padStart(8, "0")}${(h2 >>> 0).toString(16).padStart(8, "0")}`;
}

async function hashDescriptor(descriptor: string): Promise<string> {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const bytes = new TextEncoder().encode(descriptor);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return fallbackHash(descriptor);
}

export async function narrationCacheKey(text: string, opts: TtsOptions): Promise<{ key: string; descriptor: string }> {
  const descriptor = normalizedDescriptor(text, opts);
  return { key: `narration:${await hashDescriptor(descriptor)}`, descriptor };
}

function openCacheDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "key" });
        store.createIndex("lastUsedAt", "lastUsedAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Narration cache transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("Narration cache transaction was cancelled"));
  });
}

function toNarration(record: NarrationRecord): Narration {
  return {
    data: new Uint8Array(record.data.slice(0)),
    ext: record.ext,
    durationSec: record.durationSec,
    words: record.words,
    cacheHit: true,
  };
}

async function readRecord(key: string, descriptor: string): Promise<NarrationRecord | null> {
  const memory = memoryCache.get(key);
  if (memory?.descriptor === descriptor) {
    memory.lastUsedAt = Date.now();
    return memory;
  }

  const db = await openCacheDb();
  if (!db) return null;
  try {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const record = await new Promise<NarrationRecord | undefined>((resolve) => {
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result as NarrationRecord | undefined);
      request.onerror = () => resolve(undefined);
    });
    if (!record || record.descriptor !== descriptor) {
      transaction.abort();
      return null;
    }
    record.lastUsedAt = Date.now();
    store.put(record);
    await transactionDone(transaction);
    memoryCache.set(key, record);
    return record;
  } catch {
    return null;
  } finally {
    db.close();
  }
}

async function pruneCache(db: IDBDatabase): Promise<void> {
  const records = await new Promise<NarrationRecord[]>((resolve) => {
    const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve((request.result ?? []) as NarrationRecord[]);
    request.onerror = () => resolve([]);
  });
  records.sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  let retainedBytes = 0;
  const stale: NarrationRecord[] = [];
  records.forEach((record, index) => {
    retainedBytes += record.byteLength;
    if (index >= MAX_CACHE_ENTRIES || retainedBytes > MAX_CACHE_BYTES) stale.push(record);
  });
  if (!stale.length) return;
  const transaction = db.transaction(STORE_NAME, "readwrite");
  const store = transaction.objectStore(STORE_NAME);
  stale.forEach((record) => {
    store.delete(record.key);
    memoryCache.delete(record.key);
  });
  await transactionDone(transaction);
}

async function writeRecord(key: string, descriptor: string, narration: Narration): Promise<void> {
  const now = Date.now();
  const data = narration.data.slice().buffer as ArrayBuffer;
  const record: NarrationRecord = {
    key,
    descriptor,
    data,
    ext: narration.ext,
    durationSec: narration.durationSec,
    words: narration.words,
    byteLength: data.byteLength,
    createdAt: now,
    lastUsedAt: now,
  };
  memoryCache.set(key, record);

  const db = await openCacheDb();
  if (!db) return;
  try {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(record);
    await transactionDone(transaction);
    await pruneCache(db);
  } catch {
    // Storage denial/quota must not make a successful paid generation unusable.
  } finally {
    db.close();
  }
}

export async function narrationCacheStatus(text: string, opts: TtsOptions): Promise<NarrationCacheStatus> {
  const { key, descriptor } = await narrationCacheKey(text, opts);
  return { key, cached: Boolean(await readRecord(key, descriptor)) };
}

export async function getOrCreateNarration(
  text: string,
  opts: TtsOptions,
  producer: () => Promise<Narration>,
  forceRefresh = false,
): Promise<Narration> {
  const { key, descriptor } = await narrationCacheKey(text, opts);
  if (!forceRefresh) {
    const cached = await readRecord(key, descriptor);
    if (cached) return toNarration(cached);
  }

  const flightKey = forceRefresh ? `${key}:refresh` : key;
  const existing = inFlight.get(flightKey);
  if (existing) return existing;

  const generation = producer().then(async (narration) => {
    await writeRecord(key, descriptor, narration);
    return { ...narration, data: narration.data.slice(), cacheHit: false };
  }).finally(() => {
    inFlight.delete(flightKey);
  });
  inFlight.set(flightKey, generation);
  return generation;
}

export async function clearNarrationCache(): Promise<void> {
  memoryCache.clear();
  inFlight.clear();
  const db = await openCacheDb();
  if (!db) return;
  try {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).clear();
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

/** Test-only reset for the memory fallback used in the Node test environment. */
export function resetNarrationMemoryCacheForTests() {
  memoryCache.clear();
  inFlight.clear();
}
