# Graph Report - .  (2026-07-26)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 1079 nodes · 2347 edges · 92 communities (58 shown, 34 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 41 edges (avg confidence: 0.73)
- Token cost: 3,264 input · 1,098 output

## Graph Freshness
- Built from commit: `f9260753`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Caption Rendering and Canvas
- FFmpeg Emscripten Core
- Color Grading and Filters
- Color Matrix and Curves
- Project Persistence and Packaging
- Title Fonts and Typography
- Core Video Editing Types
- Sticker Overlays and Rendering
- App Settings and Configuration
- Video and Subtitle Export
- Color Palette Management
- Editor Assembly and Defaults
- Inspector and Ken Burns
- AI Story Authoring
- TTS and Export Options
- Media Ingestion and Probing
- AI Caption Refinement
- TypeScript Compiler Configuration
- FFmpeg Export Engine UI
- Export View and Voiceovers
- ElevenLabs TTS Integration
- Project ADRs and Landing
- Emscripten Networking and Strings
- Clip Analysis and Sampling
- Overlay and Segment Graph
- Emscripten System Calls
- Wasm Function Invocation
- C++ Exception Handling
- Global TypeScript Settings
- Vision Descriptions TS Config
- Vite Proxy Configuration
- Project State and Theme
- Vision Descriptions Package Metadata
- Vision Description Main Logic
- React and Test Dependencies
- Emscripten Runtime and Filesystem
- Overlay Selection UI
- Title Presets and Storage
- Sound Effects Library
- Build Tool Dependencies
- Emscripten Date and Time
- Wasm Loading and Dependencies
- TypeScript Library Definitions
- Studio App Drawers
- Kokoro TTS Dependencies
- FFmpeg Export Package Metadata
- FFmpeg Engine Concurrency
- Kokoro TTS Integration
- Studio UI Layouts
- Emscripten Lifecycle Callbacks
- Clip Description Script
- Root Package Configuration
- Emscripten Utility Functions
- FFmpeg Utility Dependencies
- NPM Build Scripts
- Emscripten Memory Management
- Emscripten Environment Variables
- FFmpeg Export Build Config
- Color Grade Testing
- Python Environment Runner
- Vision Descriptions Environment Types
- Main App Environment Types
- Main TypeScript Config
- Architecture and Graph Tasks
- FFmpeg Export Vite Config
- AI Story Generation Tasks
- Beat Rotation Tasks
- Color Grading Tasks
- Color Palette Tasks
- Color Grade Parity
- Project Documentation and Terms
- Studio V2 UI Interactions
- Export Interface UI
- Landing Page UI
- UI Design System Governance
- Clip Description ADR
- Remotion Decision ADR
- Color Palette ADR
- Google Font ADR
- Export Issue Tracking
- Export Performance Optimization
- Google Font Tasks
- Feature Roadmap
- Export Architecture Planning
- Ken Burns Effect Tasks
- Black Screen Troubleshooting
- Sound Effects Tasks
- FFmpeg Export Spike
- Vision Descriptions Spike
- Sticker Feature Tasks
- Still Image Feature Tasks

## God Nodes (most connected - your core abstractions)
1. `Clip` - 32 edges
2. `exportCut()` - 25 edges
3. `useProject()` - 23 edges
4. `Inspector()` - 22 edges
5. `Cut` - 20 edges
6. `compilerOptions` - 17 edges
7. `getWasmTableEntry()` - 16 edges
8. `ColorAdjustments` - 16 edges
9. `ADR-0012` - 16 edges
10. `compilerOptions` - 15 edges

## Surprising Connections (you probably didn't know these)
- `Landing Hero UI` --conceptually_related_to--> `Roadmap`  [INFERRED]
  design-demos/land-hero.png → docs/ROADMAP.md
- `Landing How-it-works UI` --conceptually_related_to--> `Roadmap`  [INFERRED]
  design-demos/land-how.png → docs/ROADMAP.md
- `Direction C — Guided` --semantically_similar_to--> `Guided UI`  [INFERRED] [semantically similar]
  design-demos/C-guided.html → design-demos/C-guided.png
