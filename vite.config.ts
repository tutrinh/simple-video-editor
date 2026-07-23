/// <reference types="vitest" />
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, readdirSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename, resolve, isAbsolute } from "node:path";

// COOP/COEP enable SharedArrayBuffer for the multithreaded ffmpeg core (a Phase-7
// perf swap). The single-threaded core works without them; harmless to set now.
const isolation = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

function readBody(req: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => resolve(d));
    req.on("error", reject);
  });
}

// Claude Code exposes model aliases (opus/sonnet/haiku), not full API ids.
function modelAlias(m?: string): string {
  if (!m) return "";
  if (/haiku/i.test(m)) return "haiku";
  if (/sonnet/i.test(m)) return "sonnet";
  if (/opus|fable/i.test(m)) return "opus";
  return "";
}

// Dev-only proxy: the browser POSTs { prompt, images, model } here and we run
// `claude -p` with the user's existing Claude Code auth — no API key. Images are
// written to temp files and read via the Read tool (claude -p can't take inline
// base64). This is the local "backend" that replaces the in-browser API key.
function claudeProxy(): Plugin {
  return {
    name: "claude-p-proxy",
    configureServer(server) {
      server.middlewares.use("/api/claude", async (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }
        const send = (code: number, body: unknown) => {
          res.statusCode = code;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(body));
        };
        let dir = "";
        try {
          const { prompt, images, model } = JSON.parse(await readBody(req)) as {
            prompt: string;
            images?: string[];
            model?: string;
          };
          dir = mkdtempSync(join(tmpdir(), "sve-frames-"));
          const paths = (images ?? []).map((b64, i) => {
            const p = join(dir, `f${i}.jpg`);
            writeFileSync(p, Buffer.from(b64, "base64"));
            return p;
          });
          const full = paths.length
            ? `Read these image files:\n${paths.map((p) => `- ${p}`).join("\n")}\n\n${prompt}`
            : prompt;
          const args = ["-p", full];
          if (paths.length) args.push("--allowedTools", "Read");
          const alias = modelAlias(model);
          if (alias) args.push("--model", alias);

          execFile("claude", args, { maxBuffer: 10 * 1024 * 1024, timeout: 180_000 }, (err, stdout, stderr) => {
            if (dir) rmSync(dir, { recursive: true, force: true });
            if (err) return send(500, { error: (stderr || err.message || "claude failed").toString().slice(0, 2000) });
            send(200, { text: stdout.toString().trim() });
          });
        } catch (e) {
          if (dir) rmSync(dir, { recursive: true, force: true });
          send(500, { error: e instanceof Error ? e.message : String(e) });
        }
      });
    },
  };
}

// Dev-only proxy for local Antigravity CLI: runs `antigravity run -p` (or ANTIGRAVITY_PATH env)
function antigravityProxy(configuredPath?: string): Plugin {
  return {
    name: "antigravity-cli-proxy",
    configureServer(server) {
      server.middlewares.use("/api/antigravity", async (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }
        const send = (code: number, body: unknown) => {
          res.statusCode = code;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(body));
        };
        let dir = "";
        try {
          const { prompt, images, model } = JSON.parse(await readBody(req)) as {
            prompt: string;
            images?: string[];
            model?: string;
          };
          dir = mkdtempSync(join(tmpdir(), "sve-frames-"));
          const paths = (images ?? []).map((b64, i) => {
            const p = join(dir, `f${i}.jpg`);
            writeFileSync(p, Buffer.from(b64, "base64"));
            return p;
          });
          const full = paths.length
            ? `Read these image files:\n${paths.map((p) => `- ${p}`).join("\n")}\n\n${prompt}`
            : prompt;

          const defaultScript = join(process.cwd(), "scripts", "antigravity_runner.py");
          const customBin = configuredPath || process.env.ANTIGRAVITY_PATH;

          let execCmd = "python3";
          let args: string[] = [];

          if (customBin && !customBin.includes("antigravity-ide")) {
            execCmd = customBin;
            args = ["--prompt", prompt];
            if (paths.length) args.push("--images", ...paths);
            if (model) args.push("--model", model);
          } else {
            execCmd = "python3";
            args = [defaultScript, "--prompt", prompt];
            if (paths.length) args.push("--images", ...paths);
            if (model) args.push("--model", model);
          }

          execFile(execCmd, args, { maxBuffer: 10 * 1024 * 1024, timeout: 180_000 }, (err, stdout, stderr) => {
            if (dir) rmSync(dir, { recursive: true, force: true });
            if (err) {
              const msg = (stderr || err.message || "Antigravity execution failed").toString();
              return send(500, { error: msg.slice(0, 2000) });
            }
            const text = stdout.toString().trim();
            if (!text) {
              return send(500, {
                error: `Antigravity runner returned empty text output. Switch the AI Engine dropdown to 'Claude Code CLI (claude -p)' or check python log.`
              });
            }
            send(200, { text });
          });
        } catch (e) {
          if (dir) rmSync(dir, { recursive: true, force: true });
          send(500, { error: e instanceof Error ? e.message : String(e) });
        }
      });
    },
  };
}

