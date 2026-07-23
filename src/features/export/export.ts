import type { Clip, Cut, Aspect, OverlayClip } from "../../domain/types";
import { runIsolated, multithreadReady, type EngineInput } from "../../lib/ffmpegEngine";
import { runPool } from "../../lib/pool";
import { synthesizeVoiceover, type TtsEngine } from "../../lib/tts";
import type { Voice } from "../../lib/kokoroTts";
import { captionSchedule } from "../../lib/pacing";
import { ffmpegColorFilters } from "../../studio/util";
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
  /** Optional styled title burned over the video. */
  title?: TitleOverlay | null;
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
// mirroring the preview's CSS transform (see TITLE_ANIM for the shared easing).
async function buildTitleFilterGraph(
  title: TitleOverlay,
  w: number,
  h: number,
  totalDurationSec: number,
): Promise<{ filterGraph: string; inputs: EngineInput[]; inputArgs: string[]; outputMap: string }> {
  const activeLayers = title.layers.filter((l) => l.enabled && l.text.trim());
  const inputs: EngineInput[] = [];
  const inputArgs: string[] = ["-i", "in.mp4"];
  const filterChains: string[] = [];

  let lastV = "[0:v]";
  let inputIndex = 1;

  for (let k = 0; k < activeLayers.length; k++) {
    const l = activeLayers[k];
    // Register the exact TTF so the export canvas draws byte-identical glyphs to
    // the preview (and measureText wraps against the real metrics).
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
    // No canvas (non-browser) or a render failure → skip this layer so the export
    // still completes, just without it.
    if (!png) continue;

    const pngName = `title_${k}.png`;
    inputs.push({ name: pngName, data: png });

    // Loop the still into a real 30fps stream for its lifetime so the fade filter
    // has frames to animate across (a bare image has a single frame at t=0). The
    // stream starts at t=0 aligned with the base, so fade/overlay `t` match.
    const scopeDur = l.scope === "intro" ? (l.introSec ?? 3) : Math.max(0.1, totalDurationSec);
    inputArgs.push("-loop", "1", "-t", scopeDur.toFixed(3), "-r", "30", "-i", pngName);
    const idx = inputIndex++;

    const anim = l.animation ?? "none";
    const animDur = l.animDurationSec ?? 0.5;
    const fadeInNeeded = anim !== "none"; // fade/slide/pop all ease their opacity in

    const fadeParts: string[] = [];
    if (fadeInNeeded) fadeParts.push(`fade=t=in:st=0:d=${animDur.toFixed(3)}:alpha=1`);
    if (l.scope === "intro") {
      const fade = Math.min(0.8, scopeDur / 2);
      const fadeStart = Math.max(0, scopeDur - fade);
      fadeParts.push(`fade=t=out:st=${fadeStart.toFixed(3)}:d=${fade.toFixed(3)}:alpha=1`);
    }
    const ovLabel = `[ov_${k}]`;
    const head = `[${idx}:v]format=rgba`;
    filterChains.push(fadeParts.length ? `${head},${fadeParts.join(",")}${ovLabel}` : `${head}${ovLabel}`);

    // Slide shifts the whole frame-sized PNG by a decaying offset expressed as a
    // fraction of the frame (TITLE_ANIM), so the preview's CSS transform lands on
    // exactly the same proportion. `pop` eases opacity only (overlay can't scale
    // over time); the preview matches by easing opacity for pop too.
    const d = animDur.toFixed(3);
    let xExpr = "0";
    let yExpr = "0";
    if (anim === "slide_left") {
      xExpr = `if(lt(t,${d}),(1-t/${d})*${(-w * TITLE_ANIM.slideXFrac).toFixed(1)},0)`;
    } else if (anim === "slide_bottom") {
      yExpr = `if(lt(t,${d}),(1-t/${d})*${(h * TITLE_ANIM.slideYFrac).toFixed(1)},0)`;
    } else if (anim === "slide_top") {
      yExpr = `if(lt(t,${d}),(1-t/${d})*${(-h * TITLE_ANIM.slideYFrac).toFixed(1)},0)`;
    }

    const enable = l.scope === "intro" ? `:enable='between(t,0,${scopeDur.toFixed(3)})'` : "";
    const nextV = `[titled_${k}]`;
    filterChains.push(`${lastV}${ovLabel}overlay=x='${xExpr}':y='${yExpr}':eof_action=pass${enable}${nextV}`);
    lastV = nextV;
  }

  return { filterGraph: filterChains.join(";"), inputs, inputArgs, outputMap: lastV };
}

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