- `Studio V2 UI` --semantically_similar_to--> `Port Plan — Direction A (Studio)`  [INFERRED] [semantically similar]
  design-demos/A-studio-v2.png → design-demos/PORT-PLAN.md
- `seek()` --indirect_call--> `done()`  [INFERRED]
  src/lib/frameSampler.ts → public/ffmpeg-st/ffmpeg-core.js

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Design Directions** — design_demos_a_studio_png, design_demos_b_storyboard_png, design_demos_c_guided_png [EXTRACTED 1.00]
- **Preview/Export Parity Principle** — docs_adr_0008, docs_adr_0010, docs_adr_0011 [EXTRACTED 0.90]

## Communities (92 total, 34 thin omitted)

### Community 0 - "Caption Rendering and Canvas"
Cohesion: 0.05
Nodes (66): CaptionSpec, drawCaptionBlock(), ensureCaptionFont(), renderCaptionToPng(), roundRectPath(), ADR-0008, wrapParagraphs(), ASPECT_RATIO (+58 more)

### Community 1 - "FFmpeg Emscripten Core"
Cohesion: 0.04
Nodes (20): bigintToI53Checked(), doCallback(), done(), doReadv(), doWritev(), _emscripten_asm_const_int(), exec(), exitJS() (+12 more)

### Community 2 - "Color Grading and Filters"
Cohesion: 0.11
Nodes (37): ColorAdjustments, callClaudeVision(), deleteCustomPreset(), FilterPreset, getAllFilterPresets(), getFilterPresetById(), loadCustomPresets(), saveCustomPreset() (+29 more)

### Community 3 - "Color Matrix and Curves"
Cohesion: 0.10
Nodes (38): applyMatrix(), AXES, clamp01(), clampAxis(), ColorMatrix, curveIsActive(), curveOvershoots(), curveStep() (+30 more)

### Community 4 - "Project Persistence and Packaging"
Cohesion: 0.11
Nodes (30): blobUrlCache, getClipBlobUrl(), blobToDataUrl(), dataUrlToBlob(), exportProjectFile(), importProjectFile(), dataUrl(), kbBeat (+22 more)

### Community 5 - "Title Fonts and Typography"
Cohesion: 0.14
Nodes (31): cache, getTitleFontBytes(), ADR-0008, sliderTrackStyle(), TITLE_WEIGHTS, TitleTreatmentEditor(), ensureFontLoadedById(), ensureGoogleFontLoaded() (+23 more)

### Community 6 - "Core Video Editing Types"
Cohesion: 0.10
Nodes (28): Aspect, Beat, Clip, Cut, SfxSegment, StoryBeat, ADR-0001, ADR-0002 (+20 more)

### Community 7 - "Sticker Overlays and Rendering"
Cohesion: 0.12
Nodes (31): Sticker, ADR-0011, StickerOverlay(), activeStickers(), BeatSpan, canvasToPng(), clamp(), drawSticker() (+23 more)

### Community 8 - "App Settings and Configuration"
Cohesion: 0.14
Nodes (22): App(), AI_PROVIDER_OPTIONS, AiProvider, DEFAULTS, loadSettings(), MODEL_OPTIONS, SCRIPT_TYPE_OPTIONS, scriptTypeHint() (+14 more)

### Community 9 - "Video and Subtitle Export"
Cohesion: 0.12
Nodes (21): ADR-0003, ExportQualityProfile, beatAudioStrategy(), beatInputArgs(), BeatTiming, buildSrt(), bytesOf(), exportCut() (+13 more)

### Community 10 - "Color Palette Management"
Cohesion: 0.18
Nodes (20): addPaletteColor(), dedupe(), DEFAULT_PALETTE, emit(), Listener, listeners, loadPalette(), normalizeHex() (+12 more)

### Community 11 - "Editor Assembly and Defaults"
Cohesion: 0.17
Nodes (16): EDITOR_DEFAULTS, QualitySetting, Story, assembleCut(), computeWindow(), makeBeat(), newId(), ADR-0004 (+8 more)

