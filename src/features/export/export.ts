import type { Clip, Cut, Aspect, OverlayClip, Sticker } from "../../domain/types";
import { runIsolated, multithreadReady, type EngineInput } from "../../lib/ffmpegEngine";
import { runPool } from "../../lib/pool";
import { synthesizeVoiceover, type TtsEngine } from "../../lib/tts";
import { fetchSfxBytes } from "../../lib/sfxLibrary";
import type { Voice } from "../../lib/kokoroTts";
import { captionSchedule } from "../../lib/pacing";
import { renderStillContained } from "../../lib/frameSampler";
import { ffmpegColorLut, beatFrameFilters, kenBurnsChain, kenBurnsPreScale } from "../../studio/util";
import { ensureTitleFontFace, renderTitleLayerToPng, titleFontKey, TITLE_ANIM } from "./titleCanvas";
import { renderCaptionToPng } from "./captionCanvas";
import { renderStickersToPng, stickerWindowInSegment, beatSpans, resolveStickers, resolveSfxSegments } from "./stickerCanvas";
import { normalizeSplitConfig, buildSplitScreenFilterGraph } from "./splitScreenCanvas";
import { buildSegmentGraph, type StickerLayerSpec, type CaptionLayerSpec, type TitleLayerSpec, type OverlayLayerSpec, type LayerSpec } from "./segmentGraph";





// Full export (ADR-0002, ADR-0003): render the Cut client-side, one Beat per
// isolated engine — trim → scale/letterbox → BURN caption → uniform-silent
// segment — then concat (stream copy), then optionally lay a music bed over the
// whole thing. Captions use drawtext `textfile=` + `expansion=none`, which reads
// the caption from a file in the FS and sidesteps inline-escaping entirely.

export type TitleAnimation = "none" | "fade" | "slide_left" | "slide_bottom" | "slide_top" | "pop";

export interface TitleLayer {
  id: string;
  enabled: boolean;
  text: string;
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
  scope: "intro" | "entire";
  introSec?: number;
  animation?: TitleAnimation;
  animDurationSec?: number;
  boxWidthPct?: number;
  lineHeight?: number;
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
function exportConcurrency(): number {
  if (multithreadReady()) return 1;
  const mem = typeof navigator !== "undefined" ? (navigator as { deviceMemory?: number }).deviceMemory : undefined;
  if (typeof mem === "number") return mem <= 2 ? 1 : mem >= 8 ? 3 : 2;
  return 2;
}

export async function exportCut(
  cut: Cut,
  clips: Clip[],
  opts: ExportOptions,
  onProgress?: (fraction: number, statusText?: string) => void,
): Promise<ExportResult> {
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
  }
  const preRenderedTitleLayers: RenderedTitleLayer[] = [];
  if (opts.title && opts.title.layers) {
    const activeLayers = opts.title.layers.filter((l) => l.enabled && l.text.trim());
    for (let k = 0; k < activeLayers.length; k++) {
      const l = activeLayers[k];
      const fontKey = titleFontKey(l.fontCssFamily ?? "sans-serif", l.weight ?? 400, l.fontBytes?.length);
      const canvasFamily = await ensureTitleFontFace(fontKey, l.fontBytes, l.fontCssFamily ?? "sans-serif");
      const png = await renderTitleLayerToPng(
        {
          text: l.text,
          canvasFamily,
          cssFamily: l.fontCssFamily ?? "sans-serif",
          fontBytes: l.fontBytes,
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
        },
        w,
        h,
      );
      if (png) {
        preRenderedTitleLayers.push({ layer: l, png, pngName: `title_${k}.png`, index: k });
      }
    }
  }