async function applyOverlaysToVideo(
  videoBytes: Uint8Array,
  overlays: OverlayClip[],
  clips: Clip[],
  w: number,
  h: number,
  preset: string,
  crf: number,
  totalDurationSec: number,
  onProgress?: (fraction: number) => void,
): Promise<Uint8Array> {
  const activeOverlays = overlays.filter((o) => clips.some((c) => c.id === o.clipId));
  if (activeOverlays.length === 0) return videoBytes;
  // The RGB composite re-encodes the whole timeline and runs ~0.3x realtime (RGB
  // conversion + lut2 + libx264), so the default 90s cap kills it mid-encode on
  // longer cuts → it fell back to YUV → magenta. Budget ~10x realtime with a
  // generous floor so a healthy-but-slow encode is allowed to finish.
  const compositeTimeoutMs = Math.max(180000, Math.ceil(totalDurationSec) * 10000);

  // Overlay compositing runs as several LEAN ffmpeg passes instead of one heavy
  // filtergraph. The combined pass (full clips + RGB blend + audio amix, all at
  // once) OOM-aborted ffmpeg.wasm. See EXPORT_OVERLAY_AUDIO_ISSUE.md.
  //   1. pre-trim each overlay to its window (drops the full-clip memory cost),
  //   2. composite overlay VIDEO in one lean pass (RGB blend → matches CSS),
  //   3. mix overlay AUDIO in a separate pass (copies the video).
  // Every step degrades gracefully so the export always completes.

  // ---- 1. Pre-trim each overlay to [inSec, inSec+dur] (isolated, small output). ----
  const trimmed: { data: Uint8Array; o: OverlayClip }[] = [];
  for (let idx = 0; idx < activeOverlays.length; idx++) {
    const o = activeOverlays[idx];
    const clip = clips.find((c) => c.id === o.clipId);
    if (!clip) continue;
    try {
      const srcData = await bytesOf(clip.normalized ?? clip.file);
      const out = await runIsolated(
        [{ name: "src.mp4", data: srcData }],
        ["-ss", o.inSec.toFixed(3), "-t", o.durationSec.toFixed(3), "-i", "src.mp4",
         "-c:v", "libx264", "-preset", preset, "-crf", String(crf), "-pix_fmt", "yuv420p",
         "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "ov.mp4"],
        "ov.mp4",
      );
      trimmed.push({ data: out, o });
    } catch (err) {
      console.warn(`Overlay ${idx} pre-trim failed; skipping this overlay.`, err);
    }
    onProgress?.(((idx + 1) / activeOverlays.length) * 0.4);
  }
  if (trimmed.length === 0) return videoBytes;

  // ---- 2. Composite overlay VIDEO onto the base (keep base audio via copy). ----
  // Screen/multiply/overlay MUST be computed in sRGB to match the CSS preview
  // (`mix-blend-mode`); a YUV blend runs the math on the chroma planes → magenta.
  // Two strategies, tried in order (first success wins):
  //   • gbrp (planar RGB) + `blend`: convert both streams to gbrp so the blend
  //     filter operates on sRGB components. `enable` time-gates the effect; tpad
  //     aligns the overlay stream. An explicit `format=yuv420p` at the end of the
  //     chain converts back to YUV with the correct colorspace matrix (leaving the
  //     output in gbrp made the encoder's sws_scale pick the wrong matrix → full-
  //     frame magenta — the prior "blend crashes in RGB" were all just the 90s
  //     timeout, not a filter bug; see Fix #18/#19).
  //   • YUV `blend` fallback: screen/multiply get a colour tint, but always works.
  // Each overlay is placed with tpad so its content lands at startTimeSec AND the
  // stream has a frame from t=0 (else framesync buffers every base frame → OOM).
  const buildVideoArgs = (rgbFormat: string | null): { inputs: EngineInput[]; args: string[] } => {
    const inputs: EngineInput[] = [{ name: "base.mp4", data: videoBytes }];
    const args: string[] = ["-i", "base.mp4"];
    const chains: string[] = [];
    let lastV = "[0:v]";
    trimmed.forEach(({ o, data }, idx) => {
      inputs.push({ name: `ov_${idx}.mp4`, data });
      args.push("-i", `ov_${idx}.mp4`);
      const inputIdx = idx + 1;
      const mode = o.blendMode ?? "normal";
      const op = (o.opacity ?? 1).toFixed(3);
      const st = o.startTimeSec.toFixed(3);
      const dur = o.durationSec.toFixed(3);
      const scaledOv = `[ov_${idx}]`;
      const nextV = `[v_step_${idx}]`;
      const enable = `enable='between(t,${st},${st}+${dur})'`;
      const scale = `scale=${w}:${h}:force_original_aspect_ratio=decrease`;
      if (mode === "screen" || mode === "multiply" || mode === "overlay") {
        // Letterbox pad uses each mode's identity colour so bars stay invisible.
        const padColor = mode === "multiply" ? "white" : mode === "overlay" ? "0x808080" : "black";
        if (rgbFormat) {
          // RGB `blend` path: convert both to planar RGB so the blend math runs
          // on sRGB components (matches CSS mix-blend-mode). The prior "blend
          // crashes in RGB" were all just the 90s timeout (Fix #18/#19).
          const place = `setpts=PTS-STARTPTS,tpad=start_duration=${st}:color=${padColor}`;
          chains.push(
            `[${inputIdx}:v]${scale},pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=${padColor},setsar=1,${place},format=${rgbFormat}${scaledOv}`
          );
          const base = `[base_${idx}]`;
          chains.push(`${lastV}format=${rgbFormat}${base}`);
          chains.push(`${base}${scaledOv}blend=all_mode=${mode}:all_opacity=${op}:${enable}${nextV}`);
        } else {
          // YUV `blend` fallback: time-gated with `enable` (magenta tint possible).
          const place = `setpts=PTS-STARTPTS,tpad=start_duration=${st}:color=${padColor}`;
          chains.push(
            `[${inputIdx}:v]${scale},pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=${padColor},setsar=1,${place}${scaledOv}`
          );
          chains.push(`${lastV}${scaledOv}blend=all_mode=${mode}:all_opacity=${op}:${enable}${nextV}`);
        }
      } else {
        // Normal: alpha-aware "over" compositing. Transparent letterbox + opacity.
        const place = `setpts=PTS-STARTPTS,tpad=start_duration=${st}:color=black@0.0`;
        chains.push(
          `[${inputIdx}:v]format=rgba,${scale},pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black@0.0,setsar=1,${place},colorchannelmixer=aa=${op}${scaledOv}`
        );
        chains.push(`${lastV}${scaledOv}overlay=x=0:y=0:${enable}:eof_action=pass${nextV}`);
      }
      lastV = nextV;
    });
    // For RGB paths, explicitly convert back to yuv420p WITHIN the filter graph.
    // Leaving the output in gbrp for the encoder's sws_scale to convert picks a
    // default colorspace matrix that can differ from the input's bt709, causing a
    // full-frame magenta/pink shift. The in-graph `format` filter preserves the
    // colorspace metadata from the original decode → correct round-trip.
    if (rgbFormat) {
      chains.push(`${lastV}format=yuv420p[v_out]`);
      lastV = "[v_out]";
    }
    args.push(
      "-filter_complex", chains.join(";"),
      "-map", lastV, "-map", "0:a:0?",
      "-c:v", "libx264", "-preset", preset, "-crf", String(crf), "-pix_fmt", "yuv420p",
      "-c:a", "copy", "video.mp4",
    );
    return { inputs, args };
  };

  // Fallback ladder: gbrp (planar RGB, `blend` with correct sRGB math +
  // explicit yuv420p conversion back) → null (YUV `blend`, always works but
  // screen/multiply get a colour tint). First success wins.
  let composited: Uint8Array | null = null;
  for (const rgbFormat of ["gbrp", null] as const) {
    try {
      const { inputs, args } = buildVideoArgs(rgbFormat);
      composited = await runIsolated(inputs, args, "video.mp4", (f) => onProgress?.(0.4 + f * 0.4), compositeTimeoutMs);
      if (!rgbFormat) console.warn("Overlay video composited in YUV (screen/multiply may show a colour tint); RGB blend failed.");
      break;
    } catch (err) {
      console.warn(`Overlay video composite failed (rgbFormat=${rgbFormat ?? "YUV"}).`, err);
    }
  }
  if (!composited) {
    console.warn("Overlay video composite failed entirely; exporting without overlays.");
    return videoBytes;
  }

  // ---- 3. Mix each audible overlay's audio onto the composited video. ----
  const audible = trimmed.filter(({ o }) => (o.volume ?? 0) > 0);
  if (audible.length === 0) {
    onProgress?.(1.0);
    return composited;
  }
  try {
    const inputs: EngineInput[] = [{ name: "vid.mp4", data: composited }];
    const args: string[] = ["-i", "vid.mp4"];
    const chains: string[] = [`[0:a]aresample=48000[abase]`];
    const mixLabels: string[] = ["[abase]"];
    audible.forEach(({ o, data }, k) => {
      inputs.push({ name: `oa_${k}.mp4`, data });
      args.push("-i", `oa_${k}.mp4`);
      const vol = (o.volume ?? 0).toFixed(2);
      const delayMs = Math.round(o.startTimeSec * 1000);
      const lbl = `[oa_${k}]`;
      chains.push(`[${k + 1}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${vol},adelay=${delayMs}|${delayMs}${lbl}`);
      mixLabels.push(lbl);
    });
    // duration=first keeps the output as long as the base; normalize=0 stops amix
    // from ducking every track by the input count when they don't overlap.
    chains.push(`${mixLabels.join("")}amix=inputs=${mixLabels.length}:duration=first:normalize=0[aout]`);
    args.push(
      "-filter_complex", chains.join(";"),
      "-map", "0:v:0", "-map", "[aout]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "final.mp4",
    );
    const withAudio = await runIsolated(inputs, args, "final.mp4", (f) => onProgress?.(0.8 + f * 0.2));
    onProgress?.(1.0);
    return withAudio;
  } catch (err) {
    console.warn("Overlay audio mix failed (a clip likely has no audio track); keeping overlay video without its audio.", err);
    onProgress?.(1.0);
    return composited;
  }
}

export async function exportCut(
  cut: Cut,
  clips: Clip[],
  opts: ExportOptions,
  onProgress?: (fraction: number) => void,
): Promise<ExportResult> {
  const clipById = new Map(clips.map((c) => [c.id, c]));
  const [w, h] = canvasDims(cut.aspect);
  const fontsize = Math.round(Math.max(24, h * 0.045) * (opts.captionScale ?? 1));
  const bgOpacity = Math.min(1, Math.max(0, opts.captionBgOpacity ?? 0.5));
  const lineHeight = opts.captionLineHeight ?? 1.6;
  const margin = Math.round(h * 0.07);

  const qualityKey = opts.exportQuality ?? EDITOR_DEFAULTS.DEFAULT_EXPORT_QUALITY;
  const profile = EDITOR_DEFAULTS.EXPORT_QUALITY_PROFILES[qualityKey] ?? EDITOR_DEFAULTS.EXPORT_QUALITY_PROFILES.high;
  const { preset, crf, audioBitrate } = profile;

  // Render every beat's segment, up to exportConcurrency() at once. Each runs in
  // its own isolated engine, so parallelizing is safe; this overlaps both the
  // Render every beat's segment, up to exportConcurrency() at once. Each runs in
  // its own isolated engine, so parallelizing is safe; this overlaps both the
  // per-beat voiceover (TTS) waits and the ffmpeg encodes. Segments/timings are
  // written into fixed slots so the concat below stays in beat order regardless
  // of which finishes first.
  const n = cut.beats.length;
  const segSlots: (Uint8Array | null)[] = new Array(n).fill(null);
  const timingSlots: (BeatTiming | null)[] = new Array(n).fill(null);
  const prog = new Array<number>(n).fill(0);
  const reportBeatProg = () => onProgress?.((prog.reduce((a, x) => a + x, 0) / n) * 0.55);

  await runPool(cut.beats, exportConcurrency(), async (b, i) => {
    const clip = clipById.get(b.clipId);
    if (!clip) { prog[i] = 1; reportBeatProg(); return; }
    const data = await bytesOf(clip.normalized ?? clip.file);
    const clipDur = clip.durationSec || b.outSec - b.inSec;

    const capLines = b.captionText.split("\n").map((l) => l.trim()).filter(Boolean);
    const schedule = captionSchedule(b.captionText, b.captionDurations);
    const inputs: EngineInput[] = [{ name: sourceName(clip), data }];
    // Captions are rendered by the shared canvas renderer (ADR-0008): one
    // full-frame PNG per cue, collected here and overlaid (time-gated) below —
    // no more drawtext. Each cue's PNG becomes ffmpeg input 1..N.
    const captionCues: { enable: string }[] = [];
    const addCaption = async (text: string, enable: string) => {
      if (!text.trim()) return;
      const png = await renderCaptionToPng({ text, fontSizePx: fontsize, bgOpacity, lineHeight, marginPx: margin }, w, h);
      if (png) {
        inputs.push({ name: `cap_${captionCues.length}.png`, data: png });
        captionCues.push({ enable });
      }
    };
    const vf = [
      "setpts=PTS-STARTPTS",
      `scale=${w}:${h}:force_original_aspect_ratio=decrease`,
      `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`,
      "setsar=1",
      ...ffmpegColorFilters(b.colorAdjustments, cut.globalFilterId, cut.globalFilterIntensity, cut.globalFilterAdjustments),
    ];

    const inSec = Math.min(Math.max(0, b.inSec), Math.max(0, clipDur - 0.1));
    const footageLen = Math.min(Math.max(0.1, b.outSec - b.inSec), Math.max(0.1, clipDur - inSec));
    let playFootage = footageLen;
    let segDur = footageLen;
    let audioInput: string[];
    // Silence prepended before non-schedule voiceover so it eases in after the
    // lead-in; folded into the filter_complex below. Schedule-path leads are
    // already baked into voall.wav, so this stays 0 there.
    let voiceLeadMs = 0;

    const voOn = !!opts.voiceover && (capLines.length > 0 || b.scriptText.trim() !== "");

    if (schedule) {
      const cues = schedule.cues;
      playFootage = footageLen;
      // Only extend the segment past the footage when voiceover is on and needs
      // time to finish narrating. Without VO, the footage plays at its natural
      // length — captions still appear (enable-gated) but don't freeze the last
      // frame just for the schedule's lead/tail buffers.
      if (voOn) {
        segDur = Math.max(footageLen, schedule.total);
        const freeze = segDur - footageLen;
        if (freeze > 0.01) vf.push(`tpad=stop_duration=${freeze.toFixed(3)}:stop_mode=clone`);
      } else {
        segDur = footageLen;
      }

      for (const cue of cues) {
        await addCaption(cue.text, `between(t,${cue.start.toFixed(3)},${cue.end.toFixed(3)})`);
      }

      if (voOn) {
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
        inputs.push({ name: "vo.wav", data: voall });
        audioInput = ["-i", "vo.wav"];
      } else {
        audioInput = ["-f", "lavfi", "-t", String(segDur), "-i", "anullsrc=r=48000:cl=stereo"];
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
      const freeze = segDur - footageLen;
      if (freeze > 0.01) vf.push(`tpad=stop_duration=${freeze.toFixed(3)}:stop_mode=clone`);

      if (capLines.length > 0) {
        for (const t of timed) {
          const enable = timed.length > 1 ? `between(t,${(lead + t.start).toFixed(3)},${(lead + t.end).toFixed(3)})` : "";
          await addCaption(t.text, enable);
        }
      }

      if (timed.length === 1) {
        inputs.push({ name: `vo.${timed[0].vo.ext}`, data: timed[0].vo.data });
        audioInput = ["-i", `vo.${timed[0].vo.ext}`];
      } else {
        const catInputs = timed.map((t, k) => ({ name: `p${k}.${t.vo.ext}`, data: t.vo.data }));
        const catArgs = timed.flatMap((t, k) => ["-i", `p${k}.${t.vo.ext}`]);
        const filt =
          timed.map((_, k) => `[${k}:a]aformat=sample_rates=48000:channel_layouts=stereo[a${k}]`).join(";") + ";" +
          timed.map((_, k) => `[a${k}]`).join("") + `concat=n=${timed.length}:v=0:a=1[a]`;
        const voall = await runIsolated(catInputs, [...catArgs, "-filter_complex", filt, "-map", "[a]", "voall.wav"], "voall.wav");
        inputs.push({ name: "vo.wav", data: voall });
        audioInput = ["-i", "vo.wav"];
      }
      voiceLeadMs = Math.round(lead * 1000);
    } else {
      if (capLines.length > 0) await addCaption(b.captionText, "");
      audioInput = [];
    }
    timingSlots[i] = { id: b.id, inSec, outSec: inSec + playFootage, durationSec: segDur };

    const beatVol = (b.volume ?? 1);
    // Audio source per beat: voiceover when narrating; otherwise the beat's own
    // footage audio at beat volume (matching the preview's v.volume=beat.volume);
    // silence when the beat is muted (volume 0).
    const strategy: "vo" | "source" | "silent" = voOn ? "vo" : beatVol > 0 ? "source" : "silent";

    // Caption PNGs are ffmpeg inputs 1..capCount (looped to segDur so `-shortest`
    // and framesync never truncate on a single still); the audio input follows at
    // index audioIdx. Overlay each caption on the filtered base, time-gated.
    const capCount = captionCues.length;
    const audioIdx = 1 + capCount;
    let videoFilterString: string;
    if (capCount === 0) {
      videoFilterString = `[0:v]${vf.join(",")}[v]`;
    } else {
      const chains = [`[0:v]${vf.join(",")}[vbase]`];
      let last = "[vbase]";
      captionCues.forEach((c, k) => {
        const out = k === capCount - 1 ? "[v]" : `[vcap${k}]`;
        const en = c.enable ? `:enable='${c.enable}'` : "";
        chains.push(`${last}[${k + 1}:v]overlay=x=0:y=0:eof_action=pass${en}${out}`);
        last = out;
      });
      videoFilterString = chains.join(";");
    }
    const leadPrefix = voiceLeadMs > 0 ? `adelay=${voiceLeadMs}|${voiceLeadMs},` : "";

    // Build the seg args for a given audio strategy so we can fall back to silence
    // if a "source" clip turns out to have no audio track (a bare [0:a] reference
    // would make ffmpeg error otherwise).
    // Pin every strategy's audio to exactly segDur: apad extends short audio, then
    // atrim clips it to length. This avoids an unbounded apad stream + -shortest,
    // which can make the muxer fail to finalize the segment.
    const segDurStr = segDur.toFixed(3);
    const capInputArgs = captionCues.flatMap((_, k) => ["-loop", "1", "-t", segDurStr, "-r", "30", "-i", `cap_${k}.png`]);
    const buildSegArgs = (strat: "vo" | "source" | "silent"): string[] => {
      let audioInputArgs: string[];
      let audioFilterString: string;
      if (strat === "vo") {
        audioInputArgs = audioInput;
        audioFilterString = `[${audioIdx}:a]aformat=sample_rates=48000:channel_layouts=stereo,${leadPrefix}apad,atrim=0:${segDurStr},asetpts=PTS-STARTPTS[a]`;
      } else if (strat === "source") {
        // The footage's own audio ([0:a]) at beat volume, over any caption freeze.
        audioInputArgs = [];
        audioFilterString = `[0:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${beatVol.toFixed(2)},apad,atrim=0:${segDurStr},asetpts=PTS-STARTPTS[a]`;
      } else {
        audioInputArgs = ["-f", "lavfi", "-t", segDurStr, "-i", "anullsrc=r=48000:cl=stereo"];
        audioFilterString = `[${audioIdx}:a]aformat=sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS[a]`;
      }
      return ["-ss", String(inSec), "-t", String(playFootage), "-i", sourceName(clip),
        ...capInputArgs,
        ...audioInputArgs,
        "-filter_complex", `${videoFilterString};${audioFilterString}`,
        "-map", "[v]", "-map", "[a]",
        "-shortest",
        "-r", "30", "-c:v", "libx264", "-preset", preset, "-crf", String(crf), "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", audioBitrate, "-ar", "48000", "-ac", "2", "seg.mp4"];
    };

    const renderSeg = (strat: "vo" | "source" | "silent") =>
      runIsolated(inputs, buildSegArgs(strat), "seg.mp4", (f) => { prog[i] = f; reportBeatProg(); });

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
    reportBeatProg();
  });

  onProgress?.(0.60);

  // Drop any skipped beats (missing clip), preserving beat order.
  const timings: BeatTiming[] = timingSlots.filter((t): t is BeatTiming => t !== null);
  const segments: Uint8Array[] = segSlots.filter((s): s is Uint8Array => s !== null);

  const activeBeats = cut.beats.filter((b) => clips.some((c) => c.id === b.clipId));

  // Check if any beats have active custom transitions
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
      (f) => onProgress?.(0.60 + f * 0.12),
    );
  } else {
    // Concat (stream copy) → the finished video with silent audio.
    const concatInputs: EngineInput[] = segments.map((data, i) => ({ name: `seg_${i}.mp4`, data }));
    concatInputs.push({ name: "concat.txt", data: new TextEncoder().encode(segments.map((_, i) => `file 'seg_${i}.mp4'`).join("\n")) });
    video = await runIsolated(concatInputs, ["-f", "concat", "-safe", "0", "-i", "concat.txt", "-c", "copy", "video.mp4"], "video.mp4");
  }

  onProgress?.(0.72);

  // Handle intro fade at video start (Beat 0)
  const firstBeat = activeBeats[0];
  if (firstBeat?.transition && firstBeat.transition !== "none" && (firstBeat.transitionPosition ?? "start") === "start") {
    const fTr = firstBeat.transition;
    const fSec = Math.min(1.0, firstBeat.transitionSec ?? 0.5);
    if (fTr === "fadeblack" || fTr === "fade") {
      video = await runIsolated(
        [{ name: "in.mp4", data: video }],
        ["-i", "in.mp4", "-map", "0:v:0", "-map", "0:a:0?", "-vf", `fade=t=in:st=0:d=${fSec.toFixed(2)}`, "-c:v", "libx264", "-preset", preset, "-crf", String(crf), "-pix_fmt", "yuv420p", "-c:a", "copy", "start_faded.mp4"],
        "start_faded.mp4",
      );
    }
  }

  // Handle outro fade at video end (Last Beat)
  const lastBeat = activeBeats[activeBeats.length - 1];
  if (lastBeat?.transition && lastBeat.transition !== "none" && lastBeat.transitionPosition === "end") {
    const lTr = lastBeat.transition;
    const lSec = Math.min(1.0, lastBeat.transitionSec ?? 0.5);
    const totalVideoDur = timings.reduce((sum, t) => sum + t.durationSec, 0);
    if (lTr === "fadeblack" || lTr === "fade") {
      const fadeStart = Math.max(0, totalVideoDur - lSec).toFixed(3);
      video = await runIsolated(
        [{ name: "in.mp4", data: video }],
        ["-i", "in.mp4", "-map", "0:v:0", "-map", "0:a:0?", "-vf", `fade=t=out:st=${fadeStart}:d=${lSec.toFixed(2)}`, "-c:v", "libx264", "-preset", preset, "-crf", String(crf), "-pix_fmt", "yuv420p", "-c:a", "copy", "end_faded.mp4"],
        "end_faded.mp4",
      );
    }
  }

  onProgress?.(0.80);

  // Burn the title overlay over the concatenated video (re-encode video, copy audio).
  if (opts.title && opts.title.layers.some((l) => l.enabled && l.text.trim())) {
    const titleDur = timings.reduce((sum, t) => sum + t.durationSec, 0);
    const { filterGraph, inputs, inputArgs, outputMap } = await buildTitleFilterGraph(opts.title, w, h, titleDur);
    // filterGraph is empty only if every layer failed to render (e.g. no canvas);
    // skip the stage rather than feed ffmpeg an empty -filter_complex.
    if (filterGraph) {
      video = await runIsolated(
        [{ name: "in.mp4", data: video }, ...inputs],
        [...inputArgs, "-filter_complex", filterGraph, "-map", outputMap, "-map", "0:a:0?", "-c:v", "libx264", "-preset", preset, "-crf", String(crf), "-pix_fmt", "yuv420p", "-c:a", "copy", "titled.mp4"],
        "titled.mp4",
        (f) => onProgress?.(0.80 + f * 0.08),
      );
    }
  }

  onProgress?.(0.88);

  // Composite global overlay clips (B-roll & blend transitions) if any
  if (cut.overlays && cut.overlays.length > 0) {
    video = await applyOverlaysToVideo(
      video,
      cut.overlays,
      clips,
      w,
      h,
      preset,
      crf,
      timings.reduce((sum, t) => sum + t.durationSec, 0),
      (f) => onProgress?.(0.88 + f * 0.07),
    );
  }

  onProgress?.(0.95);

  if (!opts.music) {
    onProgress?.(1.0);
    return { blob: new Blob([new Uint8Array(video)], { type: "video/mp4" }), timings };
  }

  const mExt = opts.music.name.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? "mp3";
  const vol = Math.min(1, Math.max(0, opts.musicVolume ?? 0.5));
  const musicInputs = [
    { name: "video.mp4", data: video },
    { name: `music.${mExt}`, data: await bytesOf(opts.music) },
  ];
  const muxWith = (args: string[]) =>
    runIsolated(musicInputs, args, "final.mp4", (f) => onProgress?.(0.95 + f * 0.05));

  // Amix the video's existing audio (voiceover AND/OR overlay audio) under the
  // music bed. A silent base amixes to just music, so this is safe with no
  // voiceover — and it stops the music stage from dropping overlay audio.
  const amixArgs =
    ["-i", "video.mp4", "-stream_loop", "-1", "-i", `music.${mExt}`,
     "-filter_complex", `[1:a]volume=${vol}[m];[0:a][m]amix=inputs=2:duration=first:normalize=0[a]`,
     "-map", "0:v:0", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-shortest", "final.mp4"];
  // Fallback if the base has no audio stream at all ([0:a] won't resolve): a
  // music-only track, so the export still completes instead of crashing.
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
  onProgress?.(1.0);
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