### Community 12 - "Inspector and Ken Burns"
Cohesion: 0.21
Nodes (16): reset(), KenBurns, cutDuration(), canvasDims(), beatSpans(), resolveSticker(), makeBeatTitleLayers(), useExportSettings() (+8 more)

### Community 13 - "AI Story Authoring"
Cohesion: 0.16
Nodes (17): authorBeatScripts(), authorStory(), BeatDesc, buildBeatScriptPrompt(), buildPrompt(), ClipPayload, ClipRef, extractJson() (+9 more)

### Community 14 - "TTS and Export Options"
Cohesion: 0.18
Nodes (16): ExportOptions, ExportQuality, TitleAnimation, PreviewTitleLayer, Props, WordTiming, Voice, Narration (+8 more)

### Community 15 - "Media Ingestion and Probing"
Cohesion: 0.18
Nodes (13): createClip(), extOf(), fileBytes(), isStillFile(), needsNormalize(), normalizeTo1080p(), ADR-0002, probeStill() (+5 more)

### Community 16 - "AI Caption Refinement"
Cohesion: 0.20
Nodes (14): ADR-0005, parseAlternatives(), rewriteCaption(), suggestCaptionAlternatives(), suggestLineAlternatives(), callClaude(), ClaudeConfig, DESCRIBE_PROMPT() (+6 more)

### Community 17 - "TypeScript Compiler Configuration"
Cohesion: 0.12
Nodes (17): vite/client, compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, module, moduleDetection, moduleResolution (+9 more)

### Community 18 - "FFmpeg Export Engine UI"
Cohesion: 0.18
Nodes (16): clipBar, clipLabel, detach(), downloadEl, log(), logEl, mb(), newEngine() (+8 more)

### Community 19 - "Export View and Voiceovers"
Cohesion: 0.29
Nodes (15): buildScriptText(), download(), ExportView(), formatElapsed(), sliderTrackStyle(), fetchElevenVoices(), activeVoPresetSettings(), deleteVoPreset() (+7 more)

### Community 20 - "ElevenLabs TTS Integration"
Cohesion: 0.19
Nodes (15): alignmentToWords(), base64ToBytes(), CUSTOM_CATEGORIES, ELEVEN_MODELS, ELEVEN_VOICES, ElevenAlignment, elevenQueue, ElevenSynthOptions (+7 more)

### Community 21 - "Project ADRs and Landing"
Cohesion: 0.13
Nodes (16): Landing Hero UI, Landing How-it-works UI, ADR-0001: Story from Vision Descriptions, ADR-0002: Fully Client-Side 1080p, ADR-0003: No In-App TTS, ADR-0004: Script-Driven Pacing, ADR-0005: AI via Local Claude Proxy, ADR-0006: In-App Voiceover (+8 more)

### Community 22 - "Emscripten Networking and Strings"
Cohesion: 0.15
Nodes (13): _getnameinfo(), inetNtop4(), inetNtop6(), intArrayFromString(), LazyUint8Array(), lengthBytesUTF8(), readSockaddr(), stringToNewUTF8() (+5 more)

### Community 23 - "Clip Analysis and Sampling"
Cohesion: 0.23
Nodes (13): ClipDescription, analyzeClip(), hintFromName(), ADR-0001, loadImage(), loadVideo(), renderStillContained(), sampleFrameAt() (+5 more)

### Community 24 - "Overlay and Segment Graph"
Cohesion: 0.19
Nodes (13): ADR-0016, OverlayClip, beat(), calls, clip(), cutWith(), LayerName, LAYERS (+5 more)

### Community 25 - "Emscripten System Calls"
Cohesion: 0.18
Nodes (15): alignMemory(), getSocketAddress(), getSocketFromFD(), mmapAlloc(), ___syscall_accept4(), ___syscall_bind(), ___syscall_connect(), ___syscall_getpeername() (+7 more)

### Community 26 - "Wasm Function Invocation"
Cohesion: 0.13
Nodes (15): getWasmTableEntry(), invoke_i(), invoke_ii(), invoke_iii(), invoke_iiii(), invoke_iiiii(), invoke_iiiiii(), invoke_iiiiiiiii() (+7 more)

