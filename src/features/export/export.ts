import type { Beat, Clip, Cut, Aspect, OverlayClip, SplitScreenConfig, Sticker, UserVoiceEffect, VideoTransitionType } from "../../domain/types";
import { multithreadReady, runIsolated, type EngineInput, type EnginePhase } from "../../lib/ffmpegEngine";
import { runPool } from "../../lib/pool";
import { synthesizeVoiceover, type TtsEngine } from "../../lib/tts";
import { fetchSfxBytes } from "../../lib/sfxLibrary";
import type { Voice } from "../../lib/kokoroTts";
import { captionSchedule } from "../../lib/pacing";
import { renderStillContained } from "../../lib/frameSampler";
import { ffmpegColorLut, beatFrameFilters, kenBurnsChain, kenBurnsPreScale } from "../../studio/util";
import { ensureTitleFontFace, renderTitleLayerToPng, titleFontKey, TITLE_ANIM } from "./titleCanvas";
import { getTitleFontBytes } from "./titleFonts";
import { findFontById } from "../../lib/googleFonts";
import { renderCaptionToPng } from "./captionCanvas";
import { renderStickersToPng, stickerWindowInSegment, beatSpans, resolveStickers, resolveSfxSegments } from "./stickerCanvas";
import { normalizeSplitConfig, buildSplitScreenFilterGraph } from "./splitScreenCanvas";
import { buildSegmentGraph, type StickerLayerSpec, type CaptionLayerSpec, type TitleLayerSpec, type OverlayLayerSpec, type LayerSpec } from "./segmentGraph";
import { cacheSegment, getCachedSegment, segmentCacheKey } from "./segmentCache";
import { titleWindow, type TitleScope } from "./titleTiming";
import { clampUserVoiceLevelDb, clampUserVoiceVolume, dbToLinear, userVoiceEqFilterChain } from "../../studio/userVoiceEq";
import { captionVoiceDuckingFilterChain } from "../../studio/userVoicePriority";
import { effectiveBeatVolume, effectiveSplitScreenSlotVolume } from "../../studio/beatAudio";
import { exportedCaptionWindows } from "./captionWindows";





// Full export (ADR-0002, ADR-0003): render the Cut client-side, one Beat per
// isolated engine — trim → scale/letterbox → BURN caption → uniform-silent
// segment — then concat (stream copy), then optionally lay a music bed over the
// whole thing. Captions use drawtext `textfile=` + `expansion=none`, which reads
// the caption from a file in the FS and sidesteps inline-escaping entirely.

export type TitleAnimation = "none" | "fade" | "slide_left" | "slide_bottom" | "slide_top" | "pop" | "typewriter";

export interface TitleLayer {
  id: string;
  enabled: boolean;
  text: string;
  fontId?: string;
  fontFile?: File | null;
  fontBytes?: Uint8Array;
  fontCssFamily?: string;
  weight?: number;
  sizePx: number;
  letterSpacing?: number;
  arcDeg?: number;
  shadow?: boolean;
  color: string;
  posX: number; // -50 .. +50 (% horizontal offset from center)
  posY: number; // -50 .. +50 (% vertical offset from center)
  scope: TitleScope;
  introSec?: number;
  startSec?: number;
  durationSec?: number;
  fadeOut?: boolean;
  animation?: TitleAnimation;
  animDurationSec?: number;
  boxWidthPct?: number;
  lineHeight?: number;
  typewriterCursor?: boolean;
  maskMode?: "none" | "video";
  maskColor?: string;
}


export interface TitleOverlay {
  layers: TitleLayer[];
}

import { EDITOR_DEFAULTS, type ExportQualityProfile } from "../../config/editorDefaults";

export type ExportQuality = ExportQualityProfile;

export interface ExportOptions {
  /** Video export quality profile: "standard" (CRF 22), "high" (CRF 18), "max" (CRF 15). */
  exportQuality?: ExportQuality;
  /** Optional music bed laid over the finished video (looped + trimmed). */
  music?: File | null;
  /** Music bed volume, 0–1 (default 0.5). Also the duck level under voiceover. */
  musicVolume?: number;
  /** Narrate each beat's scriptText instead of silence. */
  voiceover?: boolean;
  /** Narration volume, 0–1 (default 1.0). */
  voiceoverVolume?: number;
  /** Which TTS engine (default "kokoro", in-browser). */

  ttsEngine?: TtsEngine;
  /** Kokoro voice to narrate with (default af_heart). */
  voice?: Voice;
  /** ElevenLabs voice id (when ttsEngine === "elevenlabs"). */
  elevenVoiceId?: string;
  /** ElevenLabs model id (e.g. eleven_flash_v2_5, eleven_v3). */
  elevenModel?: string;
  /** ElevenLabs voice stability 0..1. */
  elevenStability?: number;
  /** ElevenLabs style exaggeration 0..1. */
  elevenStyle?: number;
  /** Narration speed, 0.7 (slow) .. 1.2 (fast); 1 = natural (default 1). */
  voiceoverSpeed?: number;
  /** Silent lead-in before each beat's narration begins, in seconds (default 0) —
   *  so the voice eases in instead of starting on the first frame. Only applies
   *  when voiceover is on; timed-caption beats carry their own lead-in via the
   *  caption schedule. */
  voiceoverLeadSec?: number;
  /** Silent tail after each beat's narration ends, in seconds (default 0) —
   *  breathing room so beats don't cut wall-to-wall. Only applies when voiceover
   *  is on. */
  voiceoverGapSec?: number;
  /** Optional styled title burned over the whole video (cut-level, intro/entire). */
  title?: TitleOverlay | null;
  /** Per-beat title layers, keyed by beat id. Each beat's layers composite only
   *  during that beat's segment (scope "intro" = first N sec of the beat). */
  beatTitles?: Record<string, TitleLayer[]>;
  /** Caption font-size multiplier (1 = default ~4.5% of frame height). */
  captionScale?: number;
  /** Caption underlay (background box) opacity, 0–1 (default 0.5). */
  captionBgOpacity?: number;
  /** Caption line height as a multiple of font size (default 1.6 = boxes flush,
   *  no gap. Below ~1.6 the per-line boxes overlap; above it they gap apart). */
  captionLineHeight?: number;
}

// Build the ffmpeg overlay graph for stacked title layers. Each layer is
// rendered to a full-frame transparent PNG by the SHARED canvas renderer
// (titleCanvas.ts, ADR-0008) — the SAME engine the preview draws with — then
// composited with `overlay`. drawtext is gone: it had no letter-spacing,
// different shaping, and a guessed wrap. Motion (fade/slide) rides on top of the
// static bitmap via the looped image's own timeline + overlay x/y expressions,


/** The actual on-screen window an exported beat used (voiceover can change it). */
export interface BeatTiming {
  id: string;
  inSec: number;
  outSec: number;
  durationSec: number;
}

export interface ExportResult {
  blob: Blob;
  /** Real per-beat timings; differ from the word-count estimate when voiceover is on. */
  timings: BeatTiming[];
}

export function canvasDims(aspect: Aspect): [number, number] {
  if (aspect === "9:16") return [1080, 1920];
  if (aspect === "1:1") return [1080, 1080];
  return [1920, 1080];
}

/** What the Clip is called inside the engine's virtual FS. */
export function sourceName(clip: Pick<Clip, "name" | "kind"> & Partial<Pick<Clip, "normalized">>): string {
  const ext = clip.name.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? "mp4";
  // `kind` is read BEFORE `normalized` on purpose: importing a .vidstr used to
  // set `normalized` on every clip, and a Still handed to ffmpeg as `in.mp4`
  // gives it an mp4 demuxer for a JPEG.
  if (clip.kind === "still") return `in.${ext}`;
  if (clip.normalized) return "in.mp4";
  return `in.${ext}`;
}

/**
 * The Beat's own input stage. A Still has no timeline to seek into, so it is
 * looped for the segment's length the way captions, Title overlays and Stickers
 * already are (ADR-0012); footage is seek-and-trim as before. Everything
 * downstream reads `[0:v]` either way.
 */
