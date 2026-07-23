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

// KILL-SWITCH: MT is disabled. The self-hosted mt core passed synthetic tests but
// crashed (2 concurrent) then hung (sequential) on the real export filter graph.
// We fall back to the proven single-thread core until mt is validated on real
// clips. Flip MT_ENABLED to true to re-test. When false, coreUrls() uses the ST
// core and the pools use their ST widths.
const MT_ENABLED = false;

/** MT needs SharedArrayBuffer (a cross-origin-isolated page) AND the kill-switch on. */
export function multithreadReady(): boolean {
  return MT_ENABLED
    && typeof SharedArrayBuffer !== "undefined"
    && (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated === true;
}

interface CoreUrls { coreURL: string; wasmURL: string; workerURL?: string }

// Memoized as a PROMISE so concurrent engines (the export/normalize pools) share
// one resolution instead of racing to fetch. Cleared on failure so a retry works.
let coreUrlsPromise: Promise<CoreUrls> | null = null;

function coreUrls(): Promise<CoreUrls> {
  if (!coreUrlsPromise) {
    coreUrlsPromise = (async (): Promise<CoreUrls> => {
      const abs = (p: string) => new URL(p, location.href).href;
      if (multithreadReady()) {
        try {
          const head = await fetch(`${MT_DIR}/ffmpeg-core.js`, { method: "HEAD" });
          if (head.ok) {
            return {
              coreURL: abs(`${MT_DIR}/ffmpeg-core.js`),
              wasmURL: abs(`${MT_DIR}/ffmpeg-core.wasm`),
              workerURL: abs(`${MT_DIR}/ffmpeg-core.worker.js`),
            };
          }
        } catch { /* self-hosted MT missing — fall back to ST below */ }
      }
      return {
        coreURL: abs(`${ST_DIR}/ffmpeg-core.js`),
        wasmURL: abs(`${ST_DIR}/ffmpeg-core.wasm`),
      };
    })().catch((e) => { coreUrlsPromise = null; throw e; });
  }
  return coreUrlsPromise;
}

export interface EngineInput {
  name: string;
  data: Uint8Array;
}

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
  onProgress?: (fraction: number) => void,
  timeoutMs = 600_000,
): Promise<Uint8Array<ArrayBuffer>> {
  const urls = await coreUrls();
  const ff = new FFmpeg();
  const logs: string[] = [];
  ff.on("log", ({ message }) => { logs.push(message); });
  if (onProgress) ff.on("progress", ({ progress }) => onProgress(Math.min(1, Math.max(0, progress))));
  await ff.load(urls);
  // Calling ff.terminate() to abort makes the in-flight ff.exec() reject with
  // "called FFmpeg.terminate()", NOT our timeout message — so flag the timeout
  // explicitly, otherwise a slow (but healthy) encode looks like a mystery abort.
  let timedOut = false;
  const timeoutSec = Math.round(timeoutMs / 1000);
  let timeoutTimer: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutTimer = setTimeout(() => {
      timedOut = true;
      try { ff.terminate(); } catch {}
      reject(new Error(`FFmpeg processing timed out after ${timeoutSec}s for ${outputName}`));
    }, timeoutMs);
  });

  try {
    for (const input of inputs) await ff.writeFile(input.name, input.data.slice());
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
    return copy;
  } finally {
    if (timeoutTimer) clearTimeout(timeoutTimer);
    try {
      ff.terminate();
    } catch {}
  }
}