  // Pre-render each beat's OWN title layers (parallel to the cut-level title).
  // These composite only within their own beat segment, timed segment-locally.
  const perBeatTitles = new Map<string, RenderedTitleLayer[]>();
  if (opts.beatTitles) {
    for (const beat of cut.beats) {
      const layers = opts.beatTitles[beat.id];
      if (!layers) continue;
      const activeLayers = layers.filter((l) => l.enabled && l.text.trim());
      const rendered: RenderedTitleLayer[] = [];
      for (let k = 0; k < activeLayers.length; k++) {
        const l = activeLayers[k];
        const fontKey = titleFontKey(l.fontCssFamily ?? "sans-serif", l.weight ?? 400, l.fontBytes?.length);
        const canvasFamily = await ensureTitleFontFace(fontKey, l.fontBytes, l.fontCssFamily ?? "sans-serif");
        const png = await renderTitleLayerToPng(
          {
            text: l.text,
            canvasFamily,
            cssFamily: l.fontCssFamily ?? "sans-serif",
            fontBytes: l.fontBytes,
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
          },
          w,
          h,
        );
        if (png) rendered.push({ layer: l, png, pngName: `btitle_${beat.id}_${k}.png`, index: k });
      }
      if (rendered.length) perBeatTitles.set(beat.id, rendered);
    }
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
    const trimResults = await Promise.all(
      activeOverlays.map(async (o, idx) => {
        const clip = clips.find((c) => c.id === o.clipId);
        if (!clip) return null;
        try {
          const srcData = await bytesOf(clip.normalized ?? clip.file);
          const srcName = sourceName(clip);
          const out = await runIsolated(
            [{ name: srcName, data: srcData }],
            ["-ss", o.inSec.toFixed(3), "-t", o.durationSec.toFixed(3), "-i", srcName,
             "-c:v", "libx264", "-preset", preset, "-crf", String(crf), "-pix_fmt", "yuv420p",
             "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "ov.mp4"],
            "ov.mp4",
          );
          trimProgress++;
          onProgress?.(0.05 + (trimProgress / activeOverlays.length) * 0.05, `Preparing B-roll overlay ${trimProgress} of ${activeOverlays.length}…`);
          return { data: out, o };
        } catch (err) {
          console.warn(`Overlay ${idx} pre-trim failed; skipping overlay.`, err);
          trimProgress++;
          onProgress?.(0.05 + (trimProgress / activeOverlays.length) * 0.05, `Preparing B-roll overlay ${trimProgress} of ${activeOverlays.length}…`);
          return null;
        }
      }),
    );
    for (const r of trimResults) {
      if (r) preTrimmedOverlays.push(r);
    }
  }

  onProgress?.(0.10, "Preparing beat segments…");
  // Beat duration is footage-only now — narration lives on the independent VO track
  // (synthesized + mixed as a master audio bed at the final stage), so beats no longer
  // stretch to fit voiceover.
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
    const footageLen = Math.min(Math.max(0.1, b.outSec - b.inSec), Math.max(0.1, clipDur - inSec));
    return { clip, inSec, footageLen, segDur: footageLen };
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

  const reportBeatProg = () => {
    const frac = (prog.reduce((a, x) => a + x, 0) / n) * 0.70 + 0.10;
    const displayNum = Math.min(n, completedBeats + 1);
    onProgress?.(frac, `Rendering beat segment ${displayNum} of ${n}…`);
  };

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

    // Ken Burns is a Still's moving framing (ADR-0015). Its source is
    // pre-scaled ONCE here, on the GPU, rather than by a `scale` in the filter
    // chain — the spike measured that as slower than no pre-scale at all,
    // because -loop 1 made ffmpeg re-scale the same picture 300 times.
    const isKenBurns = clip.kind === "still" && b.framing === "kenBurns" && !!b.kenBurns;
    let data: Uint8Array;
    let srcName = sourceName(clip);
    if (isKenBurns) {
      const cached = kenBurnsStills.get(clip.id);
      if (cached) {
        data = cached;
      } else {
        const ps = kenBurnsPreScale(w, h, clip.width, clip.height);
        data = await renderStillContained(clip.file, ps.w, ps.h);
      }
      srcName = "in.jpg";
    } else {

      data = await bytesOf(clip.normalized ?? clip.file);
    }

    const isSplitScreen = !!(b.splitScreen && b.splitScreen.layout !== "none" && b.splitScreen.slots.length > 1);
    const normSplitCfg = isSplitScreen ? normalizeSplitConfig(b.splitScreen, clip.id, inSec) : null;

    const inputs: EngineInput[] = [];

    if (isSplitScreen && normSplitCfg) {
      for (let sIdx = 0; sIdx < normSplitCfg.slots.length; sIdx++) {
        const slot = normSplitCfg.slots[sIdx];
        const slotClip = clips.find((c: Clip) => c.id === slot.clipId) ?? clip;
        const slotData = await bytesOf(slotClip.normalized ?? slotClip.file);
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

    const vf = [
      "setpts=PTS-STARTPTS",
      // Ken Burns REPLACES the fit-and-pad rather than following it: the static
      // Zoom runs after the pad and so scales the letterbox bars too, which for
      // a Still would also discard the native resolution ADR-0012 preserved.
      // The one-time pre-render already contained and padded to canvas aspect,
      // so zoompan crops straight to canvas dimensions.
      ...(kbMove
        ? kenBurnsChain(w, h, kbMove, segDur)
        : [
            `scale=${w}:${h}:force_original_aspect_ratio=decrease`,
            `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`,
          ]),
      "setsar=1",
      ...frame.base,
      ...(colorLut ? [colorLut.filter] : []),
    ];

    if (i === 0 && b.transition && b.transition !== "none" && (b.transitionPosition ?? "start") === "start") {
      const fTr = b.transition;
      const fSec = Math.min(1.0, b.transitionSec ?? 0.5);
      if (fTr === "fadeblack" || fTr === "fade") {
        vf.push(`fade=t=in:st=0:d=${fSec.toFixed(2)}`);
      }
    }

    if (i === n - 1 && b.transition && b.transition !== "none" && b.transitionPosition === "end") {
      const lTr = b.transition;
      const lSec = Math.min(1.0, b.transitionSec ?? 0.5);
      if (lTr === "fadeblack" || lTr === "fade") {
        const fadeStart = Math.max(0, segDur - lSec).toFixed(3);
        vf.push(`fade=t=out:st=${fadeStart}:d=${lSec.toFixed(2)}`);
      }
    }

    const freeze = segDur - footageLen;
    if (freeze > 0.01) vf.push(`tpad=stop_duration=${freeze.toFixed(3)}:stop_mode=clone`);

    // VO-track captions: burn each visible segment that overlaps this beat's window
    // [bStart, bEnd], gated to the overlap in segment-local time. A caption spanning a
    // beat boundary is drawn in each segment it touches.
    for (const seg of (cut.voSegments ?? [])) {
      if (!seg.captionVisible || !seg.text.trim()) continue;
      const segEnd = seg.startTimeSec + seg.durationSec;
      if (seg.startTimeSec < bEnd && segEnd > bStart) {
        const localStart = Math.max(0, seg.startTimeSec - bStart);
        const localEnd = Math.min(segDur, segEnd - bStart);
        if (localEnd > localStart + 0.01) {
          await addCaption(seg.text, `between(t,${localStart.toFixed(3)},${localEnd.toFixed(3)})`);
        }
      }
    }

    timingSlots[i] = { id: b.id, inSec, outSec: inSec + footageLen, durationSec: segDur };

    const beatVol = b.volume ?? 1;
    // Beat audio is just the (optionally muted) source clip now; narration is the
    // master VO bed mixed in at the final stage.
    const strategy: "source" | "silent" = beatAudioStrategy(clip, beatVol);

    const segDurStr = segDur.toFixed(3);

    // Titles (Task 4: now collected as TitleLayerSpec[], compositing handled
    // by buildSegmentGraph inside buildVideoChains below).
    const titleLayers: TitleLayerSpec[] = [];

    for (let k = 0; k < preRenderedTitleLayers.length; k++) {
      const rtl = preRenderedTitleLayers[k];
      const l = rtl.layer;
      const scopeDur = l.scope === "intro" ? (l.introSec ?? 3) : totalDurationSec;
      const overlap = bStart < scopeDur && bStart + segDur > 0;
      if (!overlap) continue;

      const tName = `title_seg_${k}.png`;
      inputs.push({ name: tName, data: rtl.png });

      const anim = l.animation ?? "none";
      const animDur = l.animDurationSec ?? 0.5;

      const fadeParts: string[] = [];
      if (anim !== "none" && bStart < animDur) {
        const dIn = Math.min(animDur - bStart, segDur);
        if (dIn > 0) fadeParts.push(`fade=t=in:st=0:d=${dIn.toFixed(3)}:alpha=1`);
      }
      if (l.scope === "intro") {
        const fadeDur = Math.min(0.8, scopeDur / 2);
        const fadeStart = Math.max(0, scopeDur - fadeDur);
        if (bStart + segDur > fadeStart && bStart < scopeDur) {
          const stOut = Math.max(0, fadeStart - bStart);
          const dOut = Math.min(fadeDur, scopeDur - Math.max(bStart, fadeStart));
          if (dOut > 0) fadeParts.push(`fade=t=out:st=${stOut.toFixed(3)}:d=${dOut.toFixed(3)}:alpha=1`);
        }
      }

      const dStr = animDur.toFixed(3);
      const bStartStr = bStart.toFixed(3);
      const tExpr = bStart > 0 ? `(t+${bStartStr})` : "t";

      let xExpr = "0";
      let yExpr = "0";
      if (bStart < animDur) {
        if (anim === "slide_left") {
          xExpr = `if(lt(${tExpr},${dStr}),(1-${tExpr}/${dStr})*${(-w * TITLE_ANIM.slideXFrac).toFixed(1)},0)`;
        } else if (anim === "slide_bottom") {
          yExpr = `if(lt(${tExpr},${dStr}),(1-${tExpr}/${dStr})*${(h * TITLE_ANIM.slideYFrac).toFixed(1)},0)`;
        } else if (anim === "slide_top") {
          yExpr = `if(lt(${tExpr},${dStr}),(1-${tExpr}/${dStr})*${(-h * TITLE_ANIM.slideYFrac).toFixed(1)},0)`;
        }
      }

      const enExpr = bStart > 0 ? `between(t+${bStartStr},0,${scopeDur.toFixed(3)})` : `between(t,0,${scopeDur.toFixed(3)})`;
      const enable = l.scope === "intro" ? `:enable='${enExpr}'` : "";

      titleLayers.push({ kind: "title", pngName: tName, png: rtl.png, fadeParts, xExpr, yExpr, enable });
    }

    // Per-beat titles: same compositing pipeline, but timed segment-locally
    // (this title lives entirely within its own beat, so bStart is effectively 0
    // and "entire" scope spans the whole segment). Appended after the cut-level
    // titles so the input indexing (1 + capCount + k) stays consistent.
    const beatRendered = perBeatTitles.get(b.id) ?? [];
    for (let j = 0; j < beatRendered.length; j++) {
      const rtl = beatRendered[j];
      const l = rtl.layer;
      const scopeDur = l.scope === "intro" ? (l.introSec ?? 3) : segDur;

      const tName = rtl.pngName;
      inputs.push({ name: tName, data: rtl.png });

      const anim = l.animation ?? "none";
      const animDur = l.animDurationSec ?? 0.5;

      const fadeParts: string[] = [];
      if (anim !== "none") {
        const dIn = Math.min(animDur, segDur);
        if (dIn > 0) fadeParts.push(`fade=t=in:st=0:d=${dIn.toFixed(3)}:alpha=1`);
      }
      if (l.scope === "intro") {
        const fadeDur = Math.min(0.8, scopeDur / 2);
        const fadeStart = Math.max(0, scopeDur - fadeDur);
        if (segDur > fadeStart) {
          const dOut = Math.min(fadeDur, scopeDur - fadeStart);
          if (dOut > 0) fadeParts.push(`fade=t=out:st=${fadeStart.toFixed(3)}:d=${dOut.toFixed(3)}:alpha=1`);
        }
      }

      const dStr = animDur.toFixed(3);
      let xExpr = "0";
      let yExpr = "0";
      if (anim === "slide_left") {
        xExpr = `if(lt(t,${dStr}),(1-t/${dStr})*${(-w * TITLE_ANIM.slideXFrac).toFixed(1)},0)`;
      } else if (anim === "slide_bottom") {
        yExpr = `if(lt(t,${dStr}),(1-t/${dStr})*${(h * TITLE_ANIM.slideYFrac).toFixed(1)},0)`;
      } else if (anim === "slide_top") {
        yExpr = `if(lt(t,${dStr}),(1-t/${dStr})*${(-h * TITLE_ANIM.slideYFrac).toFixed(1)},0)`;
      }

      const enable = l.scope === "intro" ? `:enable='between(t,0,${scopeDur.toFixed(3)})'` : "";

      titleLayers.push({ kind: "title", pngName: tName, png: rtl.png, fadeParts, xExpr, yExpr, enable });
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



    const allLayers: LayerSpec[] = [
      ...captionLayers,
      ...titleLayers,
      ...overlayLayers,
      ...stickerLayers,
    ];

    const audioIdx = numVideoInputs + allLayers.length;

    const baseLabel = allLayers.length === 0 ? "[v]" : "[vbase]";
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
      .map((ol, k) => ({
        o: ol.overlayClip,
        stLocalSec: ol.stLocalSec,
        inputIdx: numVideoInputs + captionLayers.length + titleLayers.length + k,
      }))
      .filter(({ o }) => (o.volume ?? 0) > 0);

    const buildSegArgs = (strat: "source" | "silent", rgbFormat: string | null = null): string[] => {
      let audioInputArgs: string[];
      const aChains: string[] = [];

      const sgResult = buildSegmentGraph(allLayers, {
        inputIndexBase: numVideoInputs,
        baseLabel,
        segDurStr,
        rgbFormat,
      });


      if (strat === "source") {
        audioInputArgs = [];
        aChains.push(`[0:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${beatVol.toFixed(2)},apad,atrim=0:${segDurStr},asetpts=PTS-STARTPTS[abase]`);
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
        aChains[0] = aChains[0].replace("[abase]", "[a]");
      }

      const segChains = [...chains, ...sgResult.chains];
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
      if (hasRgbBlend) {
        for (const rgbFormat of ["gbrp", null] as const) {
          try {
            return await runIsolated(inputs, buildSegArgs(strat, rgbFormat), "seg.mp4", (f) => { prog[i] = f; reportBeatProg(); });
          } catch (err) {
            console.warn(`Segment ${i} RGB blend pass failed (rgbFormat=${rgbFormat}), trying fallback...`, err);
          }
        }
      }
      return runIsolated(inputs, buildSegArgs(strat, null), "seg.mp4", (f) => { prog[i] = f; reportBeatProg(); });
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

  onProgress?.(0.80, "Beat segments rendered");

  const timings: BeatTiming[] = timingSlots.filter((t): t is BeatTiming => t !== null);
  const segments: Uint8Array[] = segSlots.filter((s): s is Uint8Array => s !== null);
  const activeBeats = cut.beats.filter((b) => clips.some((c) => c.id === b.clipId));

  const hasTransitions = activeBeats.some((b) => b.transition && b.transition !== "none");
  let video: Uint8Array;

  if (hasTransitions && segments.length > 1) {
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
    onProgress?.(0.86, "Concatenating video segments…");
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
  const voSegs = (cut.voSegments ?? []).filter((s) => s.text.trim());
  const renderedVo: { startTimeSec: number; volume: number; name: string; data: Uint8Array }[] = [];
  for (let k = 0; k < voSegs.length; k++) {
    try {
      const frac = 0.88 + ((k + 0.5) / Math.max(1, voSegs.length)) * 0.06;
      onProgress?.(frac, `Synthesizing VO narration ${k + 1} of ${voSegs.length}…`);
      const vo = await synthesizeVoiceover(voSegs[k].text.trim(), ttsOpts);
      renderedVo.push({ startTimeSec: voSegs[k].startTimeSec, volume: voSegs[k].volume ?? 1.0, name: `voseg_${k}.${vo.ext}`, data: vo.data });
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

  onProgress?.(0.95, "Preparing final audio mux…");

  const hasMusic = !!opts.music;
  if (!hasMusic && renderedVo.length === 0 && renderedSfx.length === 0) {
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

  const globalVoVol = Math.min(1, Math.max(0, opts.voiceoverVolume ?? 1.0));
  for (const r of renderedVo) {
    finalInputs.push({ name: r.name, data: r.data });
    inputArgs.push("-i", r.name);
    const delayMs = Math.round(r.startTimeSec * 1000);
    const segVol = Math.min(1, Math.max(0, (r.volume ?? 1.0) * globalVoVol));
    mixChains.push(`[${inIdx}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${segVol.toFixed(2)},adelay=${delayMs}|${delayMs}[vo${inIdx}]`);
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

  const filter = `${mixChains.join(";")}${mixChains.length ? ";" : ""}${mixLabels.join("")}amix=inputs=${mixLabels.length}:duration=first:normalize=0[a]`;
  const muxArgs = [...inputArgs, "-filter_complex", filter, "-map", "0:v:0", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-shortest", "final.mp4"];

  try {
    const finalOut = await runIsolated(finalInputs, muxArgs, "final.mp4", (f) => onProgress?.(0.95 + f * 0.05, "Muxing VO, SFX & music…"));
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
