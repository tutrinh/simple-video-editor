// Throwaway CLI spike for ADR-0001, using `claude -p` (existing Claude Code
// auth — no API key) instead of the browser + Anthropic API.
//
//   node describe.mjs <clip1> [clip2 ...]
//   node describe.mjs --frames 6 <clip>
//
// For each clip: extract N evenly-spaced frames with a prebuilt ffmpeg binary,
// downscale them, and ask `claude -p` to write a Clip Description from the
// frames alone. Read the output: concrete? distinct across clips? usable?

import ffmpegPath from "ffmpeg-static";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename, extname } from "node:path";

const args = process.argv.slice(2);
let frames = 4;
const clips = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--frames") frames = Number(args[++i]) || 4;
  else clips.push(args[i]);
}
if (clips.length === 0) {
  console.error("usage: node describe.mjs [--frames N] <clip> [clip ...]");
  process.exit(1);
}

const PROMPT_HEAD = (paths, hint) =>
  `Read these ${paths.length} image files — they are frames sampled across ONE short video clip:\n` +
  paths.map((p) => `- ${p}`).join("\n") +
  (hint
    ? `\n\nThe editor named this clip "${hint}" — treat that as a hint to the intended highlight/beat, ` +
      `but describe what you actually see in the frames (the decisive moment may fall between frames).`
    : "") +
  `\n\nThe clip may have no speech or meaningful audio — judge only from what you see across the frames. ` +
  `Write a Clip Description with exactly these parts:\n` +
  `1. SUBJECT & ACTION: what/who is on screen and what is happening (1-2 sentences, concrete and specific).\n` +
  `2. SETTING & MOOD: where it is and the feeling it conveys (1 sentence).\n` +
  `3. USABILITY (1-5): how strong this is as a beat in a short story montage, with a 6-word reason.\n\n` +
  `Be specific enough that an editor who never sees the footage could sequence this clip from your words alone. ` +
  `Output only the description — no preamble.`;

function durationSeconds(clip) {
  // ffmpeg prints "Duration: HH:MM:SS.ss" to stderr; parse it (no ffprobe needed).
  let stderr = "";
  try {
    execFileSync(ffmpegPath, ["-i", clip], { stdio: ["ignore", "ignore", "pipe"] });
  } catch (e) {
    stderr = e.stderr?.toString() ?? "";
  }
  const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
  if (!m) return 0;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

function extractFrames(clip, dir, n) {
  const dur = durationSeconds(clip);
  const paths = [];
  for (let i = 0; i < n; i++) {
    const t = dur > 0 ? (dur * (i + 0.5)) / n : i; // evenly spaced; fall back to seconds
    const out = join(dir, `frame_${i}.jpg`);
    execFileSync(
      ffmpegPath,
      ["-y", "-ss", String(t), "-i", clip, "-frames:v", "1",
       "-vf", "scale='min(768,iw)':-2", "-q:v", "4", out],
      { stdio: "ignore" }
    );
    paths.push(out);
  }
  return paths;
}

function describe(paths, hint) {
  // --allowedTools Read lets headless Claude open the frame files; stderr carries
  // unrelated permission-rule warnings from the user's settings, so we ignore it.
  return execFileSync(
    "claude",
    ["-p", PROMPT_HEAD(paths, hint), "--allowedTools", "Read"],
    { encoding: "utf8", maxBuffer: 10 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] }
  ).trim();
}

for (const clip of clips) {
  console.log("\n" + "=".repeat(72));
  console.log(clip);
  console.log("=".repeat(72));
  const dir = mkdtempSync(join(tmpdir(), "clipframes-"));
  try {
    const t0 = Date.now();
    const paths = extractFrames(clip, dir, frames);
    console.log(`[${paths.length} frames extracted, describing via claude -p …]`);
    const hint = basename(clip, extname(clip));
    const out = describe(paths, hint);
    console.log(out);
    console.log(`\n(${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  } catch (err) {
    console.error("FAILED:", err.message);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
