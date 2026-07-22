# 🚀 High-Impact Feature Roadmap & Technical Blueprint

This document outlines the next high-impact features for **Simple Video Editor**, leveraging its existing **React 18 + WebAssembly FFmpeg + Kokoro TTS + Gemini AI** technology stack.

---

## 📋 Feature Overview Matrix

| # | Feature Name | User Impact | Tech Feasibility | Primary Technology |
|---|---|---|---|---|
| **1** | **Studio Video Transitions Between Beats** | 🔥🔥🔥 High | ⚡ Easy | FFmpeg Wasm `xfade` filter + CSS View Transitions |
| **2** | **Title Background Boxes & Glass Pills** | 🔥🔥🔥 High | ⚡ Easy | CSS Glassmorphism + FFmpeg `drawtext` box |
| **3** | **Focal-Point Smart Reframing (9:16 Shorts)** | 🔥🔥🔥 High | 🎯 Medium | CSS `object-position` + FFmpeg `crop` filter |
| **4** | **Per-Beat Playback Speed (Slow-Mo / Time-Lapse)** | 🔥🔥 Medium | ⚡ Easy | `<video playbackRate>` + FFmpeg `setpts` |
| **5** | **Brand Logo & Watermark Overlay** | 🔥🔥 Medium | ⚡ Easy | Canvas Overlay + FFmpeg `overlay` filter |
| **6** | **Title Motion Intro Animations** | 🔥🔥🔥 High | 🎯 Medium | CSS `@keyframes` + FFmpeg alpha/position Math |
| **7** | **One-Click AI Auto-Highlight Generator** | 🔥🔥🔥 High | 🧠 Advanced | Gemini Multimodal API + Auto-Cut Pipeline |

---

## 🛠️ Feature Technical Blueprints

### 1. 🎞️ Studio Video Transitions Between Beats
- **Value Proposition**: Add professional transitions between video clips without requiring heavy desktop editing software like Premiere or Final Cut.
- **Supported Transitions**: `Crossfade`, `Fade to Black`, `Wipe Left/Right`, `Zoom Blur`, `Dip to White`.
- **Implementation Strategy**:
  - **Live Preview Theater**: Apply CSS transition classes or View Transitions API between beat switches.
  - **FFmpeg MP4 Exporter**: Utilize FFmpeg's built-in `xfade` filter graph:
    ```bash
    ffmpeg -i seg0.mp4 -i seg1.mp4 -filter_complex "[0:v][1:v]xfade=transition=fade:duration=0.5:offset=3.5[v]" -map "[v]" final.mp4
    ```

---

### 2. 🏷️ Title Background Boxes & Glass Pills (Sticker Underlays)
- **Value Proposition**: Ensure title overlays remain 100% readable regardless of background video brightness or motion complexity.
- **Styling Options**:
  - Translucent Dark Box (`rgba(0,0,0,0.65)`)
  - Glassmorphic Blur Pill (`backdrop-filter: blur(12px)`)
  - Accent Color Badge with customizable border radius & padding.
- **Implementation Strategy**:
  - **Live Preview Theater**: Wrap title `<span>` with styled `<div>` background box.
  - **FFmpeg MP4 Exporter**: Pass `box=1:boxcolor=black@0.65:boxborderw=12` to `drawtext` filter graph.

---

### 3. 🎯 Focal-Point Smart Reframing (16:9 ➔ 9:16 Vertical Shorts/Reels)
- **Value Proposition**: When converting widescreen videos (16:9) to Vertical Shorts/Reels (9:16), keep key subjects (faces, products) perfectly centered instead of generic middle cropping.
- **Interactive Control**: Click directly on the video player in Inspector to set a Focal Point $(X, Y)$ coordinate per beat.
- **Implementation Strategy**:
  - **Live Preview Theater**: Set CSS `object-position: X% Y%`.
  - **FFmpeg MP4 Exporter**: Compute dynamic crop coordinates for FFmpeg filter:
    ```bash
    crop=in_h*(9/16):in_h:clamp(in_w*focalX - crop_w/2, 0, in_w - crop_w):0
    ```

---

