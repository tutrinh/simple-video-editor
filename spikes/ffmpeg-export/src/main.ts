import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

// --- Purpose -------------------------------------------------------------
// Throwaway spike answering ONE question for ADR-0002: can a browser tab export
// a multi-clip 1080p video without OOMing?
//
// v2: ISOLATED-ENGINE mode. ffmpeg.wasm reuses one WASM heap across exec()
// calls and never fully reclaims it, so a shared engine creeps upward until it
// aborts. Here each clip is encoded in its own FFmpeg instance that is
// terminate()d before the next — segment bytes are pulled into JS memory
// (~1 MB each) between clips, and a final fresh engine concatenates them. This
// caps peak WASM memory at a SINGLE clip's decode+encode, independent of count.
// -------------------------------------------------------------------------

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const logEl = $("log") as HTMLPreElement;
const statusEl = $("status") as HTMLSpanElement;
const runBtn = $("run") as HTMLButtonElement;
const downloadEl = $("download") as HTMLAnchorElement;
const overallBar = $("overall") as HTMLProgressElement;
const overallLabel = $("overall-label") as HTMLSpanElement;
const clipBar = $("clip") as HTMLProgressElement;
const clipLabel = $("clip-label") as HTMLSpanElement;

let peakHeap = 0;
let clipIndex = 0;
let clipCount = 0;

function log(msg: string) {
  logEl.textContent += msg + "\n";
  logEl.scrollTop = logEl.scrollHeight;
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  if (mem && mem.usedJSHeapSize > peakHeap) peakHeap = mem.usedJSHeapSize;
}

const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(0) + " MB";

function setProgress(clipFraction: number) {
  const f = Math.min(1, Math.max(0, clipFraction));
  clipBar.value = f * 100;
  clipLabel.textContent = Math.round(f * 100) + "%";
  if (clipCount > 0) {
    overallBar.value = ((clipIndex + f) / clipCount) * 100;
    overallLabel.textContent = `clip ${clipIndex + 1} of ${clipCount}`;
  }
}

// Loading the core from a CDN is fine for a dev-only spike; the real app
// self-hosts it. Resolve the blob URLs once and reuse them for every engine —
// only the wasm *instance* is per-clip, not the download.
const CORE_BASE = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm";
let coreURL: string | null = null;
let wasmURL: string | null = null;

async function newEngine(): Promise<FFmpeg> {
  if (!coreURL) coreURL = await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, "text/javascript");
  if (!wasmURL) wasmURL = await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, "application/wasm");
  const ff = new FFmpeg();
  ff.on("log", ({ message }) => {
    if (/frame=|error|Error|Output|Invalid|No such|abort|memory/i.test(message)) log("  ffmpeg: " + message);
  });
  ff.on("progress", ({ progress }) => setProgress(progress));
  await ff.load({ coreURL, wasmURL });
  return ff;
}

// Copy MEMFS bytes into a fresh (non-shared) JS buffer so they survive
// terminate() and satisfy strict TS / Blob typing.
function detach(u: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(u.byteLength);
  copy.set(u);
  return copy;
}

function safeCaption(name: string): string {
  return name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9 ]/g, " ").trim().slice(0, 60) || "clip";
}

