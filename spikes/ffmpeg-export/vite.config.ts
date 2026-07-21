import { defineConfig } from "vite";

// ffmpeg.wasm's multithreaded core needs SharedArrayBuffer, which requires the
// page to be cross-origin isolated. These headers are what make that work in
// dev and preview. If the real app is ever deployed, the host must send the
// same two headers — that is a real deployment constraint, not just a dev knob.
const crossOriginIsolation = {
  name: "cross-origin-isolation",
  configureServer(server: import("vite").ViteDevServer) {
    server.middlewares.use((_req, res, next) => {
      res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
      res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
      next();
    });
  },
};

export default defineConfig({
  plugins: [crossOriginIsolation],
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  preview: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  // @ffmpeg/ffmpeg ships worker code that Vite should not try to pre-bundle.
  optimizeDeps: { exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util"] },
});
