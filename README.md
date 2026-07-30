# Simple Video Editor (`VIDSTR`)

> **Local-First, Browser-Native AI & Non-Linear Video Editor**

`VIDSTR` (Simple Video Editor) is a powerful, privacy-focused, browser-based non-linear video editing workspace. It allows creators to transform raw video clips and still images into polished, captioned, voiceover-driven video edits completely in the browser—powered by a local AI script assistant, multi-lane timeline, interactive HTML5 Canvas previews, and in-browser rendering via self-hosted `ffmpeg.wasm`.

---

## 📸 Key Features

### 🎬 Non-Linear Timeline & Multi-Lane Composition
- **Beat-Based Cut Assembly**: Organize source media into primary video "Beats" with custom trim points (`inSec` / `outSec`), framing, and ordering.
- **Multi-Lane Layers**: Independent timeline lanes for:
  - **B-Roll Overlays**: Timed video tracks composited over the cut.
  - **Stickers**: Positioned PNG/SVG graphic overlays with custom scaling and placement.
  - **Voiceovers (VO)**: TTS or audio narration aligned to specific timeline windows.
  - **Sound Effects (SFX)**: Timed audio clips for impact and transitions.
  - **Captions & Titles**: Auto-aligned subtitles and styled title treatments.
- **Split-Screen & Layouts**: Built-in split-screen canvas layout presets.

### 🤖 Local AI Story & Script Assistant
- **Visual Frame Sampling**: Automatically samples keyframes from video clips and images to feed visual context to AI models.
- **Local CLI AI Providers**: Integrates seamlessly with your authenticated local **Claude CLI** (`claude -p`) or **Codex CLI** (`codex exec`), ensuring zero third-party API key exposure in browser client code.
- **Guided Script Generation**: Generate structured, one-line-per-beat scripts matching your project's direction, tone, and genre, with single-beat refinement capabilities.
- **Built-in Reel Templates**: Start a vertical Product Review, Lifestyle Vlog, Fashion Vlog, or Motivation Vlog from an ordered shot structure, with empty footage placeholders that can be filled later.
- **AI Autofill & Coverage Coach**: Match analyzed footage to template roles, reject weak or duplicate matches, and turn missing coverage into specific shots to film.

### 🎨 Motion, Color Grading & Framing
- **Ken Burns & Static Zoom**: Smooth pan-and-zoom motion paths for still images and static framing controls for video.
- **360° Rotation & Crop**: Per-beat rotation adjustments and aspect ratio switching (16:9, 9:16, 1:1, 4:5).
- **Color Grading & Film Looks**: Custom color adjustments (exposure, contrast, saturation, temperature, tint, shadows/highlights) and reusable global Look presets.
- **Video Transitions**: Seamless transitions (fade, dip-to-black, dip-to-white, slide) between timeline beats.

### 🎙️ Voiceover (TTS) & Audio Mixing
- **Dual TTS Engine**: Supports high-quality online narration via **ElevenLabs** API proxy as well as offline, local browser-native TTS via **Kokoro-JS**.
- **Multi-Channel Audio Mixer**: Independent volume controls and ducking for main video audio, B-roll audio, voiceovers, sound effects, and background music tracks.

### ⚡ Local-First Persistence & Export
- **IndexedDB Autosave**: Automatic project persistence in IndexedDB (`vidstr_projects_db`) with debounced auto-save status indicators.
- **Project Portability**: Export and import complete self-contained `.json` project packages including media assets and custom fonts.
- **In-Browser FFmpeg WASM Export**: Final MP4 rendering is executed entirely inside the browser using isolated `ffmpeg.wasm` instances. The stable single-threaded worker pool is the default; a guarded multithreaded core is available as an experimental opt-in and automatically falls back if it fails.
- **Quality-Preserving Re-export Cache**: Beat renders are keyed by their exact FFmpeg command and input bytes, so unchanged Beats are reused bit-for-bit while edited Beats are re-encoded.
- **First-Pass Fade Transitions**: Fade-to-black, fade-to-white, and standard fades are applied after the complete Beat Layer stack and joined with stream copy, avoiding a redundant full-Cut encode. Cross-Beat wipes and slides retain the compatibility transition pass.
- **Video Title Masks**: Any cut-level or per-Beat Title Layer can reveal the fully composited moving picture through its glyphs against black, with the same canvas matte used in preview and export.
- **Subtitle Export**: Export final scripts to `.srt` subtitle files or formatted text scripts alongside the rendered MP4.

---

## 📐 Architecture & Tech Stack

```text
StudioApp (React 18 + TypeScript + Vite)
├── ThemeProvider (Dark / Light Studio UI design tokens)
├── SettingsProvider (AI engine/model, tone, script settings)
├── ProjectProvider (ProjectState reducer: Clips, Beats, Layers, Cut)
└── ExportSettingsProvider (Output resolution, VO, music, caption presets)
```

- **Frontend Core**: React 18, TypeScript, Vite, Vanilla CSS design tokens (`studio.css`).
- **Media & Processing**: `@ffmpeg/ffmpeg` (WASM core), `kokoro-js`, HTML5 Canvas 2D APIs, Web Audio API.
- **Local Proxy Backend**: Vite `configureServer` middleware (`vite.config.ts`) serving local CLI bridges (`/api/claude`, `/api/codex`), TTS proxy (`/api/tts`), and local media asset directories (`/music`, `/overlays`, `/audio`, `/stickers`).