async function run() {
  runBtn.disabled = true;
  logEl.textContent = "";
  peakHeap = 0;
  downloadEl.hidden = true;
  overallBar.value = 0;
  clipBar.value = 0;
  overallLabel.textContent = "";
  clipLabel.textContent = "";

  const clips = ($("clips") as HTMLInputElement).files;
  const fontInput = ($("font") as HTMLInputElement).files;
  const dur = Math.max(1, Number(($("dur") as HTMLInputElement).value) || 3);

  if (!clips || clips.length === 0) {
    log("Pick at least one clip first.");
    runBtn.disabled = false;
    return;
  }

  const useCaptions = !!(fontInput && fontInput.length);
  const fontBytes = useCaptions ? await fetchFile(fontInput![0]) : null;
  const t0 = performance.now();
  clipCount = clips.length;

  log(`Mode: isolated engine per clip (fresh FFmpeg, terminated after each).`);
  log(useCaptions ? `Captions ON (${fontInput![0].name}).\n` : "Captions OFF (no font).\n");

  try {
    // Keep each normalized segment in JS memory between clips (~1 MB each).
    const segments: Uint8Array[] = [];

    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      clipIndex = i;
      setProgress(0);
      const cap = safeCaption(clip.name);
      log(`[${i + 1}/${clips.length}] ${clip.name} (${mb(clip.size)}) → keep ${dur}s${useCaptions ? `, caption "${cap}"` : ""}`);
      const clipStart = performance.now();

      const ff = await newEngine();
      try {
        if (fontBytes) await ff.writeFile("/font.ttf", fontBytes);
        await ff.writeFile("in.mp4", await fetchFile(clip));

        let vf =
          "scale=1920:1080:force_original_aspect_ratio=decrease," +
          "pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1";
        if (useCaptions) {
          vf +=
            `,drawtext=fontfile=/font.ttf:text='${cap}':fontcolor=white:fontsize=48:` +
            "box=1:boxcolor=black@0.5:boxborderw=16:x=(w-text_w)/2:y=h-th-80";
        }

        await ff.exec([
          "-ss", "0", "-t", String(dur), "-i", "in.mp4",
          "-f", "lavfi", "-t", String(dur), "-i", "anullsrc=r=48000:cl=stereo",
          "-map", "0:v:0", "-map", "1:a:0",
          "-vf", vf,
          "-r", "30", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
          "-c:a", "aac", "-ar", "48000", "-ac", "2", "-shortest",
          "seg.mp4",
        ]);

        segments.push(detach((await ff.readFile("seg.mp4")) as Uint8Array));
      } finally {
        // The whole point: tearing down the engine frees its entire WASM heap.
        ff.terminate();
      }
      log(`   segment ${mb(segments[i].byteLength)} in ${((performance.now() - clipStart) / 1000).toFixed(1)}s · engine torn down · peak JS heap ${mb(peakHeap)}`);
    }

    log("\nConcatenating in a fresh engine (stream copy)…");
    const cc = await newEngine();
    let out: Uint8Array<ArrayBuffer>;
    try {
      const names: string[] = [];
      for (let i = 0; i < segments.length; i++) {
        const name = `seg_${i}.mp4`;
        await cc.writeFile(name, segments[i]);
        names.push(name);
      }
      await cc.writeFile("concat.txt", names.map((n) => `file '${n}'`).join("\n"));
      await cc.exec(["-f", "concat", "-safe", "0", "-i", "concat.txt", "-c", "copy", "final.mp4"]);
      out = detach((await cc.readFile("final.mp4")) as Uint8Array);
    } finally {
      cc.terminate();
    }

    const url = URL.createObjectURL(new Blob([out], { type: "video/mp4" }));
    downloadEl.href = url;
    downloadEl.hidden = false;

    overallBar.value = 100;
    overallLabel.textContent = "complete";
    clipBar.value = 100;
    clipLabel.textContent = "100%";

    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    $("t-total").textContent = secs + "s";
    $("t-heap").textContent = mb(peakHeap);
    log(`\n✅ DONE. ${clips.length} clips → 1080p MP4 (${mb(out.byteLength)}) in ${secs}s. Peak JS heap ${mb(peakHeap)}.`);
    log("Now check Chrome Task Manager (⇧+Esc) for this tab's peak memory — that captures the WASM heap, which the JS number misses.");
    statusEl.textContent = "done";
  } catch (err) {
    log("\n❌ FAILED: " + (err instanceof Error ? err.message : String(err)));
    log(`Crashed at clip ${clipIndex + 1} of ${clipCount}. If isolated engines STILL OOM here, a single clip alone blows the budget — the envelope shrinks or the backend question reopens.`);
    statusEl.textContent = "failed";
  } finally {
    runBtn.disabled = false;
  }
}

runBtn.addEventListener("click", run);
