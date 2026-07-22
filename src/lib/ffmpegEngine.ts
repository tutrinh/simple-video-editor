import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";

// Isolated-instance ffmpeg (ADR-0002, validated by spikes/ffmpeg-export): every
// operation runs in a FRESH FFmpeg that is terminate()d afterwards, so the WASM
// heap is fully reclaimed between clips. A shared engine creeps upward and
// eventually OOMs; this pattern caps peak memory at a single operation.
//
// Two cores. The multithreaded core (@ffmpeg/core-mt, ~2-4x faster per encode) is
// preferred when the page is cross-origin isolated (COOP/COEP set in vite.config
// → SharedArrayBuffer). It is SELF-HOSTED same-origin (public/ffmpeg-mt/): passing
// its pthread workerURL as a blob hangs ff.load in @ffmpeg/ffmpeg 0.12, but a real
// same-origin URL works. Falls back to the single-thread CDN core when MT isn't
// available (not isolated) or the self-hosted files are missing.
const CORE_BASE = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm";
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
      if (multithreadReady()) {
        try {
          const head = await fetch(`${MT_DIR}/ffmpeg-core.js`, { method: "HEAD" });
          if (head.ok) {
            const abs = (p: string) => new URL(p, location.href).href;
            return {
              coreURL: abs(`${MT_DIR}/ffmpeg-core.js`),
              wasmURL: abs(`${MT_DIR}/ffmpeg-core.wasm`),
              workerURL: abs(`${MT_DIR}/ffmpeg-core.worker.js`),
            };
          }
        } catch { /* self-hosted MT missing — fall back to ST below */ }
      }
      const [coreURL, wasmURL] = await Promise.all([
        toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, "text/javascript"),
        toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, "application/wasm"),
      ]);
      return { coreURL, wasmURL };
    })().catch((e) => { coreUrlsPromise = null; throw e; });
  }
  return coreUrlsPromise;
}

export interface EngineInput {
  name: string;
  data: Uint8Array;
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
): Promise<Uint8Array<ArrayBuffer>> {
  const urls = await coreUrls();
  const ff = new FFmpeg();
  const logs: string[] = [];
  ff.on("log", ({ message }) => { logs.push(message); });
  if (onProgress) ff.on("progress", ({ progress }) => onProgress(Math.min(1, Math.max(0, progress))));
  await ff.load(urls);
  let timeoutTimer: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutTimer = setTimeout(() => {
      try { ff.terminate(); } catch {}
      reject(new Error(`FFmpeg processing timed out after 90s for ${outputName}`));
    }, 90000);
  });

  try {
    for (const input of inputs) await ff.writeFile(input.name, input.data.slice());
    const code = await Promise.race([ff.exec(args), timeoutPromise]);
    if (timeoutTimer) clearTimeout(timeoutTimer);

    if (code !== 0) {
      const logTail = logs.slice(-8).join(" | ");
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