// Dev-only ElevenLabs proxy: keeps ELEVENLABS_API_KEY server-side. The browser
// POSTs { text, voiceId } to /api/tts; we forward to ElevenLabs and stream back
// the MP3. Like the Claude proxy, this only exists under `vite dev`.
function elevenProxy(apiKey: string): Plugin {
  return {
    name: "tts-elevenlabs-proxy",
    configureServer(server) {
      server.middlewares.use("/api/tts", async (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }
        const send = (code: number, body: unknown) => {
          res.statusCode = code;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(body));
        };
        try {
          if (!apiKey) return send(500, { error: "ELEVENLABS_API_KEY not set in .env.local" });
          const { text, voiceId, speed } = JSON.parse(await readBody(req)) as { text: string; voiceId: string; speed?: number };
          const clean = (text ?? "").trim();
          if (!clean) return send(400, { error: "empty voiceover text" });
          if (!voiceId) return send(400, { error: "missing ElevenLabs voiceId" });
          // ElevenLabs voice_settings.speed: 0.7 (slow) .. 1.2 (fast), 1 = natural.
          const body: Record<string, unknown> = { text: clean, model_id: "eleven_multilingual_v2" };
          if (typeof speed === "number" && speed !== 1) {
            body.voice_settings = { speed: Math.min(1.2, Math.max(0.7, speed)) };
          }
          const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
            method: "POST",
            headers: { "xi-api-key": apiKey, "content-type": "application/json", accept: "audio/mpeg" },
            body: JSON.stringify(body),
          });
          if (!r.ok) {
            const detail = await r.text().catch(() => "");
            return send(r.status, { error: `ElevenLabs ${r.status}: ${detail.slice(0, 300)}` });
          }
          res.statusCode = 200;
          res.setHeader("content-type", "audio/mpeg");
          res.end(Buffer.from(await r.arrayBuffer()));
        } catch (e) {
          send(500, { error: e instanceof Error ? e.message : String(e) });
        }
      });
    },
  };
}

// Dev-only: serve a configured default music bed (DEFAULT_MUSIC in .env.local)
// at /api/default-music so Export can auto-load it. A browser can't build a File
// from a filesystem path, so the app fetches these bytes on load.
function defaultMusic(filePath: string): Plugin {
  return {
    name: "default-music",
    configureServer(server) {
      server.middlewares.use("/api/default-music", (req, res) => {
        if (req.method !== "GET" && req.method !== "HEAD") { res.statusCode = 405; res.end(); return; }
        if (!filePath) { res.statusCode = 404; res.end(); return; }
        try {
          const data = readFileSync(filePath);
          res.statusCode = 200;
          res.setHeader("content-type", "audio/mpeg");
          res.setHeader("content-length", String(data.length));
          res.setHeader("x-music-name", basename(filePath));
          res.end(req.method === "HEAD" ? undefined : data);
        } catch {
          res.statusCode = 404; // not configured, or drive not mounted
          res.end();
        }
      });
    },
  };
}

// Dev-only music library: lists audio files in MUSIC_DIR (.env.local) and streams
// them, so Export can offer a pick-from-folder list with preview. Names are
// basename()'d before joining, so a request can't escape the configured folder.
const AUDIO_RE = /\.(mp3|m4a|aac|wav|ogg|flac)$/i;
const VIDEO_RE = /\.(mp4|mov|webm|m4v)$/i;

function musicLibrary(dir: string): Plugin {
  return {
    name: "music-library",
    configureServer(server) {
      server.middlewares.use("/api/music", (req, res) => {
        const u = new URL(req.url ?? "/", "http://localhost");
        if (u.pathname === "/list") {
          res.setHeader("content-type", "application/json");
          try {
            const files = dir ? readdirSync(dir).filter((n) => AUDIO_RE.test(n)).sort() : [];
            res.end(JSON.stringify({ files }));
          } catch {
            res.end(JSON.stringify({ files: [] }));
          }
          return;
        }
        if (u.pathname === "/file") {
          const name = basename(u.searchParams.get("name") ?? "");
          if (!dir || !name || !AUDIO_RE.test(name)) { res.statusCode = 400; res.end(); return; }
          try {
            const data = readFileSync(join(dir, name));
            res.statusCode = 200;
            res.setHeader("content-type", "audio/mpeg");
            res.setHeader("content-length", String(data.length));
            res.setHeader("x-music-name", name);
            res.end(data);
          } catch {
            res.statusCode = 404; res.end();
          }
          return;
        }
        res.statusCode = 404; res.end();
      });
    },
  };
}

