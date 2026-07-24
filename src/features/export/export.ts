import type { Clip, Cut, Aspect, OverlayClip } from "../../domain/types";
import { runIsolated, multithreadReady, type EngineInput } from "../../lib/ffmpegEngine";
import { runPool } from "../../lib/pool";
import { synthesizeVoiceover, type TtsEngine } from "../../lib/tts";
import type { Voice } from "../../lib/kokoroTts";
import { captionSchedule } from "../../lib/pacing";
import { ffmpegColorFilters, ffmpegZoomFilters } from "../../studio/util";
import { ensureTitleFontFace, renderTitleLayerToPng, titleFontKey, TITLE_ANIM } from "./titleCanvas";
import { renderCaptionToPng } from "./captionCanvas";

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
  /** Which TTS engine (default "kokoro", in-browser). */
  ttsEngine?: TtsEngine;
  /** Kokoro voice to narrate with (default af_heart). */
  voice?: Voice;
  /** ElevenLabs voice id (when ttsEngine === "elevenlabs"). */
  elevenVoiceId?: string;
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

function sourceName(clip: Clip): string {
  if (clip.normalized) return "in.mp4";
  const ext = clip.name.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? "mp4";
  return `in.${ext}`;
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
          },
          w,
          h,
        );
        if (png) rendered.push({ layer: l, png, pngName: `btitle_${beat.id}_${k}.png`, index: k });
      }
      if (rendered.length) perBeatTitles.set(beat.id, rendered);
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
          const out = await runIsolated(
            [{ name: "src.mp4", data: srcData }],
            ["-ss", o.inSec.toFixed(3), "-t", o.durationSec.toFixed(3), "-i", "src.mp4",
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

  onProgress?.(0.10, "Generating voiceover narration & pacing…");
  interface PrecomputedBeat {
    clip: Clip;
    inSec: number;
    footageLen: number;
    segDur: number;
    capLines: string[];
    schedule: ReturnType<typeof captionSchedule>;
    voOn: boolean;
    voData?: { inputs: EngineInput[]; audioInput: string[]; voiceLeadMs: number };
  }

  const preBeats: (PrecomputedBeat | null)[] = await Promise.all(
    cut.beats.map(async (b) => {
      const clip = clipById.get(b.clipId);
      if (!clip) return null;
      const clipDur = clip.durationSec || b.outSec - b.inSec;
      const inSec = Math.min(Math.max(0, b.inSec), Math.max(0, clipDur - 0.1));
      const footageLen = Math.min(Math.max(0.1, b.outSec - b.inSec), Math.max(0.1, clipDur - inSec));
      const capLines = b.captionText.split("\n").map((l) => l.trim()).filter(Boolean);
      const schedule = captionSchedule(b.captionText, b.captionDurations);
      const voOn = !!opts.voiceover && (capLines.length > 0 || b.scriptText.trim() !== "");

      let segDur = footageLen;
      let voData: { inputs: EngineInput[]; audioInput: string[]; voiceLeadMs: number } | undefined;

      if (schedule) {
        const cues = schedule.cues;
        if (voOn) {
          segDur = Math.max(footageLen, schedule.total);
          const ttsOpts = { engine: opts.ttsEngine ?? "kokoro", voice: opts.voice, elevenVoiceId: opts.elevenVoiceId, speed: opts.voiceoverSpeed };
          const vos = await Promise.all(cues.map((cue) => synthesizeVoiceover(cue.text, ttsOpts)));
          const catInputs = vos.map((vo, k) => ({ name: `p${k}.${vo.ext}`, data: vo.data }));
          const catArgs = vos.flatMap((vo, k) => ["-i", `p${k}.${vo.ext}`]);
          const leadMs = Math.round(schedule.leadSec * 1000);
          const filt =
            cues.map((cue, k) => `[${k}:a]aformat=sample_rates=48000:channel_layouts=stereo,apad,atrim=0:${cue.sec.toFixed(3)},asetpts=N/SR/TB[a${k}]`).join(";") + ";" +
            cues.map((_, k) => `[a${k}]`).join("") + `concat=n=${cues.length}:v=0:a=1[cc];` +
            `[cc]adelay=${leadMs}|${leadMs}[a]`;
          const voall = await runIsolated(catInputs, [...catArgs, "-filter_complex", filt, "-map", "[a]", "voall.wav"], "voall.wav");
          voData = { inputs: [{ name: "vo.wav", data: voall }], audioInput: ["-i", "vo.wav"], voiceLeadMs: 0 };
        }
      } else if (voOn) {
        const lead = Math.max(0, opts.voiceoverLeadSec ?? 0);
        const gap = Math.max(0, opts.voiceoverGapSec ?? 0);
        const ttsOpts = { engine: opts.ttsEngine ?? "kokoro", voice: opts.voice, elevenVoiceId: opts.elevenVoiceId, speed: opts.voiceoverSpeed };
        const lineTexts = capLines.length > 0 ? capLines : [b.scriptText.trim()];
        const vos = await Promise.all(lineTexts.map((t) => synthesizeVoiceover(t, ttsOpts)));
        let cursor = 0;
        const timed = vos.map((vo, k) => {
          const d = vo.durationSec > 0 ? vo.durationSec : 1.5;
          const s = cursor; cursor += d;
          return { start: s, end: cursor, vo, text: lineTexts[k] };
        });
        segDur = Math.max(footageLen, lead + cursor) + gap;

        if (timed.length === 1) {
          voData = {
            inputs: [{ name: `vo.${timed[0].vo.ext}`, data: timed[0].vo.data }],
            audioInput: ["-i", `vo.${timed[0].vo.ext}`],
            voiceLeadMs: Math.round(lead * 1000),
          };
        } else {
          const catInputs = timed.map((t, k) => ({ name: `p${k}.${t.vo.ext}`, data: t.vo.data }));
          const catArgs = timed.flatMap((t, k) => ["-i", `p${k}.${t.vo.ext}`]);
          const filt =
            timed.map((_, k) => `[${k}:a]aformat=sample_rates=48000:channel_layouts=stereo[a${k}]`).join(";") + ";" +
            timed.map((_, k) => `[a${k}]`).join("") + `concat=n=${timed.length}:v=0:a=1[a]`;
          const voall = await runIsolated(catInputs, [...catArgs, "-filter_complex", filt, "-map", "[a]", "voall.wav"], "voall.wav");
          voData = { inputs: [{ name: "vo.wav", data: voall }], audioInput: ["-i", "vo.wav"], voiceLeadMs: Math.round(lead * 1000) };
        }
      }
      return { clip, inSec, footageLen, segDur, capLines, schedule, voOn, voData };
    }),
  );

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
    const { clip, inSec, footageLen, segDur, capLines, schedule, voOn, voData } = pre;
    const bStart = beatStartSecs[i];
    const bEnd = bStart + segDur;
    const data = await bytesOf(clip.normalized ?? clip.file);

    const inputs: EngineInput[] = [{ name: sourceName(clip), data }];
    if (voData) inputs.push(...voData.inputs);

    const captionCues: { enable: string }[] = [];
    const addCaption = async (text: string, enable: string) => {
      if (!text.trim()) return;
      const png = await renderCaptionToPng({ text, fontSizePx: fontsize, bgOpacity, lineHeight, marginPx: margin }, w, h);
      if (png) {
        inputs.push({ name: `cap_${captionCues.length}.png`, data: png });
        captionCues.push({ enable });
      }
    };

    // Zoom: "entire" scope folds straight into the base chain; "intro" scope must
    // be time-gated, so the zoomed frame is composited over the un-zoomed base with
    // an `enable` window (below) rather than baked into vf.
    const zoomFilters = ffmpegZoomFilters(w, h, b.zoom, b.zoomX, b.zoomY);
    const zoomIntro = zoomFilters.length > 0 && (b.zoomScope ?? "entire") === "intro";

    const vf = [
      "setpts=PTS-STARTPTS",
      `scale=${w}:${h}:force_original_aspect_ratio=decrease`,
      `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`,
      "setsar=1",
      ...(zoomIntro ? [] : zoomFilters),
      ...ffmpegColorFilters(b.colorAdjustments, cut.globalFilterId, cut.globalFilterIntensity, cut.globalFilterAdjustments),
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

    if (schedule) {
      for (const cue of schedule.cues) {
        await addCaption(cue.text, `between(t,${cue.start.toFixed(3)},${cue.end.toFixed(3)})`);
      }
    } else if (voOn) {
      const lead = Math.max(0, opts.voiceoverLeadSec ?? 0);
      if (capLines.length > 0) {
        const lineTexts = capLines;
        let cursor = 0;
        for (const t of lineTexts) {
          const s = cursor; cursor += 1.5;
          const enable = lineTexts.length > 1 ? `between(t,${(lead + s).toFixed(3)},${(lead + cursor).toFixed(3)})` : "";
          await addCaption(t, enable);
        }
      }
    } else if (capLines.length > 0) {
      await addCaption(b.captionText, "");
    }

    timingSlots[i] = { id: b.id, inSec, outSec: inSec + footageLen, durationSec: segDur };

    const beatVol = b.volume ?? 1;
    const strategy: "vo" | "source" | "silent" = voOn ? "vo" : beatVol > 0 ? "source" : "silent";

    const capCount = captionCues.length;
    const segDurStr = segDur.toFixed(3);
    const capInputArgs = captionCues.flatMap((_, k) => ["-loop", "1", "-t", segDurStr, "-r", "30", "-i", `cap_${k}.png`]);

    interface SegmentTitleOverlay {
      pngName: string;
      filter: string;
    }
    const segTitles: SegmentTitleOverlay[] = [];
    const titleInputArgs: string[] = [];

    for (let k = 0; k < preRenderedTitleLayers.length; k++) {
      const rtl = preRenderedTitleLayers[k];
      const l = rtl.layer;
      const scopeDur = l.scope === "intro" ? (l.introSec ?? 3) : totalDurationSec;
      const overlap = bStart < scopeDur && bStart + segDur > 0;
      if (!overlap) continue;

      const tName = `title_seg_${k}.png`;
      inputs.push({ name: tName, data: rtl.png });
      titleInputArgs.push("-loop", "1", "-t", segDurStr, "-r", "30", "-i", tName);

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

      segTitles.push({
        pngName: tName,
        filter: { fadeParts, xExpr, yExpr, enable } as any,
      });
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
      titleInputArgs.push("-loop", "1", "-t", segDurStr, "-r", "30", "-i", tName);

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

      segTitles.push({
        pngName: tName,
        filter: { fadeParts, xExpr, yExpr, enable } as any,
      });
    }

    const titleCount = segTitles.length;

    // Check which pre-trimmed B-roll overlays overlap this beat segment's window [bStart, bEnd]
    interface SegmentOverlay {
      data: Uint8Array<ArrayBuffer>;
      o: OverlayClip;
      stLocalSec: number;
      durLocalSec: number;
      inputIdx: number;
    }
    const segOverlays: SegmentOverlay[] = [];
    const overlayInputArgs: string[] = [];

    preTrimmedOverlays.forEach(({ data: ovData, o }) => {
      const oStart = o.startTimeSec;
      const oEnd = oStart + o.durationSec;
      if (oStart < bEnd && oEnd > bStart) {
        const stLocal = Math.max(0, oStart - bStart);
        const durLocal = Math.min(oEnd, bEnd) - Math.max(oStart, bStart);
        const ovIdx = segOverlays.length;
        const ovName = `ov_seg_${ovIdx}.mp4`;
        inputs.push({ name: ovName, data: ovData });
        overlayInputArgs.push("-i", ovName);
        segOverlays.push({
          data: ovData,
          o,
          stLocalSec: stLocal,
          durLocalSec: durLocal,
          inputIdx: 1 + capCount + titleCount + ovIdx,
        });
      }
    });

    const overlayCount = segOverlays.length;
    const audioIdx = 1 + capCount + titleCount + overlayCount;

    const totalOverlaysAndTitles = titleCount + overlayCount;
    const baseLabel = capCount === 0 && totalOverlaysAndTitles === 0 ? "[v]" : "[vbase]";
    // For "intro" zoom: split the processed base, punch-in one branch, and overlay
    // it back gated to the first `zoomSec` (segment-local t). Outside the window the
    // un-zoomed base shows through. "Entire"/no zoom → the base is a single chain.
    const chains: string[] = zoomIntro
      ? [
          `[0:v]${vf.join(",")},split=2[vzbase][vzsrc]`,
          `[vzsrc]${zoomFilters.join(",")}[vzoomed]`,
          `[vzbase][vzoomed]overlay=x=0:y=0:eof_action=pass:enable='between(t,0,${(b.zoomSec ?? 3).toFixed(3)})'${baseLabel}`,
        ]
      : [`[0:v]${vf.join(",")}${baseLabel}`];
    let last = baseLabel;

    captionCues.forEach((c, k) => {
      const isLast = k === capCount - 1 && totalOverlaysAndTitles === 0;
      const out = isLast ? "[v]" : `[vcap_${k}]`;
      const en = c.enable ? `:enable='${c.enable}'` : "";
      chains.push(`${last}[${k + 1}:v]overlay=x=0:y=0:eof_action=pass${en}${out}`);
      last = out;
    });

    segTitles.forEach((st, k) => {
      const tInputIdx = 1 + capCount + k;
      const isLast = k === titleCount - 1 && overlayCount === 0;
      const out = isLast ? "[v]" : `[vtitle_${k}]`;
      const fObj = st.filter as any;
      const ovLabel = `[ovt_${k}]`;
      const head = `[${tInputIdx}:v]format=rgba`;
      if (fObj.fadeParts.length > 0) {
        chains.push(`${head},${fObj.fadeParts.join(",")}${ovLabel}`);
      } else {
        chains.push(`${head}${ovLabel}`);
      }
      chains.push(`${last}${ovLabel}overlay=x='${fObj.xExpr}':y='${fObj.yExpr}':eof_action=pass${fObj.enable}${out}`);
      last = out;
    });

    const buildVideoChains = (rgbFormat: string | null): string[] => {
      const segChains = [...chains];
      let segLast = last;

      segOverlays.forEach((so, k) => {
        const isLast = k === overlayCount - 1;
        const out = isLast ? (rgbFormat ? `[vout_raw_${k}]` : "[v]") : `[voverlay_${k}]`;
        const mode = so.o.blendMode ?? "normal";
        const op = (so.o.opacity ?? 1).toFixed(3);
        const stSec = so.stLocalSec;
        const dur = so.durLocalSec;
        const scaleF = `scale=${w}:${h}:force_original_aspect_ratio=decrease`;

        // When an overlay spans a beat boundary, seek to the right position
        // within the pre-trimmed clip (avoid replaying from the start on beat N+1).
        const beatIntoOverlay = Math.max(0, bStart - so.o.startTimeSec);
        const seekStart = beatIntoOverlay.toFixed(3);
        const seekEnd = (beatIntoOverlay + dur).toFixed(3);
        const stStr = stSec.toFixed(3);
        const trailDur = Math.max(0, segDur - stSec - dur);
        const trailStr = trailDur.toFixed(3);

        // Build a FULL-SEGMENT-DURATION overlay stream so the blend/overlay filter
        // always has matching-duration inputs from t=0 — no sync stalls that cause
        // the "briefly plays → freeze → loops" artifact.
        //
        // Layout:  [neutral lead: stSec] ++ [overlay content: dur] ++ [neutral trail: trailDur]
        //          → concat → single stream of length ≈ segDur

        if (mode === "normal") {
          // Alpha-composite path. Neutral = fully transparent black.
          const concatParts: string[] = [];

          if (stSec > 0.001) {
            const lbl = `[ov_lead_${k}]`;
            segChains.push(`color=c=black@0.0:s=${w}x${h}:r=30:d=${stStr},format=rgba${lbl}`);
            concatParts.push(lbl);
          }

          const contLbl = `[ov_cont_${k}]`;
          segChains.push(
            `[${so.inputIdx}:v]trim=start=${seekStart}:end=${seekEnd},setpts=PTS-STARTPTS,` +
            `${scaleF},pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black@0.0,setsar=1,` +
            `format=rgba,colorchannelmixer=aa=${op}${contLbl}`
          );
          concatParts.push(contLbl);

          if (trailDur > 0.001) {
            const lbl = `[ov_trail_${k}]`;
            segChains.push(`color=c=black@0.0:s=${w}x${h}:r=30:d=${trailStr},format=rgba${lbl}`);
            concatParts.push(lbl);
          }

          let ovFull: string;
          if (concatParts.length > 1) {
            ovFull = `[ov_full_${k}]`;
            segChains.push(`${concatParts.join("")}concat=n=${concatParts.length}:v=1:a=0${ovFull}`);
          } else {
            ovFull = concatParts[0];
          }

          segChains.push(`${segLast}${ovFull}overlay=x=0:y=0:eof_action=pass${out}`);

        } else {
          // Blend modes (screen / multiply / overlay).
          // Neutral color = identity for each mode, so lead/trail regions are invisible.
          const neutralColor = mode === "multiply" ? "white" : mode === "overlay" ? "0x808080" : "black";
          const pixFmt = rgbFormat ?? "yuv420p";
          const concatParts: string[] = [];

          if (stSec > 0.001) {
            const lbl = `[ov_lead_${k}]`;
            segChains.push(`color=c=${neutralColor}:s=${w}x${h}:r=30:d=${stStr},format=${pixFmt}${lbl}`);
            concatParts.push(lbl);
          }

          const contLbl = `[ov_cont_${k}]`;
          segChains.push(
            `[${so.inputIdx}:v]trim=start=${seekStart}:end=${seekEnd},setpts=PTS-STARTPTS,` +
            `${scaleF},pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=${neutralColor},setsar=1,format=${pixFmt}${contLbl}`
          );
          concatParts.push(contLbl);

          if (trailDur > 0.001) {
            const lbl = `[ov_trail_${k}]`;
            segChains.push(`color=c=${neutralColor}:s=${w}x${h}:r=30:d=${trailStr},format=${pixFmt}${lbl}`);
            concatParts.push(lbl);
          }

          let ovFull: string;
          if (concatParts.length > 1) {
            ovFull = `[ov_full_${k}]`;
            segChains.push(`${concatParts.join("")}concat=n=${concatParts.length}:v=1:a=0${ovFull}`);
          } else {
            ovFull = concatParts[0];
          }

          if (rgbFormat) {
            const base = `[base_${k}]`;
            segChains.push(`${segLast}format=${rgbFormat}${base}`);
            segChains.push(`${base}${ovFull}blend=all_mode=${mode}:all_opacity=${op}${out}`);
          } else {
            segChains.push(`${segLast}${ovFull}blend=all_mode=${mode}:all_opacity=${op}${out}`);
          }
        }

        segLast = out;
      });

      if (rgbFormat && overlayCount > 0) {
        segChains.push(`${segLast}format=yuv420p[v]`);
      }

      return segChains;
    };

    let audioInput: string[];
    let voiceLeadMs = 0;
    if (voOn && voData) {
      audioInput = voData.audioInput;
      voiceLeadMs = voData.voiceLeadMs;
    } else {
      audioInput = ["-f", "lavfi", "-t", String(segDur), "-i", "anullsrc=r=48000:cl=stereo"];
    }

    const leadPrefix = voiceLeadMs > 0 ? `adelay=${voiceLeadMs}|${voiceLeadMs},` : "";
    const audibleOverlays = segOverlays.filter(({ o }) => (o.volume ?? 0) > 0);

    const buildSegArgs = (strat: "vo" | "source" | "silent", rgbFormat: string | null = null): string[] => {
      let audioInputArgs: string[];
      const aChains: string[] = [];

      if (strat === "vo") {
        audioInputArgs = audioInput;
        aChains.push(`[${audioIdx}:a]aformat=sample_rates=48000:channel_layouts=stereo,${leadPrefix}apad,atrim=0:${segDurStr},asetpts=PTS-STARTPTS[abase]`);
      } else if (strat === "source") {
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

      const vFilterString = buildVideoChains(rgbFormat).join(";");
      const aFilterString = aChains.join(";");

      return [
        "-ss", String(inSec), "-t", String(footageLen), "-i", sourceName(clip),
        ...capInputArgs,
        ...titleInputArgs,
        ...overlayInputArgs,
        ...audioInputArgs,
        "-filter_complex", `${vFilterString};${aFilterString}`,
        "-map", "[v]", "-map", "[a]",
        "-shortest",
        "-r", "30", "-c:v", "libx264", "-preset", preset, "-crf", String(crf), "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", audioBitrate, "-ar", "48000", "-ac", "2", "seg.mp4",
      ];
    };

    const hasRgbBlend = segOverlays.some((so) => {
      const m = so.o.blendMode ?? "normal";
      return m === "screen" || m === "multiply" || m === "overlay";
    });

    const renderSeg = async (strat: "vo" | "source" | "silent") => {
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
      [...ffmpegArgs, "-filter_complex", filterGraph, "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", preset, "-crf", String(crf), "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", audioBitrate, "video.mp4"],
      "video.mp4",
      (f) => onProgress?.(0.80 + f * 0.15, "Applying video transitions & concatenating…"),
    );
  } else {
    onProgress?.(0.88, "Concatenating video segments…");
    const concatInputs: EngineInput[] = segments.map((data, i) => ({ name: `seg_${i}.mp4`, data }));
    concatInputs.push({ name: "concat.txt", data: new TextEncoder().encode(segments.map((_, i) => `file 'seg_${i}.mp4'`).join("\n")) });
    video = await runIsolated(concatInputs, ["-f", "concat", "-safe", "0", "-i", "concat.txt", "-c", "copy", "video.mp4"], "video.mp4");
  }

  onProgress?.(0.95, "Preparing final audio mux…");

  if (!opts.music) {
    onProgress?.(1.0, "Export complete ✓");
    return { blob: new Blob([new Uint8Array(video)], { type: "video/mp4" }), timings };
  }

  const mExt = opts.music.name.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? "mp3";
  const vol = Math.min(1, Math.max(0, opts.musicVolume ?? 0.5));
  const musicInputs = [
    { name: "video.mp4", data: video },
    { name: `music.${mExt}`, data: await bytesOf(opts.music) },
  ];
  const muxWith = (args: string[]) =>
    runIsolated(musicInputs, args, "final.mp4", (f) => onProgress?.(0.95 + f * 0.05, "Muxing background music bed…"));

  const amixArgs =
    ["-i", "video.mp4", "-stream_loop", "-1", "-i", `music.${mExt}`,
     "-filter_complex", `[1:a]volume=${vol}[m];[0:a][m]amix=inputs=2:duration=first:normalize=0[a]`,
     "-map", "0:v:0", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-shortest", "final.mp4"];
  const musicOnlyArgs =
    ["-i", "video.mp4", "-stream_loop", "-1", "-i", `music.${mExt}`,
     "-filter_complex", `[1:a]volume=${vol}[a]`,
     "-map", "0:v:0", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-shortest", "final.mp4"];

  let withMusic: Uint8Array;
  try {
    withMusic = await muxWith(amixArgs);
  } catch (err) {
    console.warn("Music amix with base audio failed (base may have no audio track); using a music-only track.", err);
    withMusic = await muxWith(musicOnlyArgs);
  }
  onProgress?.(1.0, "Export complete ✓");
  return { blob: new Blob([new Uint8Array(withMusic)], { type: "video/mp4" }), timings };
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