### Community 28 - "Global TypeScript Settings"
Cohesion: 0.14
Nodes (14): compilerOptions, allowImportingTsExtensions, isolatedModules, module, moduleDetection, moduleResolution, noEmit, noFallthroughCasesInSwitch (+6 more)

### Community 29 - "Vision Descriptions TS Config"
Cohesion: 0.14
Nodes (13): compilerOptions, isolatedModules, module, moduleDetection, moduleResolution, noEmit, noUnusedLocals, noUnusedParameters (+5 more)

### Community 31 - "Project State and Theme"
Cohesion: 0.23
Nodes (11): useAutoSaveProject(), useProject(), getInitialTheme(), Theme, ThemeContext, ThemeContextType, ThemeProvider(), useTheme() (+3 more)

### Community 32 - "Vision Descriptions Package Metadata"
Cohesion: 0.17
Nodes (11): ffmpeg-static, dependencies, ffmpeg-static, name, private, scripts, build, dev (+3 more)

### Community 33 - "Vision Description Main Logic"
Cohesion: 0.21
Nodes (11): ClaudeResponse, ClaudeUsage, describe(), Frame, grabFrames(), resultsEl, run(), runBtn (+3 more)

### Community 34 - "React and Test Dependencies"
Cohesion: 0.18
Nodes (11): devDependencies, @types/react, @types/react-dom, vite, @vitejs/plugin-react, vitest, vite, @types/react (+3 more)

### Community 35 - "Emscripten Runtime and Filesystem"
Cohesion: 0.20
Nodes (11): abort(), _dlopen(), ___dlsym(), getBinary(), getBinaryPromise(), getValue(), initRandomFill(), instantiateArrayBuffer() (+3 more)

### Community 36 - "Overlay Selection UI"
Cohesion: 0.22
Nodes (8): OverlayBlendMode, f(), OverlayCardProps, OverlayPickerModal(), Props, StockFile, Tab, UploadTabProps

### Community 37 - "Title Presets and Storage"
Cohesion: 0.36
Nodes (9): Props, BUILT_IN_PRESETS, exportPresetsToJson(), getStorageKey(), loadSavedPresets(), parsePresetsJson(), savePreset(), TitlePreset (+1 more)

### Community 38 - "Sound Effects Library"
Cohesion: 0.33
Nodes (9): bufferCache, fetchSfxBytes(), fetchSfxList(), loadSfxBuffer(), sfxAudioContext(), sfxDuration(), sfxFileUrl(), uploadSfx() (+1 more)

### Community 39 - "Build Tool Dependencies"
Cohesion: 0.20
Nodes (10): typescript, typescript, devDependencies, typescript, vite, vite, devDependencies, typescript (+2 more)

### Community 40 - "Emscripten Date and Time"
Cohesion: 0.20
Nodes (10): addDays(), arraySum(), __gmtime_js(), isLeapYear(), __localtime_js(), __mktime_js(), readI53FromI64(), _strftime() (+2 more)

### Community 41 - "Wasm Loading and Dependencies"
Cohesion: 0.24
Nodes (10): addRunDependency(), assert(), asyncLoad(), createWasm(), FS_createPreloadedFile(), getUniqueRunDependency(), handleMessage(), instantiateAsync() (+2 more)

### Community 42 - "TypeScript Library Definitions"
Cohesion: 0.20
Nodes (10): lib, DOM, ES2022, lib, DOM, ES2022, lib, DOM (+2 more)

### Community 43 - "Studio App Drawers"
Cohesion: 0.29
Nodes (6): AiStoryDrawer(), poster(), seedProject(), ExportDrawer(), SettingsDrawer(), StudioApp()

### Community 44 - "Kokoro TTS Dependencies"
Cohesion: 0.22
Nodes (9): kokoro-js, dependencies, @ffmpeg/ffmpeg, kokoro-js, react, react-dom, @ffmpeg/ffmpeg, react (+1 more)

### Community 45 - "FFmpeg Export Package Metadata"
Cohesion: 0.22
Nodes (8): name, private, scripts, build, dev, preview, type, version