---

## 🚀 Getting Started

### Prerequisites

- **Node.js**: v18.0.0 or higher
- **npm**: v9.0.0 or higher
- *(Optional)* **Claude CLI** or **Codex CLI**: Required only if using local AI script generation features.
- *(Optional)* **ElevenLabs API Key**: Required only if using ElevenLabs voiceovers (otherwise Kokoro-JS local TTS can be used).

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/tutrinh/simple-video-editor.git
   cd simple-video-editor
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure Environment Variables (Optional)**:
   Create a `.env.local` file in the project root:
   ```env
   # ElevenLabs API Key for TTS (optional)
   ELEVENLABS_API_KEY="your_elevenlabs_api_key_here"

   # Custom local media directories (optional, defaults to project root subdirectories)
   MUSIC_DIR="./music"
   OVERLAYS_DIR="./overlays"
   AUDIO_DIR="./audio"
   STICKERS_DIR="./stickers"
   ```

4. **Start the Development Server**:
   ```bash
   npm run dev
   ```
   Open your browser at `http://localhost:5173`.

---

## 🛠️ Usage Workflow

1. **Upload Clips & Stills**: Drag and drop videos (`.mp4`, `.webm`, `.mov`) or still images (`.jpg`, `.png`, `.webp`) into the **Clip Bin**.
2. **Assemble the Cut**: Click **Start Cut** to automatically populate timeline beats from uploaded clips, or manually arrange and trim clips on the timeline.
3. **Author Script with AI** *(Optional)*: Open the **AI Story** side panel, select your AI provider (Claude or Codex), choose a tone/genre, and click **Generate Script**.
4. **Add Layers & Effects**:
   - Add B-roll video overlays, stickers, voiceovers, or sound effects from the timeline inspectors.
   - Adjust beat framing (Zoom / Ken Burns pan-and-zoom) and color grading.
5. **Preview & Export**:
   - Preview interactive playback in real time in the Stage Preview.
   - Click **Export Video**, configure output quality (1080p, aspect ratio, audio mix), and click **Start Export** to generate the final `.mp4` and `.srt` files.

---

## 💡 Important Nuances & Gotchas

1. **Local Vite Development Proxy**:
   - The app uses Vite dev-server middleware (`vite.config.ts`) as a local backend proxy. Features like AI CLI bridges (`claude -p`, `codex exec`), local directory file scanning, and ElevenLabs API proxying rely on this middleware. Running a pure static production bundle without an equivalent server will disable those local CLI/directory features.
2. **Media Blob URL Safety**:
   - Browser object URLs are cached and managed via `getClipBlobUrl()` (`src/lib/blobUrlCache.ts`) to avoid memory leaks and black screen preview bugs caused by premature `URL.revokeObjectURL()` calls.
3. **Isolated FFmpeg WASM Execution**:
   - To prevent WebAssembly heap exhaustion during complex video encoding, `ffmpeg.wasm` runs a fresh isolated instance per operation. The default single-threaded mode uses a memory-aware operation pool. Experimental multithreaded mode is serialized to one engine and protected by a persistent circuit breaker.
   - The single-threaded pool adapts from one to four workers based on reported device memory and CPU concurrency. Cached Beat segments use a bounded, memory-aware LRU.
4. **Still Image Durations**:
   - Image files imported into the Clip Bin receive a synthetic default duration of 10 seconds, allowing full trimming and Ken Burns animation paths on the timeline.
5. **No AI API Keys in Client**:
   - Claude and Codex AI integration uses your local machine's pre-authenticated command-line interfaces rather than asking for API keys in the UI.

---

## 🧪 Available Scripts

| Command | Description |
| :--- | :--- |
| `npm run dev` | Starts the Vite development server with local API middleware |
| `npm test` | Runs the test suite via Vitest |
| `npm run test:watch` | Runs Vitest in watch mode |
| `npm run build` | Runs TypeScript checks (`tsc --noEmit`) and builds static assets into `dist/` |
| `npm run preview` | Previews the built production app locally |

---

## 📖 Key Documentation

For deep-dive technical guidelines and developer context, consult:
- [`CODEBASE_KNOWLEDGE.md`](./CODEBASE_KNOWLEDGE.md) — Comprehensive technical overview of architecture, domain invariants, and domain vocabulary.
- [`CONTEXT.md`](./CONTEXT.md) — Ubiquitous language and domain vocabulary.
- [`PHASE_2_PRODUCT_REVIEW_ARCHITECTURE.md`](./PHASE_2_PRODUCT_REVIEW_ARCHITECTURE.md) — Architecture for the Amazon Product Review drawer, grounded AI Script, and Shot List workflow.
- [`DESIGN_PATTERNS.md`](./DESIGN_PATTERNS.md) — Mandatory UI design system rules, CSS variable tokens, and accessibility standards.
- [`PREVIEW_BLACK_SCREEN_PREVENTION.md`](./PREVIEW_BLACK_SCREEN_PREVENTION.md) — Media object URL lifecycle and seek safety rules.

---

## 📄 License

Private repository / Internal project. All rights reserved.
