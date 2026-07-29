import { FFmpeg } from "@ffmpeg/ffmpeg";

// Isolated-instance ffmpeg (ADR-0002, validated by spikes/ffmpeg-export): every
// operation runs in a FRESH FFmpeg that is terminate()d afterwards, so the WASM
// heap is fully reclaimed between clips. A shared engine creeps upward and
// eventually OOMs; this pattern caps peak memory at a single operation.
//
// Two cores, both SELF-HOSTED same-origin (public/ffmpeg-st/ and public/ffmpeg-mt/).
// Self-hosting eliminates the unpkg CDN dependency (offline support, faster load,
// no outage risk). The multithreaded core (@ffmpeg/core-mt, ~2-4x faster) is
// preferred when the page is cross-origin isolated (COOP/COEP → SharedArrayBuffer).
// Falls back to the single-thread core when MT isn't available.
const ST_DIR = "/ffmpeg-st";
const MT_DIR = "/ffmpeg-mt";

// MT remains experimental: the core loads in supported browsers but has hung on
// real export filter graphs. It is opt-in so normal exports take the proven ST
// worker-pool path immediately. Enable it without rebuilding by setting
// localStorage["vidstr.ffmpeg.mt"] = "on" and reloading the page.
// Any MT failure persists "off" so subsequent reloads remain on ST.
const MT_SETTING_KEY = "vidstr.ffmpeg.mt";
let mtFailedThisSession = false;
let mtQueue: Promise<void> = Promise.resolve();

function mtSettingEnabled(): boolean {
  try {
    return globalThis.localStorage?.getItem(MT_SETTING_KEY) === "on";
  } catch {
    return false;
  }
}

/** MT needs SharedArrayBuffer, a cross-origin-isolated page, and a healthy session. */
export function multithreadReady(): boolean {
  return !mtFailedThisSession
    && mtSettingEnabled()
    && typeof SharedArrayBuffer !== "undefined"
    && (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated === true;
}

interface CoreUrls { coreURL: string; wasmURL: string; workerURL?: string }

// Memoized as PROMISES so callers share core probes instead of racing to fetch.
let stCoreUrlsPromise: Promise<CoreUrls> | null = null;
let mtCoreUrlsPromise: Promise<CoreUrls> | null = null;

function coreUrls(multithreaded: boolean): Promise<CoreUrls> {
  const abs = (p: string) => new URL(p, location.href).href;
  if (!multithreaded) {
    if (!stCoreUrlsPromise) {
      stCoreUrlsPromise = Promise.resolve({
        coreURL: abs(`${ST_DIR}/ffmpeg-core.js`),
        wasmURL: abs(`${ST_DIR}/ffmpeg-core.wasm`),
      });
    }
    return stCoreUrlsPromise;
  }

  if (!mtCoreUrlsPromise) {
    mtCoreUrlsPromise = (async () => {
      const head = await fetch(`${MT_DIR}/ffmpeg-core.js`, { method: "HEAD" });
      if (!head.ok) throw new Error(`multithreaded FFmpeg core unavailable (${head.status})`);
      return {
        coreURL: abs(`${MT_DIR}/ffmpeg-core.js`),
        wasmURL: abs(`${MT_DIR}/ffmpeg-core.wasm`),
        workerURL: abs(`${MT_DIR}/ffmpeg-core.worker.js`),
      };
    })().catch((e) => {
      mtCoreUrlsPromise = null;
      throw e;
    });
  }
  return mtCoreUrlsPromise;
}

async function serializeMt<T>(work: () => Promise<T>): Promise<T> {
  const previous = mtQueue;
  let release!: () => void;
  mtQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    return await work();
  } finally {
    release();
  }
}

function isFfmpegCommandFailure(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("FFmpeg processing failed (code ");
}

export interface EngineInput {
  name: string;
  data: Uint8Array;
}

export type EnginePhase = "loading-mt" | "fallback-st" | "loading-st" | "encoding";

// Pull the most diagnostic lines out of ffmpeg's log. ffmpeg prints its stream
// banner AFTER a filtergraph error, so the naive "last N lines" hides the real
// cause behind stream-config noise. Prefer lines that look like actual errors.
function summarizeFfmpegError(logs: string[]): string {
  const clean = logs
    .map((l) => l.trim())
    .filter((l) => l && !l.toLowerCase().includes("called ffmpeg.terminate") && !l.startsWith("frame=") && !l.startsWith("size="));
  const errorRe = /error|invalid|no such|unable|fail|not found|cannot|unrecognized|does not|no streams|reinit|unconnected|option .* not|matches no/i;
  const errs = clean.filter((l) => errorRe.test(l));
  return (errs.length > 0 ? errs : clean).slice(-8).join(" | ");
}

/**
 * Run one ffmpeg command in an isolated engine and return the output bytes.
 * Inputs are written to the in-memory FS, `args` is the ffmpeg argv (referencing
 * those names), and `outputName` is read back before teardown.
 */
