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

// Raw binary body (for file uploads — the string reader above corrupts bytes).
function readBodyBuffer(req: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
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

// Dev-only Codex proxy. `codex exec` uses the user's existing `codex login`
// session, so the browser never handles an API key. Run from the otherwise-empty
// frame temp directory: Codex receives only the prompt and attached images, not
// the editor repository or its agent instructions.
function codexProxy(): Plugin {
  return {
    name: "codex-cli-proxy",
    configureServer(server) {
      server.middlewares.use("/api/codex", async (req, res) => {
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
          const args = [
            "exec",
            "--ephemeral",
            "--sandbox", "read-only",
            "--skip-git-repo-check",
            "--color", "never",
            "-C", dir,
          ];
          if (model) args.push("--model", model);
          for (const path of paths) args.push("--image", path);
          // `--image` accepts one-or-more values, so without an explicit option
          // boundary it greedily consumes the prompt as another image path.
          // `--` ends option parsing and leaves the final value as [PROMPT].
          args.push("--", prompt);

          const child = execFile("codex", args, { maxBuffer: 10 * 1024 * 1024, timeout: 180_000 }, (err, stdout, stderr) => {
            if (dir) rmSync(dir, { recursive: true, force: true });
            if (err) {
              const msg = (stderr || err.message || "Codex execution failed").toString();
              return send(500, { error: msg.slice(0, 2000) });
            }
            const text = stdout.toString().trim();
            if (!text) {
              return send(500, {
                error: "Codex returned empty text. Run `codex login`, then retry, or switch the AI engine to Claude Code CLI.",
              });
            }
            send(200, { text });
          });
          // execFile creates a writable stdin pipe. Codex detects that pipe and
          // waits for "additional input" unless the parent explicitly closes it.
          child.stdin?.end();
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
        const send = (code: number, body: unknown) => {
          res.statusCode = code;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(body));
        };

        // GET /api/tts/voices → list every voice on the account (stock + custom/cloned)
        if (req.method === "GET" && (req.url ?? "").startsWith("/voices")) {
          try {
            if (!apiKey) return send(500, { error: "ELEVENLABS_API_KEY not set in .env.local" });
            const r = await fetch("https://api.elevenlabs.io/v1/voices", { headers: { "xi-api-key": apiKey } });
            if (!r.ok) {
              const detail = await r.text().catch(() => "");
              return send(r.status, { error: `ElevenLabs ${r.status}: ${detail.slice(0, 300)}` });
            }
            const data = (await r.json()) as { voices?: Array<{ voice_id: string; name: string; category?: string }> };
            const voices = (data.voices ?? []).map((v) => ({ id: v.voice_id, label: v.name, category: v.category }));
            return send(200, { voices });
          } catch (e) {
            return send(500, { error: e instanceof Error ? e.message : String(e) });
          }
        }

        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }
        try {
          if (!apiKey) return send(500, { error: "ELEVENLABS_API_KEY not set in .env.local" });
          const { text, voiceId, speed, model, stability, style } = JSON.parse(await readBody(req)) as {
            text: string; voiceId: string; speed?: number; model?: string; stability?: number; style?: number;
          };
          const clean = (text ?? "").trim();
          if (!clean) return send(400, { error: "empty voiceover text" });
          if (!voiceId) return send(400, { error: "missing ElevenLabs voiceId" });
          // voice_settings: speed 0.7..1.2 (1 = natural); stability/style 0..1.
          const voiceSettings: Record<string, number> = {};
          if (typeof speed === "number" && speed !== 1) voiceSettings.speed = Math.min(1.2, Math.max(0.7, speed));
          if (typeof stability === "number") voiceSettings.stability = Math.min(1, Math.max(0, stability));
          if (typeof style === "number") voiceSettings.style = Math.min(1, Math.max(0, style));
          const body: Record<string, unknown> = { text: clean, model_id: model || "eleven_multilingual_v2" };
          if (Object.keys(voiceSettings).length) body.voice_settings = voiceSettings;
          // with-timestamps → JSON { audio_base64, alignment } so callers get exact timing.
          const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`, {
            method: "POST",
            headers: { "xi-api-key": apiKey, "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify(body),
          });
          if (!r.ok) {
            const detail = await r.text().catch(() => "");
            return send(r.status, { error: `ElevenLabs ${r.status}: ${detail.slice(0, 300)}` });
          }
          const out = (await r.json()) as { audio_base64?: string; alignment?: unknown; normalized_alignment?: unknown };
          return send(200, { audioBase64: out.audio_base64 ?? "", alignment: out.alignment ?? out.normalized_alignment ?? null });
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
const STICKER_RE = /\.(png|svg|webp)$/i;
const STICKER_MIME: Record<string, string> = { png: "image/png", svg: "image/svg+xml", webp: "image/webp" };

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

// Dev-only SFX library: lists/streams sounds in AUDIO_DIR and accepts uploads that
// are written into that folder (so uploaded SFX join the library). Names are
// basename()'d before joining, so a request can't escape the configured folder.
function audioLibrary(dir: string): Plugin {
  return {
    name: "audio-library",
    configureServer(server) {
      server.middlewares.use("/api/audio", async (req, res) => {
        const u = new URL(req.url ?? "/", "http://localhost");
        const sendJson = (code: number, body: unknown) => {
          res.statusCode = code;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(body));
        };
        // GET /list → filenames in the audio dir
        if (req.method === "GET" && u.pathname === "/list") {
          try {
            const files = dir ? readdirSync(dir).filter((n) => AUDIO_RE.test(n)).sort() : [];
            sendJson(200, { files });
          } catch { sendJson(200, { files: [] }); }
          return;
        }
        // GET /file?name= → stream one sound
        if (req.method === "GET" && u.pathname === "/file") {
          const name = basename(u.searchParams.get("name") ?? "");
          if (!dir || !name || !AUDIO_RE.test(name)) { res.statusCode = 400; res.end(); return; }
          try {
            const data = readFileSync(join(dir, name));
            res.statusCode = 200;
            res.setHeader("content-type", "audio/mpeg");
            res.setHeader("content-length", String(data.length));
            res.end(data);
          } catch { res.statusCode = 404; res.end(); }
          return;
        }
        // POST /upload?name= (raw bytes) → copy the file into the audio dir
        if (req.method === "POST" && u.pathname === "/upload") {
          const name = basename(u.searchParams.get("name") ?? "");
          if (!dir || !name || !AUDIO_RE.test(name)) { return sendJson(400, { error: "invalid or unsupported audio filename" }); }
          try {
            mkdirSync(dir, { recursive: true });
            writeFileSync(join(dir, name), await readBodyBuffer(req));
            sendJson(200, { ok: true, name });
          } catch (e) {
            sendJson(500, { error: e instanceof Error ? e.message : String(e) });
          }
          return;
        }
        res.statusCode = 404; res.end();
      });
    },
  };
}

// Dev-only sticker library: lists/streams images in STICKERS_DIR and accepts
// uploads that are written into that folder (so an uploaded sticker joins the
// library). Mirrors audioLibrary — names are basename()'d before joining, so a
// request can't escape the configured folder.
function stickerLibrary(dir: string): Plugin {
  return {
    name: "sticker-library",
    configureServer(server) {
      server.middlewares.use("/api/stickers", async (req, res) => {
        const u = new URL(req.url ?? "/", "http://localhost");
        const sendJson = (code: number, body: unknown) => {
          res.statusCode = code;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(body));
        };
        // GET /list → filenames in the stickers dir
        if (req.method === "GET" && u.pathname === "/list") {
          try {
            const files = dir ? readdirSync(dir).filter((n) => STICKER_RE.test(n)).sort() : [];
            sendJson(200, { files });
          } catch { sendJson(200, { files: [] }); }
          return;
        }
        // GET /file?name= → stream one sticker
        if (req.method === "GET" && u.pathname === "/file") {
          const name = basename(u.searchParams.get("name") ?? "");
          if (!dir || !name || !STICKER_RE.test(name)) { res.statusCode = 400; res.end(); return; }
          try {
            const data = readFileSync(join(dir, name));
            const ext = name.split(".").pop()?.toLowerCase() ?? "";
            res.statusCode = 200;
            res.setHeader("content-type", STICKER_MIME[ext] ?? "application/octet-stream");
            res.setHeader("content-length", String(data.length));
            res.end(data);
          } catch { res.statusCode = 404; res.end(); }
          return;
        }
        // POST /upload?name= (raw bytes) → copy the file into the stickers dir
        if (req.method === "POST" && u.pathname === "/upload") {
          const name = basename(u.searchParams.get("name") ?? "");
          if (!dir || !name || !STICKER_RE.test(name)) { return sendJson(400, { error: "invalid or unsupported sticker filename" }); }
          try {
            mkdirSync(dir, { recursive: true });
            writeFileSync(join(dir, name), await readBodyBuffer(req));
            sendJson(200, { ok: true, name });
          } catch (e) {
            sendJson(500, { error: e instanceof Error ? e.message : String(e) });
          }
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
  const audioDir = abs(env.AUDIO_DIR ?? "", resolve(process.cwd(), "audio"));
  const stickersDir = abs(env.STICKERS_DIR ?? "", resolve(process.cwd(), "stickers"));
  const defaultMusicPath = abs(env.DEFAULT_MUSIC ?? "", join(musicDir, "City Nights.mp3"));
  return {
    plugins: [
      react(),
      claudeProxy(),
      codexProxy(),
      elevenProxy(env.ELEVENLABS_API_KEY ?? ""),
      defaultMusic(defaultMusicPath),
      musicLibrary(musicDir),
      overlayLibrary(overlaysDir),
      audioLibrary(audioDir),
      stickerLibrary(stickersDir),
    ],
    server: { headers: isolation },
    preview: { headers: isolation },
    optimizeDeps: { exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util"] },
    test: { environment: "node" },
  };
});