### 4. 🎚️ Per-Beat Playback Speed Multiplier
- **Value Proposition**: Create cinematic slow-motion highlights or fast-paced time-lapses per clip.
- **Speed Choices**: `0.25×`, `0.5× (Slow-Mo)`, `1.0× (Normal)`, `1.5×`, `2.0× (Fast Forward)`, `4.0× (Time-Lapse)`.
- **Implementation Strategy**:
  - **Live Preview Theater**: Dynamically update `videoRef.current.playbackRate = beat.speed`.
  - **FFmpeg MP4 Exporter**: Apply `setpts` filter for video speed and `atempo` filter for audio pitch-preserved speed adjustment:
    ```bash
    # For 0.5x Slow Motion:
    -vf "setpts=2.0*PTS" -af "atempo=0.5"
    ```

---

### 5. 🖼️ Brand Logo & Watermark Overlay
- **Value Proposition**: Enable creators, marketers, and brands to stamp custom logos over exported reels.
- **Features**: PNG file uploader, corner placement selection (Top-Left, Top-Right, Bottom-Left, Bottom-Right), size scale slider, and opacity slider.
- **Implementation Strategy**:
  - **Live Preview Theater**: Absolute positioned `<img>` element with `opacity` & corner flex positioning.
  - **FFmpeg MP4 Exporter**: Pass logo PNG file buffer into FFmpeg `overlay` filter graph:
    ```bash
    -i video.mp4 -i logo.png -filter_complex "[1:v]format=rgba,colorchannelmixer=aa=0.8[logo];[0:v][logo]overlay=main_w-overlay_w-20:20" output.mp4
    ```

---

### 6. 🪄 Title Motion Intro Animations
- **Value Proposition**: Bring title overlays to life with dynamic entry motions instead of static text appearances.
- **Animation Styles**:
  - **Fade In** (0.4s smooth alpha ease)
  - **Slide In from Left / Bottom** (smooth position slide)
  - **Pop & Scale** (bounce scale from 80% to 100%)
  - **Typewriter Effect** (character-by-character reveal)
- **Implementation Strategy**:
  - **Live Preview Theater**: CSS `@keyframes` triggered on beat start.
  - **FFmpeg MP4 Exporter**: Time-dependent `alpha` and `x/y` math expressions inside `drawtext`:
    ```bash
    drawtext=...:x='if(lt(t,0.5), (w-text_w)/2 - (1-t/0.5)*200, (w-text_w)/2)':alpha='if(lt(t,0.5), t/0.5, 1)'
    ```

---

### 7. 🤖 One-Click AI Auto-Highlight Reel Generator
- **Value Proposition**: Instant 1-click video creation from raw camera footage.
- **User Workflow**:
  1. Upload 3 to 10 raw video clips.
  2. Click **"✨ Auto-Generate Highlight Reel"**.
  3. AI inspects clips, selects key action moments, writes narration, picks an optimal title preset (*✨ Cinematic Gold*), and generates the finished reel automatically.
- **Implementation Strategy**:
  - Send keyframes to Gemini Multimodal API.
  - Parse structured JSON containing selected clip IDs, `inSec`/`outSec` cut points, beat script narration, and recommended title preset.
  - Dispatch `SET_CUT` and launch export pipeline automatically.

---

## 📌 Implementation Checklist & Next Steps

- [ ] **Phase 1**: Add **Title Background Boxes & Glass Pills** (UI & FFmpeg box).
- [ ] **Phase 2**: Add **Per-Beat Playback Speed Multiplier** (Slow-Mo / Time-Lapse).
- [ ] **Phase 3**: Add **Brand Logo & Watermark Overlay** (PNG corner overlay).
- [ ] **Phase 4**: Add **Studio Video Transitions Between Beats** (FFmpeg `xfade`).
- [ ] **Phase 5**: Add **Focal-Point Smart Reframing** (9:16 Shorts focal targeting).
- [ ] **Phase 6**: Add **Title Motion Intro Animations** (CSS & FFmpeg math).
- [ ] **Phase 7**: Add **One-Click AI Auto-Highlight Generator** (Gemini pipeline).