export async function runIsolated(
  inputs: EngineInput[],
  args: string[],
  outputName: string,
  onProgress?: (fraction: number, phase?: EnginePhase) => void,
  timeoutMs = 600_000,
  /** Receives ffmpeg's own log lines on SUCCESS too — otherwise they are only
   *  summarised on failure, which hides "filter did nothing" style problems. */
  onLog?: (lines: string[]) => void,
): Promise<Uint8Array<ArrayBuffer>> {
  if (multithreadReady()) {
    try {
      return await serializeMt(() => {
        if (!multithreadReady()) {
          throw new Error("multithreaded FFmpeg disabled after an earlier session failure");
        }
        return runWithCore(inputs, args, outputName, true, onProgress, Math.min(timeoutMs, 180_000), onLog);
      });
    } catch (error) {
      // A normal non-zero ffmpeg exit means the argv/input failed, not the core.
      // Preserve that diagnostic rather than doing the same expensive work twice.
      if (isFfmpegCommandFailure(error)) throw error;
      mtFailedThisSession = true;
      try { globalThis.localStorage?.setItem(MT_SETTING_KEY, "off"); } catch {}
      console.warn("[ffmpeg] multithreaded core failed; retrying with the single-threaded core for this session", error);
      onProgress?.(0, "fallback-st");
    }
  }
  return runWithCore(inputs, args, outputName, false, onProgress, timeoutMs, onLog);
}

async function runWithCore(
  inputs: EngineInput[],
  args: string[],
  outputName: string,
  multithreaded: boolean,
  onProgress: ((fraction: number, phase?: EnginePhase) => void) | undefined,
  timeoutMs: number,
  onLog: ((lines: string[]) => void) | undefined,
): Promise<Uint8Array<ArrayBuffer>> {
  const urls = await coreUrls(multithreaded);
  const ff = new FFmpeg();
  const logs: string[] = [];
  ff.on("log", ({ message }) => { logs.push(message); });
  const emitLogs = () => { try { onLog?.(logs); } catch { /* diagnostics must never break a render */ } };
  if (onProgress) ff.on("progress", ({ progress }) => onProgress(Math.min(1, Math.max(0, progress)), "encoding"));
  const timeoutSec = Math.round(timeoutMs / 1000);
  const loadTimeoutMs = Math.min(timeoutMs, multithreaded ? 20_000 : 60_000);
  const loadTimeoutSec = Math.round(loadTimeoutMs / 1000);
  let loadTimeoutTimer: NodeJS.Timeout | null = null;
  let timeoutTimer: NodeJS.Timeout | null = null;

  try {
    onProgress?.(0, multithreaded ? "loading-mt" : "loading-st");
    // Core/worker startup can hang before ff.exec() begins (observed with the MT
    // core on real export graphs). The watchdog must cover load as well as exec,
    // otherwise the export remains forever at the stage immediately before its
    // first engine operation.
    const loadTimeoutPromise = new Promise<never>((_, reject) => {
      loadTimeoutTimer = setTimeout(() => {
        try { ff.terminate(); } catch {}
        reject(new Error(`FFmpeg core load timed out after ${loadTimeoutSec}s for ${outputName}`));
      }, loadTimeoutMs);
    });
    await Promise.race([ff.load(urls), loadTimeoutPromise]);
    if (loadTimeoutTimer) clearTimeout(loadTimeoutTimer);

    for (const input of inputs) await ff.writeFile(input.name, input.data.slice());

    // Calling ff.terminate() to abort makes the in-flight ff.exec() reject with
    // "called FFmpeg.terminate()", NOT our timeout message — so flag the timeout
    // explicitly, otherwise a slow (but healthy) encode looks like a mystery abort.
    let timedOut = false;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutTimer = setTimeout(() => {
        timedOut = true;
        try { ff.terminate(); } catch {}
        reject(new Error(`FFmpeg processing timed out after ${timeoutSec}s for ${outputName}`));
      }, timeoutMs);
    });
    let code: number;
    try {
      code = await Promise.race([ff.exec(args), timeoutPromise]);
    } catch (err) {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      const rawMsg = err instanceof Error ? err.message : String(err);
      if (timedOut || rawMsg.includes("timed out")) {
        throw new Error(`FFmpeg processing timed out after ${timeoutSec}s for ${outputName}`);
      }
      try {
        const out = (await ff.readFile(outputName)) as Uint8Array;
        if (out && out.byteLength > 100) {
          const copy = new Uint8Array(out.byteLength);
          copy.set(out);
          return copy;
        }
      } catch {}

      const logTail = summarizeFfmpegError(logs);
      // Dump everything so nothing is masked: the raw exec exception AND the full
      // (unfiltered) log tail. summarizeFfmpegError() can hide the real line behind
      // the post-error stream banner, so print the raw log too for diagnosis.
      console.error(
        `[runIsolated ${outputName}] exec threw:`, rawMsg,
        "\n--- ffmpeg log tail (raw) ---\n" + logs.slice(-40).join("\n"),
      );
      // Always keep rawMsg in the thrown message (labeled), never let the banner bury it.
      const detail = `exec: ${rawMsg || "(empty)"}${logTail ? ` | log: ${logTail}` : ""}`;
      throw new Error(`FFmpeg failed for ${outputName}: ${detail}`);
    }
    if (timeoutTimer) clearTimeout(timeoutTimer);
    if (code !== 0) {
      try {
        const out = (await ff.readFile(outputName)) as Uint8Array;
        if (out && out.byteLength > 100) {
          const copy = new Uint8Array(out.byteLength);
          copy.set(out);
          return copy;
        }
      } catch {}

      const logTail = summarizeFfmpegError(logs);
      throw new Error(`FFmpeg processing failed (code ${code}): ${logTail || "Command execution error"}`);
    }
    const out = (await ff.readFile(outputName)) as Uint8Array;
    const copy = new Uint8Array(out.byteLength);
    copy.set(out);
    emitLogs();
    return copy;
  } finally {
    if (loadTimeoutTimer) clearTimeout(loadTimeoutTimer);
    if (timeoutTimer) clearTimeout(timeoutTimer);
    try {
      ff.terminate();
    } catch {}
  }
}