function overlayLibrary(dir: string): Plugin {
  return {
    name: "overlay-library",
    configureServer(server) {
      server.middlewares.use("/api/overlays", (req, res) => {
        const u = new URL(req.url ?? "/", "http://localhost");
        if (u.pathname === "/list") {
          res.setHeader("content-type", "application/json");
          try {
            const result: { category: string; files: string[] }[] = [];
            const entries = readdirSync(dir, { withFileTypes: true });
            for (const ent of entries) {
              if (ent.isDirectory()) {
                const categoryPath = join(dir, ent.name);
                // Top-level files in this category
                const topFiles = readdirSync(categoryPath, { withFileTypes: true })
                  .filter((e) => e.isFile() && VIDEO_RE.test(e.name))
                  .map((e) => e.name)
                  .sort();
                if (topFiles.length > 0) {
                  result.push({ category: ent.name, files: topFiles });
                }
                // One level deeper — sub-subdirectories (e.g. light-leaks/Vertical)
                const subDirs = readdirSync(categoryPath, { withFileTypes: true }).filter((e) => e.isDirectory());
                for (const sub of subDirs) {
                  const subPath = join(categoryPath, sub.name);
                  const subFiles = readdirSync(subPath).filter((n) => VIDEO_RE.test(n)).sort();
                  if (subFiles.length > 0) {
                    result.push({ category: `${ent.name}/${sub.name}`, files: subFiles });
                  }
                }
              } else if (VIDEO_RE.test(ent.name)) {
                result.push({ category: "general", files: [ent.name] });
              }
            }
            res.end(JSON.stringify({ categories: result }));
          } catch {
            res.end(JSON.stringify({ categories: [] }));
          }
          return;
        }
        if (u.pathname === "/file") {
          const category = basename(u.searchParams.get("category") ?? "");
          const name = basename(u.searchParams.get("name") ?? "");
          if (!dir || !name || !VIDEO_RE.test(name)) { res.statusCode = 400; res.end(); return; }
          try {
            const filePath = category && category !== "general" ? join(dir, category, name) : join(dir, name);
            const data = readFileSync(filePath);
            res.statusCode = 200;
            res.setHeader("content-type", "video/mp4");
            res.setHeader("content-length", String(data.length));
            res.setHeader("x-overlay-name", name);
            res.end(data);
          } catch {
            res.statusCode = 404; res.end();
          }
          return;
        }
        if (u.pathname === "/upload" && req.method === "POST") {
          const name = basename(u.searchParams.get("name") ?? "");
          const category = u.searchParams.get("category") || "uploads";
          if (!name || !VIDEO_RE.test(name)) { res.statusCode = 400; res.end(JSON.stringify({ error: "invalid filename" })); return; }
          const chunks: Buffer[] = [];
          req.on("data", (c: Buffer) => chunks.push(c));
          req.on("end", () => {
            try {
              const categoryDir = join(dir, category);
              mkdirSync(categoryDir, { recursive: true });
              const dest = join(categoryDir, name);
              writeFileSync(dest, Buffer.concat(chunks));
              res.statusCode = 200;
              res.setHeader("content-type", "application/json");
              res.end(JSON.stringify({ ok: true, path: `${category}/${name}` }));
            } catch (e) {
              res.statusCode = 500;
              res.setHeader("content-type", "application/json");
              res.end(JSON.stringify({ error: String(e) }));
            }
          });
          req.on("error", () => { res.statusCode = 500; res.end(); });
          return;
        }
        res.statusCode = 404; res.end();
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // Music bed folder + default track live in the project by default (./music).
  // Both env overrides are resolved relative to the project root if not absolute.
  const abs = (p: string, fallback: string) =>
    p ? (isAbsolute(p) ? p : resolve(process.cwd(), p)) : fallback;
  const musicDir = abs(env.MUSIC_DIR ?? "", resolve(process.cwd(), "music"));
  const overlaysDir = abs(env.OVERLAYS_DIR ?? "", resolve(process.cwd(), "overlays"));
  const defaultMusicPath = abs(env.DEFAULT_MUSIC ?? "", join(musicDir, "City Nights.mp3"));
  return {
    plugins: [
      react(),
      claudeProxy(),
      antigravityProxy(env.ANTIGRAVITY_PATH ?? ""),
      elevenProxy(env.ELEVENLABS_API_KEY ?? ""),
      defaultMusic(defaultMusicPath),
      musicLibrary(musicDir),
      overlayLibrary(overlaysDir),
    ],
    server: { headers: isolation },
    preview: { headers: isolation },
    optimizeDeps: { exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util"] },
    test: { environment: "node" },
  };
});