### Community 46 - "FFmpeg Engine Concurrency"
Cohesion: 0.28
Nodes (8): exportConcurrency(), CoreUrls, EngineInput, multithreadReady(), runIsolated(), summarizeFfmpegError(), ADR-0002, normalizeConcurrency()

### Community 47 - "Kokoro TTS Integration"
Cohesion: 0.25
Nodes (7): GenerateOptions, LoadProgress, loadVoiceModel(), Narration, synthesizeVoiceover(), VoiceOption, VOICES

### Community 48 - "Studio UI Layouts"
Cohesion: 0.25
Nodes (8): Studio UI, Studio V2 UI, Storyboard UI, Direction C — Guided, Guided UI, Direction Approved, Port Plan — Direction A (Studio), Studio Stage

### Community 49 - "Emscripten Lifecycle Callbacks"
Cohesion: 0.25
Nodes (8): addOnPostRun(), addOnPreRun(), callRuntimeCallbacks(), initRuntime(), postRun(), preRun(), run(), setTimeout()

### Community 50 - "Clip Description Script"
Cohesion: 0.32
Nodes (7): args, clips, describe(), durationSeconds(), extractFrames(), ADR-0001, PROMPT_HEAD()

### Community 51 - "Root Package Configuration"
Cohesion: 0.29
Nodes (6): name, overrides, sharp, private, type, version

### Community 52 - "Emscripten Utility Functions"
Cohesion: 0.29
Nodes (7): ___assert_fail(), _getaddrinfo(), inetPton4(), inetPton6(), jstoi_q(), UTF8ArrayToString(), UTF8ToString()

### Community 53 - "FFmpeg Utility Dependencies"
Cohesion: 0.33
Nodes (6): @ffmpeg/util, @ffmpeg/util, dependencies, @ffmpeg/ffmpeg, @ffmpeg/util, @ffmpeg/ffmpeg

### Community 54 - "NPM Build Scripts"
Cohesion: 0.33
Nodes (6): scripts, build, dev, preview, test, test:watch

### Community 55 - "Emscripten Memory Management"
Cohesion: 0.40
Nodes (5): _emscripten_get_heap_max(), emscripten_realloc_buffer(), _emscripten_resize_heap(), getHeapMax(), updateMemoryViews()

### Community 56 - "Emscripten Environment Variables"
Cohesion: 0.40
Nodes (5): _environ_get(), _environ_sizes_get(), getEnvStrings(), getExecutableName(), stringToAscii()

### Community 57 - "FFmpeg Export Build Config"
Cohesion: 0.50
Nodes (3): vite.config.ts, include, src

### Community 58 - "Color Grade Testing"
Cohesion: 0.67
Nodes (3): bodyOf(), SRC, ADR-0010

## Knowledge Gaps
- **274 isolated node(s):** `name`, `private`, `version`, `type`, `dev` (+269 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **34 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `reset()` connect `Inspector and Ken Burns` to `FFmpeg Emscripten Core`?**
  _High betweenness centrality (0.190) - this node is a cross-community bridge._
- **Why does `Inspector()` connect `Inspector and Ken Burns` to `Caption Rendering and Canvas`, `Sticker Overlays and Rendering`, `App Settings and Configuration`, `Color Palette Management`, `Editor Assembly and Defaults`, `Project State and Theme`?**
  _High betweenness centrality (0.138) - this node is a cross-community bridge._
- **Why does `KenBurnsControls()` connect `Inspector and Ken Burns` to `Caption Rendering and Canvas`, `Color Palette Management`?**
  _High betweenness centrality (0.055) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `Inspector()` (e.g. with `reset()` and `newId()`) actually correct?**
  _`Inspector()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **What connects `name`, `private`, `version` to the rest of the system?**
  _274 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Caption Rendering and Canvas` be split into smaller, more focused modules?**
  _Cohesion score 0.05432098765432099 - nodes in this community are weakly interconnected._
- **Should `FFmpeg Emscripten Core` be split into smaller, more focused modules?**
  _Cohesion score 0.041742286751361164 - nodes in this community are weakly interconnected._