export function beatInputArgs(
  clip: Pick<Clip, "name" | "kind"> & Partial<Pick<Clip, "normalized">>,
  inSec: number,
  footageLen: number,
  /** Overrides the derived name — a Ken Burns Still is pre-rendered to JPEG
   *  regardless of what the original file was called (ADR-0015). */
  nameOverride?: string,
): string[] {
  const name = nameOverride ?? sourceName(clip);
  if (clip.kind === "still") {
    return ["-loop", "1", "-t", String(footageLen), "-r", "30", "-i", name];
  }
  return ["-ss", String(inSec), "-t", String(footageLen), "-i", name];
}

/**
 * Where a Beat segment's audio comes from. A Still has no audio stream at all,
 * so mapping `[0:a]` would fail the whole segment however loud the Beat is set.
 */
export function beatAudioStrategy(clip: Pick<Clip, "kind">, beatVolume: number): "source" | "silent" {
  if (clip.kind === "still") return "silent";
  return beatVolume > 0 ? "source" : "silent";
}

export interface SplitScreenAudioInput {
  inputIdx: number;
  volume: number;
}

export function splitScreenAudioPlan(
  config: SplitScreenConfig,
  beat: Pick<Beat, "volume" | "muted">,
  cut: Pick<Cut, "beatAudioMasterVolume" | "beatAudioMuted">,
  clips: readonly Pick<Clip, "id" | "kind">[],
): SplitScreenAudioInput[] {
  return config.slots.flatMap((slot, inputIdx) => {
    const slotClip = clips.find((candidate) => candidate.id === slot.clipId);
    const volume = effectiveSplitScreenSlotVolume(slot, inputIdx, beat, cut);
    return slotClip?.kind === "still" || volume <= 0
      ? []
      : [{ inputIdx, volume }];
  });
}

export function splitScreenAudioFallbackPlans(
  inputs: readonly SplitScreenAudioInput[],
): SplitScreenAudioInput[][] {
  const plans: SplitScreenAudioInput[][] = [];
  const collect = (start: number, remaining: number, current: SplitScreenAudioInput[]) => {
    if (remaining === 0) {
      plans.push(current);
      return;
    }
    for (let index = start; index <= inputs.length - remaining; index++) {
      collect(index + 1, remaining - 1, [...current, inputs[index]]);
    }
  };
  for (let size = inputs.length; size >= 1; size--) collect(0, size, []);
  return plans;
}

async function bytesOf(src: Blob): Promise<Uint8Array> {
  return new Uint8Array(await src.arrayBuffer());
}

// drawtext does not wrap, so a caption wider than the frame gets clipped on both
// ends (worst in 9:16). Greedily word-wrap to lines that fit the canvas width;
// drawtext renders the literal newlines as separate lines and text_h/box grow to
// match, so bottom-alignment (y=h-th-margin) still holds.
export function wrapCaption(text: string, canvasW: number, fontsize: number): string {
  // ~0.5·fontsize average glyph width for the bold caption font; keep a 10% margin.
  const maxChars = Math.max(8, Math.floor((canvasW * 0.9) / (fontsize * 0.5)));
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (!line) line = word;
    else if (line.length + 1 + word.length <= maxChars) line += " " + word;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

// Captions are now rendered by the SHARED canvas renderer (captionCanvas.ts,
// ADR-0008): one full-frame PNG per cue, composited with ffmpeg `overlay` and
// time-gated with `enable`. This matches the preview exactly (same font,
// wrapping, box, placement) — drawtext could not.

// Render at most N beat segments at once. Export segments are already-normalized
// 1080p and short (much lighter than a 4K normalize), so 2 is comfortable, 3 on
// high-RAM machines, 1 on very low-RAM. Each runs in its own isolated engine.
export function exportConcurrency(): number {
  if (multithreadReady()) return 1;
  const nav = typeof navigator !== "undefined" ? (navigator as { deviceMemory?: number; hardwareConcurrency?: number }) : undefined;
  const mem = nav?.deviceMemory;
  const cores = nav?.hardwareConcurrency;
  if (typeof mem === "number" && mem <= 4) return 1;
  if (typeof mem === "number" && mem >= 8 && typeof cores === "number" && cores >= 12) return 4;
  if ((typeof mem !== "number" || mem >= 8) && typeof cores === "number" && cores >= 8) return 3;
  if (typeof cores === "number" && cores >= 4) return 2;
  return 1;
}

export function emptyTemplateSlotExportError(cut: Cut, clips: Clip[]): string | null {
  const clipById = new Map(clips.map((clip) => [clip.id, clip]));
  const count = cut.beats.filter(
    (beat) => clipById.get(beat.clipId)?.isTemplatePlaceholder,
  ).length;
  if (count === 0) return null;
  return `Fill all empty template slots before exporting (${count} ${count === 1 ? "slot" : "slots"} remaining).`;
}

const FIRST_PASS_FADE_TRANSITIONS = new Set<VideoTransitionType>([
  "fade",
  "fadeblack",
  "fadewhite",
]);

/** True when every transition can be rendered on its own fully-composited Beat. */
export function canBakeTransitionsInFirstPass(beats: Beat[]): boolean {
  return beats.every((beat) =>
    !beat.transition
    || beat.transition === "none"
    || FIRST_PASS_FADE_TRANSITIONS.has(beat.transition),
  );
}

function transitionColor(transition: VideoTransitionType): "black" | "white" {
  return transition === "fadewhite" ? "white" : "black";
}

/** Fade filters applied after all Layers, so blend Overlays fade with the frame. */
export function firstPassTransitionFilters(beats: Beat[], index: number, segDur: number): string[] {
  const beat = beats[index];
  if (!beat || !canBakeTransitionsInFirstPass(beats)) return [];
  const previous = index > 0 ? beats[index - 1] : undefined;
  const next = beats[index + 1];

  const incoming = beat.transition && beat.transition !== "none" && (beat.transitionPosition ?? "start") === "start"
    ? beat
    : previous?.transition && previous.transition !== "none" && previous.transitionPosition === "end"
      ? previous
      : undefined;
  const outgoing = next?.transition && next.transition !== "none" && (next.transitionPosition ?? "start") === "start"
    ? next
    : beat.transition && beat.transition !== "none" && beat.transitionPosition === "end"
      ? beat
      : undefined;

  const filters: string[] = [];
  if (incoming?.transition && FIRST_PASS_FADE_TRANSITIONS.has(incoming.transition)) {
    const duration = Math.min(segDur, Math.max(0.1, incoming.transitionSec ?? 0.5));
    filters.push(`fade=t=in:st=0:d=${duration.toFixed(2)}:color=${transitionColor(incoming.transition)}`);
  }
  if (outgoing?.transition && FIRST_PASS_FADE_TRANSITIONS.has(outgoing.transition)) {
    const duration = Math.min(segDur, Math.max(0.1, outgoing.transitionSec ?? 0.5));
    const start = Math.max(0, segDur - duration);
    filters.push(`fade=t=out:st=${start.toFixed(3)}:d=${duration.toFixed(2)}:color=${transitionColor(outgoing.transition)}`);
  }
  return filters;
}

export async function exportCut(
  cut: Cut,
  clips: Clip[],
  opts: ExportOptions,
  onProgress?: (fraction: number, statusText?: string) => void,
): Promise<ExportResult> {
  const preflightError = emptyTemplateSlotExportError(cut, clips);
  if (preflightError) throw new Error(preflightError);

  onProgress?.(0.01, "Initializing export pipeline…");
  const clipById = new Map(clips.map((c) => [c.id, c]));
  const [w, h] = canvasDims(cut.aspect);
  const fontsize = Math.round(Math.max(24, h * 0.045) * (opts.captionScale ?? 1));
  const bgOpacity = Math.min(1, Math.max(0, opts.captionBgOpacity ?? 0.5));
  const lineHeight = opts.captionLineHeight ?? 1.6;
  const margin = Math.round(h * 0.07);

  const qualityKey = opts.exportQuality ?? EDITOR_DEFAULTS.DEFAULT_EXPORT_QUALITY;
  const profile = EDITOR_DEFAULTS.EXPORT_QUALITY_PROFILES[qualityKey] ?? EDITOR_DEFAULTS.EXPORT_QUALITY_PROFILES.high;
  const { preset, crf, audioBitrate } = profile;

  onProgress?.(0.03, "Preparing title overlays…");
  interface RenderedTitleLayer {
    layer: TitleLayer;
    png: Uint8Array;
    pngName: string;
    index: number;
    canvasFamily: string;
    cssFamily: string;
  }
  const preRenderedTitleLayers: RenderedTitleLayer[] = [];
  if (opts.title && opts.title.layers) {
    const activeLayers = opts.title.layers.filter((l) => l.enabled && l.text.trim());
    for (let k = 0; k < activeLayers.length; k++) {
      const l = activeLayers[k];
      const fId = l.fontId;
      const fFile = l.fontFile;
      const fontBytes = l.fontBytes ?? (fId ? await getTitleFontBytes(fId, l.weight, fFile) : undefined);
      const cssFamily = l.fontCssFamily ?? (fId ? findFontById(fId)?.cssFamily : undefined) ?? "sans-serif";
      const fontKey = titleFontKey(cssFamily, l.weight ?? 400, fontBytes?.length);
      const canvasFamily = await ensureTitleFontFace(fontKey, fontBytes, cssFamily);
      const png = await renderTitleLayerToPng(
        {
          text: l.text,
          canvasFamily,
          cssFamily,
          fontBytes,
          fontWeight: l.weight ?? 400,
          sizePx: l.sizePx,
          letterSpacing: l.letterSpacing,
          arcDeg: l.arcDeg,
          shadow: l.shadow,
          color: l.color,
          posX: l.posX,
          posY: l.posY,
          boxWidthPct: l.boxWidthPct,
          lineHeight: l.lineHeight,
          maskMode: l.maskMode,
          maskColor: l.maskColor,
        },
        w,
        h,
      );
      if (png) {
        preRenderedTitleLayers.push({ layer: { ...l, fontBytes, fontCssFamily: cssFamily }, png, pngName: `title_${k}.png`, index: k, canvasFamily, cssFamily });
      }
    }
  }

  // Pre-render each beat's OWN title layers (parallel to the cut-level title).
  // These composite only within their own beat segment, timed segment-locally.
  const perBeatTitles = new Map<string, RenderedTitleLayer[]>();
  for (const beat of cut.beats) {
    const layers = opts.beatTitles?.[beat.id] ?? beat.titleLayers;
    if (!layers) continue;
    const activeLayers = layers.filter((l) => l.enabled && l.text.trim());
    const rendered: RenderedTitleLayer[] = [];
    for (let k = 0; k < activeLayers.length; k++) {
      const l = activeLayers[k];
      const fBytes = "fontBytes" in l ? l.fontBytes : undefined;
      const fFamily = "fontCssFamily" in l ? l.fontCssFamily : undefined;
      const fFile = "fontFile" in l ? l.fontFile : undefined;
      const fId = l.fontId;
      const fontBytes = fBytes ?? (fId ? await getTitleFontBytes(fId, l.weight, fFile) : undefined);
      const cssFamily = fFamily ?? (fId ? findFontById(fId)?.cssFamily : undefined) ?? "sans-serif";
      const fontKey = titleFontKey(cssFamily, l.weight ?? 400, fontBytes?.length);
      const canvasFamily = await ensureTitleFontFace(fontKey, fontBytes, cssFamily);
      const png = await renderTitleLayerToPng(
        {
          text: l.text,
          canvasFamily,
          cssFamily,
          fontBytes,
          fontWeight: l.weight ?? 400,
          sizePx: l.sizePx,
          letterSpacing: l.letterSpacing,
          arcDeg: l.arcDeg,
          shadow: l.shadow,
          color: l.color,
          posX: l.posX,
          posY: l.posY,
          boxWidthPct: l.boxWidthPct,
          lineHeight: l.lineHeight,
          maskMode: l.maskMode,
          maskColor: l.maskColor,
        },
        w,
        h,
      );
      if (png) rendered.push({ layer: { ...l, fontBytes, fontCssFamily: cssFamily }, png, pngName: `btitle_${beat.id}_${k}.png`, index: k, canvasFamily, cssFamily });
    }
    if (rendered.length) perBeatTitles.set(beat.id, rendered);
  }

  // Pre-render resolved stickers (ADR-0011). Each sticker asset is rendered ONCE to a PNG
  // buffer and reused across all beat segments it overlaps (avoiding re-rendering 2D canvas per beat).
  interface PreRenderedSticker {
    st: Sticker;
    png: Uint8Array;
    pngName: string;
  }
  const preRenderedStickers: PreRenderedSticker[] = [];
  const resolvedStickers = resolveStickers(cut.stickers, beatSpans(cut.beats));
  for (let k = 0; k < resolvedStickers.length; k++) {
    const st = resolvedStickers[k];
    const png = await renderStickersToPng([st], w, h);
    if (png) {
      preRenderedStickers.push({ st, png, pngName: `sticker_${k}.png` });
    }
  }

  // Pre-render Ken Burns pre-scaled JPEG buffers once per still clip to eliminate canvas stalls during workers
  const kenBurnsStills = new Map<string, Uint8Array>();
  for (const b of cut.beats) {
    const clip = clipById.get(b.clipId);
    if (clip && clip.kind === "still" && b.framing === "kenBurns" && b.kenBurns && !kenBurnsStills.has(clip.id)) {
      try {
        const ps = kenBurnsPreScale(w, h, clip.width, clip.height);
        const data = await renderStillContained(clip.file, ps.w, ps.h);
        kenBurnsStills.set(clip.id, data);
      } catch (err) {
        console.warn(`Failed to pre-render Ken Burns still for clip ${clip.id}`, err);
      }
    }
  }

  // Pre-trim active B-roll overlays concurrently before segment rendering
  const activeOverlays = (cut.overlays ?? []).filter((o) => clips.some((c) => c.id === o.clipId));

  interface PreTrimmedOverlay {
    data: Uint8Array<ArrayBuffer>;
    o: OverlayClip;
  }
  const preTrimmedOverlays: PreTrimmedOverlay[] = [];
  if (activeOverlays.length > 0) {
    onProgress?.(0.05, "Preparing B-roll overlays…");
    let trimProgress = 0;
    await runPool(activeOverlays, exportConcurrency(), async (o, idx) => {
      const clip = clips.find((c) => c.id === o.clipId);
      if (!clip) return;
      try {
        const srcData = await bytesOf(clip.normalized ?? clip.file);
        const srcName = sourceName(clip);
        const out = await runIsolated(
          [{ name: srcName, data: srcData }],
          ["-ss", o.inSec.toFixed(3), "-t", o.durationSec.toFixed(3), "-i", srcName,
           "-c:v", "libx264", "-preset", "ultrafast", "-crf", String(crf), "-pix_fmt", "yuv420p",
           "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "ov.mp4"],
          "ov.mp4",
        );
        trimProgress++;
        onProgress?.(0.05 + (trimProgress / activeOverlays.length) * 0.05, `Preparing B-roll overlay ${trimProgress} of ${activeOverlays.length}…`);
        preTrimmedOverlays.push({ data: out, o });
      } catch (err) {
        console.warn(`Overlay ${idx} pre-trim failed; skipping overlay.`, err);
        trimProgress++;
        onProgress?.(0.05 + (trimProgress / activeOverlays.length) * 0.05, `Preparing B-roll overlay ${trimProgress} of ${activeOverlays.length}…`);
      }
    });
  }

  // Load source bytes inside the active render worker instead of retaining every
  // Clip in one global cache. With 25 normalized Clips the eager cache could hold
  // gigabytes, then duplicate another source into FFmpeg/WASM before rendering
  // even began. The worker pool now bounds source-byte memory along with engines.
  const getClipBytes = (c: Clip): Promise<Uint8Array> => bytesOf(c.normalized ?? c.file);

  interface PrecomputedBeat {
    clip: Clip;
    inSec: number;
    footageLen: number;
    segDur: number;
  }

  const preBeats: (PrecomputedBeat | null)[] = cut.beats.map((b) => {
    const clip = clipById.get(b.clipId);
    if (!clip) return null;
    const clipDur = clip.durationSec || b.outSec - b.inSec;
    const inSec = Math.min(Math.max(0, b.inSec), Math.max(0, clipDur - 0.1));
    const targetDur = Math.max(0.1, b.outSec - b.inSec);
    const maxAvailable = Math.max(0.1, clipDur - inSec);
    const footageLen = clip.kind === "still" ? targetDur : Math.min(targetDur, maxAvailable);
    return { clip, inSec, footageLen, segDur: targetDur };
  });

  const beatStartSecs: number[] = new Array(cut.beats.length).fill(0);
  let currentTimelineOffset = 0;
  for (let i = 0; i < cut.beats.length; i++) {
    beatStartSecs[i] = currentTimelineOffset;
    const pre = preBeats[i];
    if (pre) currentTimelineOffset += pre.segDur;
  }
  const totalDurationSec = Math.max(0.1, currentTimelineOffset);

  const n = cut.beats.length;
  const segSlots: (Uint8Array | null)[] = new Array(n).fill(null);
  const timingSlots: (BeatTiming | null)[] = new Array(n).fill(null);
  const prog = new Array<number>(n).fill(0);
  let completedBeats = 0;
  let reusedBeatSegments = 0;

  const reportBeatProg = () => {
    const frac = (prog.reduce((a, x) => a + x, 0) / Math.max(1, n)) * 0.65 + 0.15;
    const displayNum = Math.min(n, completedBeats + 1);
    onProgress?.(frac, `Rendering beat segment ${displayNum} of ${n}…`);
  };
  const reportBeatStage = (i: number, text: string) => {
    const frac = (prog.reduce((a, x) => a + x, 0) / Math.max(1, n)) * 0.65 + 0.15;
    onProgress?.(frac, `${text} ${i + 1} of ${n}…`);
  };

  // Move the visible stage forward before the first FFmpeg core/worker loads.
  // Engine startup can take time and does not emit ffmpeg progress events.
  reportBeatProg();
  // React state updates and browser painting need a macrotask boundary before
  // canvas preparation and WASM startup begin monopolising the main thread.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await runPool(cut.beats, exportConcurrency(), async (b, i) => {
    const pre = preBeats[i];
    if (!pre) {
      prog[i] = 1;
      completedBeats++;
      reportBeatProg();
      return;
    }
    const { clip, inSec, footageLen, segDur } = pre;
    const bStart = beatStartSecs[i];
    const bEnd = bStart + segDur;
    reportBeatStage(i, "Loading source for beat");

    // Ken Burns is a Still's moving framing (ADR-0015). Its source is
    // pre-scaled ONCE here, on the GPU, rather than by a `scale` in the filter
    // chain — the spike measured that as slower than no pre-scale at all,
    // because -loop 1 made ffmpeg re-scale the same picture 300 times.
    const isKenBurns = b.framing === "kenBurns" && !!b.kenBurns;
    let data: Uint8Array;
    let srcName = sourceName(clip);
    if (isKenBurns && clip.kind === "still") {
      const cached = kenBurnsStills.get(clip.id);
      if (cached) {
        data = cached;
      } else {
        const ps = kenBurnsPreScale(w, h, clip.width, clip.height);
        data = await renderStillContained(clip.file, ps.w, ps.h);
      }
      srcName = "in.jpg";
    } else {
      data = await getClipBytes(clip);
    }

    const isSplitScreen = !!(b.splitScreen && b.splitScreen.layout !== "none" && b.splitScreen.slots.length > 1);
    const normSplitCfg = isSplitScreen ? normalizeSplitConfig(b.splitScreen, clip.id, inSec) : null;
    const splitAudioInputs = normSplitCfg
      ? splitScreenAudioPlan(normSplitCfg, b, cut, clips)
      : [];

    const inputs: EngineInput[] = [];

    if (isSplitScreen && normSplitCfg) {
      for (let sIdx = 0; sIdx < normSplitCfg.slots.length; sIdx++) {
        const slot = normSplitCfg.slots[sIdx];
        const slotClip = clips.find((c: Clip) => c.id === slot.clipId) ?? clip;
        const slotData = await getClipBytes(slotClip);
        inputs.push({ name: `slot_${sIdx}_${sourceName(slotClip)}`, data: slotData });
      }
    } else {
      inputs.push({ name: srcName, data });
    }
    const numVideoInputs = inputs.length;


    // Captions (Task 3: now collected as CaptionLayerSpec[], compositing handled
    // by buildSegmentGraph inside buildVideoChains below).
    const captionLayers: CaptionLayerSpec[] = [];
    const addCaption = async (text: string, enable: string) => {
      if (!text.trim()) return;
      const png = await renderCaptionToPng({ text, fontSizePx: fontsize, bgOpacity, lineHeight, marginPx: margin }, w, h);
      if (png) {
        const k = captionLayers.length;
        inputs.push({ name: `cap_${k}.png`, data: png });
        captionLayers.push({ kind: "caption", pngName: `cap_${k}.png`, png, enable });
      }
    };

    // Stickers (ADR-0011). Each Sticker overlapping this Beat's window is drawn by
    // the SHARED renderer to a full-frame transparent PNG — the same bitmap the
    // preview shows — and composited with its own segment-local `enable` window,
    // the treatment B-roll Overlays already get. One PNG per Sticker rather than
    // one for all of them, because their windows differ.
    // (Task 2: Stickers are now managed by buildSegmentGraph — see below.)
    const stickerLayers: StickerLayerSpec[] = [];
    for (const rs of preRenderedStickers) {
      const win = stickerWindowInSegment(rs.st, bStart, segDur);
      if (!win) continue;
      inputs.push({ name: rs.pngName, data: rs.png });
      stickerLayers.push({
        kind: "sticker",
        pngName: rs.pngName,
        png: rs.png,
        enable: `between(t,${win.startSec.toFixed(3)},${win.endSec.toFixed(3)})`,
      });
    }


    // Frame geometry — punch-in zoom and fine rotation as one scale/rotate/crop.
    // "entire" scope folds straight into the base chain; "intro" scope must be
    // time-gated, so the zoomed frame is composited over the base with an
    // `enable` window (below) rather than baked into vf. The rotation always
    // lives in the base, so it outlives the intro window.
    // A Ken Burns Beat has no Zoom — they are a mode, not a stack (ADR-0015) —
    // so the zoom fields are withheld from the geometry builder and only the
    // rotation survives into the base chain.
    const kbMove = isKenBurns ? b.kenBurns! : null;
    const frame = beatFrameFilters(w, h, kbMove ? { rotation: b.rotation } : b);
    const zoomFilters = frame.introZoom ?? [];
    const zoomIntro = zoomFilters.length > 0;

    // The Grade rides in as a baked 3D LUT written to the engine FS, not as a
    // filter chain — one generator drives it and the preview both (ADR-0010).
    const colorLut = ffmpegColorLut(
      "grade.cube", b.colorAdjustments, cut.globalFilterId, cut.globalFilterIntensity, cut.globalFilterAdjustments,
    );
    if (colorLut) inputs.push(colorLut.input);

    const speedRatio = segDur / Math.max(0.05, footageLen);
    const needTimeStretch = clip.kind === "video" && speedRatio > 1.005;

    const vf = [
      "setpts=PTS-STARTPTS",
      ...(needTimeStretch
        ? (speedRatio <= 2.5
            ? [`setpts=${speedRatio.toFixed(4)}*PTS`]
            : [`loop=loop=-1:size=${Math.max(1, Math.round(footageLen * 30))}:start=0`])
        : []),
      ...(kbMove
        ? [
            ...kenBurnsChain(w, h, kbMove, segDur),
            `trim=duration=${segDur.toFixed(3)}`,
            "setpts=PTS-STARTPTS",
          ]
        : [
            `scale=${w}:${h}:force_original_aspect_ratio=decrease`,
            `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`,
          ]),
      "setsar=1",
      ...frame.base,
      ...(colorLut ? [colorLut.filter] : []),
    ];

    const freeze = Math.max(0, segDur - (needTimeStretch ? segDur : footageLen));
    if (freeze > 0.01) vf.push(`tpad=stop_duration=${freeze.toFixed(3)}:stop_mode=clone`);

    // VO-track captions: burn each visible segment that overlaps this beat's window
    // [bStart, bEnd], gated to the overlap in segment-local time. A caption spanning a
    // beat boundary is drawn in each segment it touches.
    for (const window of exportedCaptionWindows(cut.voSegments, bStart, segDur)) {
      await addCaption(window.text, `between(t,${window.startSec.toFixed(3)},${window.endSec.toFixed(3)})`);
    }

    timingSlots[i] = { id: b.id, inSec, outSec: inSec + footageLen, durationSec: segDur };

    const beatVol = effectiveBeatVolume(b, cut);
    // Beat audio is just the (optionally muted) source clip now; narration is the
    // master VO bed mixed in at the final stage.
    const strategy: "source" | "silent" = isSplitScreen
      ? (splitAudioInputs.length > 0 ? "source" : "silent")
      : beatAudioStrategy(clip, beatVol);

    const segDurStr = segDur.toFixed(3);

    // Titles (Task 4: now collected as TitleLayerSpec[], compositing handled
    // by buildSegmentGraph inside buildVideoChains below).
    const titleLayers: TitleLayerSpec[] = [];

    const addTypewriterTitleSpecs = async (
      layer: TitleLayer,
      canvasFamily: string,
      cssFamily: string,
      segmentStartSec: number,
      segDur: number,
      windowStartSec: number,
      windowEndSec: number,
      prefix: string,
    ) => {
      const text = layer.text;
      const totalChars = text.length;
      if (totalChars === 0) return;

      const animDur = layer.animDurationSec ?? 0.5;
      const stepDur = animDur / totalChars;

      for (let s = 1; s <= totalChars; s++) {
        const progress = s / totalChars;
        const stepStartRel = windowStartSec + (s - 1) * stepDur;
        const stepEndRel = s === totalChars
          ? windowEndSec
          : Math.min(windowEndSec, windowStartSec + s * stepDur);

        if (segmentStartSec < stepEndRel && segmentStartSec + segDur > stepStartRel) {
          const segStepStart = Math.max(0, stepStartRel - segmentStartSec);
          const segStepEnd = Math.min(segDur, stepEndRel - segmentStartSec);

          if (segStepEnd > segStepStart + 0.001) {
            const png = await renderTitleLayerToPng(
              {
                text: layer.text,
                canvasFamily,
                cssFamily,
                fontBytes: layer.fontBytes,
                fontWeight: layer.weight ?? 700,
                sizePx: layer.sizePx,
                letterSpacing: layer.letterSpacing,
                arcDeg: layer.arcDeg,
                shadow: layer.shadow,
                color: layer.color,
                posX: layer.posX,
                posY: layer.posY,
                boxWidthPct: layer.boxWidthPct,
                lineHeight: layer.lineHeight,
                typewriterProgress: progress,
                showCursor: layer.typewriterCursor !== false,
                maskMode: layer.maskMode,
                maskColor: layer.maskColor,
              },
              w,
              h,
              progress,
            );
            if (png) {
              const tName = `${prefix}_tw_${s}.png`;
              inputs.push({ name: tName, data: png });
              const enable = `:enable='between(t,${segStepStart.toFixed(3)},${segStepEnd.toFixed(3)})'`;
              titleLayers.push({
                kind: "title",
                maskMode: layer.maskMode,
                pngName: tName,
                png,
                fadeParts: [],
                xExpr: "0",
                yExpr: "0",
                enable,
              });
            }
          }
        }
      }
    };

    for (let k = 0; k < preRenderedTitleLayers.length; k++) {
      const rtl = preRenderedTitleLayers[k];
      const l = rtl.layer;
      const window = titleWindow(l, totalDurationSec);
      const overlap = bStart < window.endSec && bStart + segDur > window.startSec;
      if (!overlap) continue;

      const anim = l.animation ?? "none";
      if (anim === "typewriter") {
        await addTypewriterTitleSpecs(
          l,
          rtl.canvasFamily,
          rtl.cssFamily,
          bStart,
          segDur,
          window.startSec,
          window.endSec,
          `title_${k}`,
        );
        continue;
      }

      const tName = `title_seg_${k}.png`;
      inputs.push({ name: tName, data: rtl.png });

      const animDur = l.animDurationSec ?? 0.5;

      const fadeParts: string[] = [];
      const animEnd = window.startSec + animDur;
      if (anim !== "none" && bStart < animEnd && bEnd > window.startSec) {
        const stIn = Math.max(0, window.startSec - bStart);
        const dIn = Math.min(animEnd, bEnd) - Math.max(window.startSec, bStart);
        if (dIn > 0) fadeParts.push(`fade=t=in:st=${stIn.toFixed(3)}:d=${dIn.toFixed(3)}:alpha=1`);
      }
      if (l.scope !== "entire" && l.fadeOut !== false) {
        const windowDur = window.endSec - window.startSec;
        const fadeDur = Math.min(0.8, windowDur / 2);
        const fadeStart = Math.max(window.startSec, window.endSec - fadeDur);
        if (bEnd > fadeStart && bStart < window.endSec) {
          const stOut = Math.max(0, fadeStart - bStart);
          const dOut = Math.min(fadeDur, window.endSec - Math.max(bStart, fadeStart));
          if (dOut > 0) fadeParts.push(`fade=t=out:st=${stOut.toFixed(3)}:d=${dOut.toFixed(3)}:alpha=1`);
        }
      }

      const dStr = animDur.toFixed(3);
      const bStartStr = bStart.toFixed(3);
      const windowStartStr = window.startSec.toFixed(3);
      const tExpr = `(t+${bStartStr}-${windowStartStr})`;

      let xExpr = "0";
      let yExpr = "0";
      if (l.maskMode !== "video" && bStart < animEnd && bEnd > window.startSec) {
        if (anim === "slide_left") {
          xExpr = `if(lt(${tExpr},${dStr}),(1-${tExpr}/${dStr})*${(-w * TITLE_ANIM.slideXFrac).toFixed(1)},0)`;
        } else if (anim === "slide_bottom") {
          yExpr = `if(lt(${tExpr},${dStr}),(1-${tExpr}/${dStr})*${(h * TITLE_ANIM.slideYFrac).toFixed(1)},0)`;
        } else if (anim === "slide_top") {
          yExpr = `if(lt(${tExpr},${dStr}),(1-${tExpr}/${dStr})*${(-h * TITLE_ANIM.slideYFrac).toFixed(1)},0)`;
        }
      }

      const enExpr = `between(t+${bStartStr},${window.startSec.toFixed(3)},${window.endSec.toFixed(3)})`;
      const enable = l.scope !== "entire" ? `:enable='${enExpr}'` : "";

      titleLayers.push({ kind: "title", maskMode: l.maskMode, pngName: tName, png: rtl.png, fadeParts, xExpr, yExpr, enable });
    }

    // Per-beat titles: same compositing pipeline, but timed segment-locally
    // (this title lives entirely within its own beat, so bStart is effectively 0
    // and "entire" scope spans the whole segment). Appended after the cut-level
    // titles so the input indexing (1 + capCount + k) stays consistent.
    const beatRendered = perBeatTitles.get(b.id) ?? [];
    for (let j = 0; j < beatRendered.length; j++) {
      const rtl = beatRendered[j];
      const l = rtl.layer;
      const window = titleWindow(l, segDur);
      if (window.endSec <= window.startSec) continue;

      const anim = l.animation ?? "none";
      if (anim === "typewriter") {
        await addTypewriterTitleSpecs(
          l,
          rtl.canvasFamily,
          rtl.cssFamily,
          0,
          segDur,
          window.startSec,
          window.endSec,
          `btitle_${b.id}_${j}`,
        );
        continue;
      }

      const tName = rtl.pngName;
      inputs.push({ name: tName, data: rtl.png });

      const animDur = l.animDurationSec ?? 0.5;

      const fadeParts: string[] = [];
      if (anim !== "none") {
        const dIn = Math.min(animDur, window.endSec - window.startSec);
        if (dIn > 0) fadeParts.push(`fade=t=in:st=${window.startSec.toFixed(3)}:d=${dIn.toFixed(3)}:alpha=1`);
      }
      if (l.scope !== "entire" && l.fadeOut !== false) {
        const windowDur = window.endSec - window.startSec;
        const fadeDur = Math.min(0.8, windowDur / 2);
        const fadeStart = Math.max(window.startSec, window.endSec - fadeDur);
        if (segDur > fadeStart) {
          const dOut = Math.min(fadeDur, window.endSec - fadeStart);
          if (dOut > 0) fadeParts.push(`fade=t=out:st=${fadeStart.toFixed(3)}:d=${dOut.toFixed(3)}:alpha=1`);
        }
      }

      const dStr = animDur.toFixed(3);
      const titleTimeExpr = `(t-${window.startSec.toFixed(3)})`;
      let xExpr = "0";
      let yExpr = "0";
      if (l.maskMode !== "video") {
        if (anim === "slide_left") {
          xExpr = `if(lt(${titleTimeExpr},${dStr}),(1-${titleTimeExpr}/${dStr})*${(-w * TITLE_ANIM.slideXFrac).toFixed(1)},0)`;
        } else if (anim === "slide_bottom") {
          yExpr = `if(lt(${titleTimeExpr},${dStr}),(1-${titleTimeExpr}/${dStr})*${(h * TITLE_ANIM.slideYFrac).toFixed(1)},0)`;
        } else if (anim === "slide_top") {
          yExpr = `if(lt(${titleTimeExpr},${dStr}),(1-${titleTimeExpr}/${dStr})*${(-h * TITLE_ANIM.slideYFrac).toFixed(1)},0)`;
        }
      }

      const enable = l.scope !== "entire"
        ? `:enable='between(t,${window.startSec.toFixed(3)},${window.endSec.toFixed(3)})'`
        : "";

      titleLayers.push({ kind: "title", maskMode: l.maskMode, pngName: tName, png: rtl.png, fadeParts, xExpr, yExpr, enable });
    }

    // Check which pre-trimmed B-roll overlays overlap this beat segment's window [bStart, bEnd]
    const overlayLayers: OverlayLayerSpec[] = [];

    preTrimmedOverlays.forEach(({ data: ovData, o }) => {
      const oStart = o.startTimeSec;
      const oEnd = oStart + o.durationSec;
      if (oStart < bEnd && oEnd > bStart) {
        const stLocal = Math.max(0, oStart - bStart);
        const durLocal = Math.min(oEnd, bEnd) - Math.max(oStart, bStart);
        const ovIdx = overlayLayers.length;
        const ovName = `ov_seg_${ovIdx}.mp4`;
        inputs.push({ name: ovName, data: ovData });
        overlayLayers.push({
          kind: "overlay",
          mp4Name: ovName,
          mp4: ovData,
          overlayClip: o,
          stLocalSec: stLocal,
          durLocalSec: durLocal,
          bStart,
          segDur,
          w,
          h,
        });
      }
    });



    const maskTitleLayers = titleLayers.filter((layer) => layer.maskMode === "video");
    const regularTitleLayers = titleLayers.filter((layer) => layer.maskMode !== "video");
    const allLayers: LayerSpec[] = [
      ...overlayLayers,
      ...stickerLayers,
      ...maskTitleLayers,
      ...regularTitleLayers,
      ...captionLayers,
    ];
    const transitionFilters = firstPassTransitionFilters(cut.beats, i, segDur);

    const audioIdx = numVideoInputs + allLayers.length;

    const needsPostCompositeTransition = transitionFilters.length > 0;
    const baseLabel = allLayers.length === 0
      ? (needsPostCompositeTransition ? "[vpretransition]" : "[v]")
      : "[vbase]";
    let chains: string[] = [];

    if (isSplitScreen && normSplitCfg) {
      const splitRes = buildSplitScreenFilterGraph(normSplitCfg, w, h, 0);
      chains = [
        splitRes.filterGraph,
        `${splitRes.outputLabel}${vf.join(",")}${baseLabel}`,
      ];
    } else {
      // For "intro" zoom: split the processed base, punch-in one branch, and overlay
      // it back gated to the first `zoomSec` (segment-local t). Outside the window the
      // un-zoomed base shows through. "Entire"/no zoom → the base is a single chain.
      chains = zoomIntro
        ? [
            `[0:v]${vf.join(",")},split=2[vzbase][vzsrc]`,
            `[vzsrc]${zoomFilters.join(",")}[vzoomed]`,
            `[vzbase][vzoomed]overlay=x=0:y=0:eof_action=pass:enable='between(t,0,${(b.zoomSec ?? 3).toFixed(3)})'${baseLabel}`,
          ]
        : [`[0:v]${vf.join(",")}${baseLabel}`];
    }

    const audibleOverlays = overlayLayers
      .map((ol) => ({
        o: ol.overlayClip,
        stLocalSec: ol.stLocalSec,
        inputIdx: numVideoInputs + allLayers.indexOf(ol),
      }))
      .filter(({ o }) => (o.volume ?? 0) > 0);

    const buildSegArgs = (
      strat: "source" | "silent",
      rgbFormat: string | null = null,
      activeSplitAudioInputs: readonly SplitScreenAudioInput[] = splitAudioInputs,
    ): string[] => {
      let audioInputArgs: string[];
      const aChains: string[] = [];

      const sgResult = buildSegmentGraph(allLayers, {
        inputIndexBase: numVideoInputs,
        baseLabel,
        segDurStr,
        rgbFormat,
        terminal: !needsPostCompositeTransition,
      });


      if (strat === "source") {
        audioInputArgs = [];
        if (isSplitScreen) {
          const labels: string[] = [];
          activeSplitAudioInputs.forEach(({ inputIdx, volume }, index) => {
            const label = `[aslot_${index}]`;
            aChains.push(`[${inputIdx}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${volume.toFixed(2)},apad,atrim=0:${segDurStr},asetpts=PTS-STARTPTS${label}`);
            labels.push(label);
          });
          if (labels.length === 1) {
            aChains[0] = aChains[0].replace(labels[0], "[abase]");
          } else {
            aChains.push(`${labels.join("")}amix=inputs=${labels.length}:duration=first:normalize=0[abase]`);
          }
        } else {
          aChains.push(`[0:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${beatVol.toFixed(2)},apad,atrim=0:${segDurStr},asetpts=PTS-STARTPTS[abase]`);
        }
      } else {
        audioInputArgs = ["-f", "lavfi", "-t", segDurStr, "-i", "anullsrc=r=48000:cl=stereo"];
        aChains.push(`[${audioIdx}:a]aformat=sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS[abase]`);
      }

      if (audibleOverlays.length > 0) {
        const mixLabels: string[] = ["[abase]"];
        audibleOverlays.forEach(({ o, inputIdx, stLocalSec }, k) => {
          const vol = (o.volume ?? 0).toFixed(2);
          const delayMs = Math.round(stLocalSec * 1000);
          const lbl = `[ova_${k}]`;
          aChains.push(`[${inputIdx}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${vol},adelay=${delayMs}|${delayMs}${lbl}`);
          mixLabels.push(lbl);
        });
        aChains.push(`${mixLabels.join("")}amix=inputs=${mixLabels.length}:duration=first:normalize=0[a]`);
      } else {
        const baseChainIndex = aChains.findIndex((chain) => chain.includes("[abase]"));
        aChains[baseChainIndex] = aChains[baseChainIndex].replace("[abase]", "[a]");
      }

      const segChains = [...chains, ...sgResult.chains];
      if (needsPostCompositeTransition) {
        segChains.push(`${sgResult.lastLabel}${transitionFilters.join(",")}[v]`);
      }
      const vFilterString = segChains.join(";");
      const aFilterString = aChains.join(";");

      const videoInputArgs: string[] = [];
      if (isSplitScreen && normSplitCfg) {
        normSplitCfg.slots.forEach((s: any, slotIdx: number) => {
          const slotClip = clips.find((c: Clip) => c.id === s.clipId) ?? clip;
          const sName = inputs[slotIdx].name;
          const sInSec = Math.max(0, s.inSec ?? 0);
          videoInputArgs.push(...beatInputArgs(slotClip, sInSec, footageLen, sName));
        });
      } else {

        videoInputArgs.push(...beatInputArgs(clip, inSec, footageLen, srcName));
      }

      const segPreset = isSplitScreen ? "ultrafast" : preset;

      return [
        ...videoInputArgs,
        ...sgResult.inputArgs,
        ...audioInputArgs,
        "-filter_complex", `${vFilterString};${aFilterString}`,
        "-map", "[v]", "-map", "[a]",
        "-shortest",
        "-r", "30", "-c:v", "libx264", "-preset", segPreset, "-crf", String(crf), "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", audioBitrate, "-ar", "48000", "-ac", "2", "seg.mp4",
      ];

    };


    const hasRgbBlend = overlayLayers.some((ol) => {
      const m = ol.overlayClip.blendMode ?? "normal";
      return m === "screen" || m === "multiply" || m === "overlay";
    });

    const renderSeg = async (strat: "source" | "silent") => {
      const handleEngineProgress = (f: number, phase?: EnginePhase) => {
        prog[i] = f;
        if (phase === "loading-mt") reportBeatStage(i, "Initializing accelerated encoder for beat");
        else if (phase === "fallback-st") reportBeatStage(i, "Accelerated encoder unavailable; falling back for beat");
        else if (phase === "loading-st") reportBeatStage(i, "Initializing compatible encoder for beat");
        else reportBeatProg();
      };
      const runCached = async (
        rgbFormat: "gbrp" | null,
        activeSplitAudioInputs: readonly SplitScreenAudioInput[] = splitAudioInputs,
      ) => {
        const args = buildSegArgs(strat, rgbFormat, activeSplitAudioInputs);
        const key = await segmentCacheKey(inputs, args);
        const cached = key ? getCachedSegment(key) : null;
        if (cached) {
          reusedBeatSegments++;
          prog[i] = 1;
          reportBeatStage(i, "Reusing cached render for beat");
          return cached;
        }
        const rendered = await runIsolated(inputs, args, "seg.mp4", handleEngineProgress);
        if (key) cacheSegment(key, rendered);
        return rendered;
      };
      const rgbFormats = hasRgbBlend ? (["gbrp", null] as const) : ([null] as const);
      const audioPlans = strat === "source" && isSplitScreen
        ? splitScreenAudioFallbackPlans(splitAudioInputs)
        : [splitAudioInputs];
      let lastError: unknown;
      for (const activeSplitAudioInputs of audioPlans) {
        for (const rgbFormat of rgbFormats) {
          try {
            return await runCached(rgbFormat, activeSplitAudioInputs);
          } catch (err) {
            lastError = err;
            console.warn(
              `Segment ${i} pass failed (rgbFormat=${rgbFormat}, audioInputs=${activeSplitAudioInputs.map(({ inputIdx }) => inputIdx).join(",") || "none"}), trying fallback...`,
              err,
            );
          }
        }
      }
      throw lastError;
    };

    if (strategy === "source") {
      try {
        segSlots[i] = await renderSeg("source");
      } catch (err) {
        console.warn(`Beat ${b.id}: source clip has no audio track; rendering this beat silent.`, err);
        segSlots[i] = await renderSeg("silent");
      }
    } else {
      segSlots[i] = await renderSeg(strategy);
    }
    prog[i] = 1;
    completedBeats++;
    reportBeatProg();
  });

  onProgress?.(0.80, reusedBeatSegments > 0
    ? `Beat segments rendered · ${reusedBeatSegments} reused from cache`
    : "Beat segments rendered");

  const timings: BeatTiming[] = timingSlots.filter((t): t is BeatTiming => t !== null);
  const segments: Uint8Array[] = segSlots.filter((s): s is Uint8Array => s !== null);
  const activeBeats = cut.beats.filter((b) => clips.some((c) => c.id === b.clipId));

  const hasTransitions = activeBeats.some((b) => b.transition && b.transition !== "none");
  const transitionsBakedInSegments = hasTransitions && canBakeTransitionsInFirstPass(activeBeats);
  let video: Uint8Array;

  if (hasTransitions && !transitionsBakedInSegments && segments.length > 1) {
    const inputs: EngineInput[] = segments.map((data, i) => ({ name: `seg_${i}.mp4`, data }));
    const ffmpegArgs: string[] = [];
    segments.forEach((_, i) => ffmpegArgs.push("-i", `seg_${i}.mp4`));

    const vFilterChains: string[] = [];
    let currentOffset = 0;

    for (let i = 0; i < segments.length - 1; i++) {
      const currBeat = activeBeats[i];
      const nextBeat = activeBeats[i + 1];

      let tr: string | undefined = undefined;
      let rawSec = 0.5;

      if (currBeat?.transition && currBeat.transition !== "none" && currBeat.transitionPosition === "end") {
        tr = currBeat.transition;
        rawSec = currBeat.transitionSec ?? 0.5;
      } else if (nextBeat?.transition && nextBeat.transition !== "none" && (nextBeat.transitionPosition ?? "start") === "start") {
        tr = nextBeat.transition;
        rawSec = nextBeat.transitionSec ?? 0.5;
      }

      const isCustomTr = !!tr && tr !== "none";
      const finalTr = isCustomTr ? tr : "fade";
      const segDur0 = timings[i]?.durationSec ?? 3;
      const segDur1 = timings[i + 1]?.durationSec ?? 3;
      const maxAllowedDur = Math.min(segDur0 / 2, segDur1 / 2, 0.8);
      const dur = isCustomTr ? Math.min(maxAllowedDur, Math.max(0.1, rawSec)) : 0.1;

      currentOffset += segDur0 - dur;

      const vIn1 = i === 0 ? "[0:v]" : `[v${i}]`;
      const vIn2 = `[${i + 1}:v]`;
      const vOut = i === segments.length - 2 ? "[v]" : `[v${i + 1}]`;

      vFilterChains.push(`${vIn1}${vIn2}xfade=transition=${finalTr}:duration=${dur.toFixed(2)}:offset=${Math.max(0, currentOffset).toFixed(2)}${vOut}`);
    }

    const aFilterChain = segments.map((_, i) => `[${i}:a]`).join("") + `concat=n=${segments.length}:v=0:a=1[a]`;
    const filterGraph = `${vFilterChains.join(";")};${aFilterChain}`;

    video = await runIsolated(
      inputs,
      [...ffmpegArgs, "-filter_complex", filterGraph, "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", preset, "-crf", String(crf), "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", audioBitrate, "-ar", "48000", "-ac", "2", "video.mp4"],
      "video.mp4",
      (f) => {
        const pct = Math.round(f * 100);
        onProgress?.(0.80 + f * 0.08, `Applying video transitions & concatenating (${pct}%)…`);
      },
    );
  } else {
    onProgress?.(0.86, transitionsBakedInSegments
      ? "Joining first-pass transition segments…"
      : "Concatenating video segments…");
    const concatInputs: EngineInput[] = segments.map((data, i) => ({ name: `seg_${i}.mp4`, data }));
    concatInputs.push({ name: "concat.txt", data: new TextEncoder().encode(segments.map((_, i) => `file 'seg_${i}.mp4'`).join("\n")) });
    try {
      video = await runIsolated(concatInputs, ["-f", "concat", "-safe", "0", "-fflags", "+genpts", "-i", "concat.txt", "-c", "copy", "video.mp4"], "video.mp4");
    } catch (err) {
      console.warn("Fast stream copy concat failed; falling back to filter concat...", err);
      const ffmpegArgs: string[] = [];
      segments.forEach((_, i) => ffmpegArgs.push("-i", `seg_${i}.mp4`));
      const vConcat = segments.map((_, i) => `[${i}:v]`).join("") + `concat=n=${segments.length}:v=1:a=0[v]`;
      const aConcat = segments.map((_, i) => `[${i}:a]`).join("") + `concat=n=${segments.length}:v=0:a=1[a]`;
      video = await runIsolated(
        concatInputs,
        [...ffmpegArgs, "-filter_complex", `${vConcat};${aConcat}`, "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", preset, "-crf", String(crf), "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", audioBitrate, "-ar", "48000", "-ac", "2", "video.mp4"],
        "video.mp4",
      );
    }
  }


  // Synthesize the VO-track narration and mix it — plus any music bed — over the
  // assembled video's audio at absolute times. VO lives here now (it can span beat
  // boundaries), replacing per-beat voiceover.
  onProgress?.(0.88, "Synthesizing VO track narration…");
  const ttsOpts = { engine: opts.ttsEngine ?? "kokoro", voice: opts.voice, elevenVoiceId: opts.elevenVoiceId, speed: opts.voiceoverSpeed, elevenModel: opts.elevenModel, elevenStability: opts.elevenStability, elevenStyle: opts.elevenStyle };
  const voSegs = opts.voiceover
    ? (cut.voSegments ?? []).filter((s) => s.text.trim())
    : [];
  const renderedVo: { startTimeSec: number; durationSec: number; volume: number; name: string; data: Uint8Array }[] = [];
  for (let k = 0; k < voSegs.length; k++) {
    try {
      const frac = 0.88 + ((k + 0.5) / Math.max(1, voSegs.length)) * 0.06;
      onProgress?.(frac, `Synthesizing VO narration ${k + 1} of ${voSegs.length}…`);
      const vo = await synthesizeVoiceover(voSegs[k].text.trim(), ttsOpts);
      renderedVo.push({ startTimeSec: voSegs[k].startTimeSec, durationSec: voSegs[k].durationSec, volume: voSegs[k].volume ?? 1.0, name: `voseg_${k}.${vo.ext}`, data: vo.data });
    } catch (err) {
      console.warn(`VO segment ${k} synthesis failed; skipping its audio.`, err);
    }
  }

  // Fetch each SFX segment's sound bytes (from the audio/ dir via the dev proxy).
  const sfxSegs = resolveSfxSegments(cut.sfxSegments, beatSpans(cut.beats)).filter((s) => s.durationSec > 0);

  const renderedSfx: { startTimeSec: number; durationSec: number; volume: number; name: string; data: Uint8Array }[] = [];
  for (let k = 0; k < sfxSegs.length; k++) {
    const s = sfxSegs[k];
    try {
      const ext = s.fileName.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? "mp3";
      const bytes = new Uint8Array(await fetchSfxBytes(s.fileName));
      renderedSfx.push({ startTimeSec: s.startTimeSec, durationSec: s.durationSec, volume: s.volume, name: `sfx_${k}.${ext}`, data: bytes });
    } catch (err) {
      console.warn(`SFX segment ${k} (${s.fileName}) could not be loaded; skipping.`, err);
    }
  }
  const renderedUserVoice: { startTimeSec: number; durationSec: number; sourceStartSec?: number; volume: number; levelDb?: number; bassDb?: number; trebleDb?: number; voiceEffect?: UserVoiceEffect; name: string; data: Uint8Array }[] = [];
  for (let k = 0; k < (cut.userVoiceSegments ?? []).length; k++) {
    const segment = cut.userVoiceSegments![k];
    if (!segment.file || segment.durationSec <= 0) continue;
    try {
      const ext = segment.file.name.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase()
        ?? (segment.file.type.includes("mp4") ? "m4a" : segment.file.type.includes("ogg") ? "ogg" : "webm");
      renderedUserVoice.push({
        startTimeSec: segment.startTimeSec,
        durationSec: segment.durationSec,
        sourceStartSec: segment.sourceStartSec,
        volume: segment.volume,
        levelDb: segment.levelDb,
        bassDb: segment.bassDb,
        trebleDb: segment.trebleDb,
        voiceEffect: segment.voiceEffect,
        name: `user_vo_${k}.${ext}`,
        data: await bytesOf(segment.file),
      });
    } catch (err) {
      console.warn(`User VO segment ${k} could not be loaded; skipping.`, err);
    }
  }

  onProgress?.(0.95, "Preparing final audio mux…");

  const hasMusic = !!opts.music;
  if (!hasMusic && renderedVo.length === 0 && renderedSfx.length === 0 && renderedUserVoice.length === 0) {
    onProgress?.(1.0, "Export complete ✓");
    return { blob: new Blob([new Uint8Array(video)], { type: "video/mp4" }), timings };
  }

  // Build one amix over: the video's own audio [0:a], the (looped, volume-scaled)
  // music bed, and each VO segment delayed to its absolute start.
  const finalInputs: EngineInput[] = [{ name: "video.mp4", data: video }];
  const inputArgs: string[] = ["-i", "video.mp4"];
  const mixChains: string[] = [];
  const mixLabels: string[] = ["[0:a]"];
  let inIdx = 1;

  if (hasMusic) {
    const mExt = opts.music!.name.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? "mp3";
    const mvol = Math.min(1, Math.max(0, opts.musicVolume ?? 0.5));
    finalInputs.push({ name: `music.${mExt}`, data: await bytesOf(opts.music!) });
    inputArgs.push("-stream_loop", "-1", "-i", `music.${mExt}`);
    mixChains.push(`[${inIdx}:a]volume=${mvol}[m]`);
    mixLabels.push("[m]");
    inIdx++;
  }

  const globalVoVol = Math.min(2, Math.max(0, opts.voiceoverVolume ?? 1.0));
  for (const r of renderedVo) {
    finalInputs.push({ name: r.name, data: r.data });
    inputArgs.push("-i", r.name);
    const delayMs = Math.round(r.startTimeSec * 1000);
    const segVol = Math.min(2, Math.max(0, (r.volume ?? 1.0) * globalVoVol));
    const priorityGain = captionVoiceDuckingFilterChain(
      segVol,
      r.startTimeSec,
      r.durationSec,
      cut.userVoiceSegments ?? [],
    );
    mixChains.push(`[${inIdx}:a]aformat=sample_rates=48000:channel_layouts=stereo,${priorityGain},adelay=${delayMs}|${delayMs}[vo${inIdx}]`);
    mixLabels.push(`[vo${inIdx}]`);
    inIdx++;
  }



  // SFX: trim each sound to its played length, scale volume, delay to its start.
  for (const r of renderedSfx) {
    finalInputs.push({ name: r.name, data: r.data });
    inputArgs.push("-i", r.name);
    const delayMs = Math.round(r.startTimeSec * 1000);
    const vol = Math.min(1, Math.max(0, r.volume));
    mixChains.push(`[${inIdx}:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=0:${r.durationSec.toFixed(3)},volume=${vol},adelay=${delayMs}|${delayMs}[sfx${inIdx}]`);
    mixLabels.push(`[sfx${inIdx}]`);
    inIdx++;
  }

  // User VO: trim, tone-shape, scale, and position the encoded microphone file.
  for (const recording of renderedUserVoice) {
    finalInputs.push({ name: recording.name, data: recording.data });
    inputArgs.push("-i", recording.name);
    const delayMs = Math.round(recording.startTimeSec * 1000);
    const volume = clampUserVoiceVolume(recording.volume) * dbToLinear(clampUserVoiceLevelDb(recording.levelDb));
    const eq = userVoiceEqFilterChain(recording.bassDb, recording.trebleDb, recording.voiceEffect);
    const sourceStart = Math.max(0, recording.sourceStartSec ?? 0);
    const sourceEnd = sourceStart + recording.durationSec;
    mixChains.push(`[${inIdx}:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=start=${sourceStart.toFixed(3)}:end=${sourceEnd.toFixed(3)},asetpts=PTS-STARTPTS,${eq},volume=${volume},adelay=${delayMs}|${delayMs}[uvo${inIdx}]`);
    mixLabels.push(`[uvo${inIdx}]`);
    inIdx++;
  }

  const filter = `${mixChains.join(";")}${mixChains.length ? ";" : ""}${mixLabels.join("")}amix=inputs=${mixLabels.length}:duration=first:normalize=0[a]`;
  const muxArgs = [...inputArgs, "-filter_complex", filter, "-map", "0:v:0", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-shortest", "final.mp4"];

  try {
    const finalOut = await runIsolated(finalInputs, muxArgs, "final.mp4", (f) => onProgress?.(0.95 + f * 0.05, "Muxing User VO, narration, SFX & music…"));
    onProgress?.(1.0, "Export complete ✓");
    return { blob: new Blob([new Uint8Array(finalOut)], { type: "video/mp4" }), timings };
  } catch (err) {
    console.warn("Final VO/music mux failed; returning the video without the mixed audio bed.", err);
    onProgress?.(1.0, "Export complete ✓");
    return { blob: new Blob([new Uint8Array(video)], { type: "video/mp4" }), timings };
  }
}

// --- Portable Script export (ADR-0003). ---

function srtTime(sec: number): string {
  const ms = Math.round(sec * 1000);
  const p = (n: number, wid = 2) => String(n).padStart(wid, "0");
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor((ms % 3600000) / 60000))}:${p(Math.floor((ms % 60000) / 1000))},${p(ms % 1000, 3)}`;
}

export function buildScriptText(cut: Cut): string {
  return cut.beats.map((b) => b.scriptText).join("\n\n");
}

export function buildSrt(cut: Cut): string {
  let t = 0;
  let n = 1;
  const cues: string[] = [];
  for (const b of cut.beats) {
    // Timed beats emit one cue per line at its own window; others one per beat.
    const schedule = captionSchedule(b.captionText, b.captionDurations);
    if (schedule) {
      for (const cue of schedule.cues) cues.push(`${n++}\n${srtTime(t + cue.start)} --> ${srtTime(t + cue.end)}\n${cue.text}\n`);
    } else {
      cues.push(`${n++}\n${srtTime(t)} --> ${srtTime(t + b.durationSec)}\n${b.captionText}\n`);
    }
    t += b.durationSec;
  }
  return cues.join("\n");
}
