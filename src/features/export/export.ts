import type { Clip, Cut, Aspect, OverlayClip } from "../../domain/types";
import { runIsolated, multithreadReady, type EngineInput } from "../../lib/ffmpegEngine";
import { runPool } from "../../lib/pool";
import { synthesizeVoiceover, type TtsEngine } from "../../lib/tts";
import type { Voice } from "../../lib/kokoroTts";
import { captionSchedule } from "../../lib/pacing";
import { ffmpegColorFilters } from "../../studio/util";

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
  /** TTF bytes for burned-in captions (fetched from /caption-font.ttf). */
  fontBytes: Uint8Array;
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

export function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function renderTitleLayerPng(
  layer: TitleLayer,
  w: number,
  h: number
): Promise<Uint8Array | null> {
  if (typeof document === "undefined") return null;
  const curvature = layer.arcDeg ?? 0;
  if (!layer.enabled || !layer.text.trim() || curvature === 0) return null;

  try {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const fontSize = layer.sizePx;
    const hOffset = (curvature / 180) * (h * 0.45);
    const svgW = w;
    const svgH = h;
    const startY = h / 2 + hOffset * 0.4;
    const controlY = h / 2 - hOffset;
    const pathD = `M 40,${startY} Q ${svgW / 2},${controlY} ${svgW - 40},${startY}`;
    const pathId = `arc_${layer.id}_${Math.random().toString(36).slice(2, 6)}`;

    const fontFam = layer.fontCssFamily || "system-ui, sans-serif";
    const shadowFilter = layer.shadow !== false ? 'filter="drop-shadow(2px 2px 4px rgba(0,0,0,0.7))"' : "";
    const letterSpace = layer.letterSpacing ? `letter-spacing="${layer.letterSpacing}px"` : "";

    const svgString = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${svgW} ${svgH}">
        <defs>
          <path id="${pathId}" d="${pathD}" fill="none" />
        </defs>
        <text fill="${layer.color}" font-weight="${layer.weight ?? 400}" font-family="${fontFam.replace(/"/g, "'")}" font-size="${fontSize}px" ${letterSpace} ${shadowFilter}>
          <textPath href="#${pathId}" startOffset="50%" text-anchor="middle">
            ${escapeXml(layer.text)}
          </textPath>
        </text>
      </svg>
    `;

    const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const img = new Image();

    await new Promise((resolve) => {
      img.onload = resolve;
      img.onerror = resolve;
      img.src = url;
    });

    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);

    return new Promise((resolve) => {
      canvas.toBlob((b) => {
        if (!b) return resolve(null);
        b.arrayBuffer().then((buf) => resolve(new Uint8Array(buf))).catch(() => resolve(null));
      }, "image/png");
    });
  } catch {
    return null;
  }
}

/** Build drawtext and overlay filters for stacked title layers. */
async function buildTitleFilterGraph(
  title: TitleOverlay,
  w: number,
  h: number,
  defaultFontBytes: Uint8Array
): Promise<{ filterGraph: string; inputs: EngineInput[]; inputArgs: string[]; outputMap: string }> {
  const activeLayers = title.layers.filter((l) => l.enabled && l.text.trim());
  const inputs: EngineInput[] = [];
  const inputArgs: string[] = ["-i", "in.mp4"];
  const filterChains: string[] = [];

  let lastV = "[0:v]";
  let inputIndex = 1;

  for (let k = 0; k < activeLayers.length; k++) {
    const l = activeLayers[k];
    const dur = l.introSec ?? 3;
    const fade = Math.min(0.8, dur / 2);
    const fadeStart = (dur - fade).toFixed(3);
    const nextV = k === activeLayers.length - 1 ? "[titled_v]" : `[v_title_${k}]`;

    if (l.arcDeg && l.arcDeg !== 0) {
      const pngData = await renderTitleLayerPng(l, w, h);
      if (pngData) {
        const pngName = `title_curved_${k}.png`;
        inputs.push({ name: pngName, data: pngData });
        inputArgs.push("-i", pngName);

        const xOffset = Math.round(w * (l.posX / 100));
        const yOffset = Math.round(h * (l.posY / 100));
        const x = `(W-w)/2+${xOffset}`;
        const y = `(H-h)/2+${yOffset}`;
        const currPngIdx = inputIndex++;

        if (l.scope === "intro") {
          const fadeLabel = `[ol_fade_${k}]`;
          filterChains.push(`[${currPngIdx}:v]fade=t=out:st=${fadeStart}:d=${fade.toFixed(2)}:alpha=1${fadeLabel}`);
          filterChains.push(`${lastV}${fadeLabel}overlay=x=${x}:y=${y}:enable='between(t,0,${dur})'${nextV}`);
        } else {
          filterChains.push(`${lastV}[${currPngIdx}:v]overlay=x=${x}:y=${y}${nextV}`);
        }
        lastV = nextV;
        continue;
      }
    }

    const fontName = `title_font_${k}.ttf`;
    const textName = `title_text_${k}.txt`;
    inputs.push({ name: fontName, data: l.fontBytes ?? defaultFontBytes });
    inputs.push({ name: textName, data: new TextEncoder().encode(wrapCaption(l.text, w, l.sizePx)) });

    const xOffset = Math.round(w * (l.posX / 100));
    const yOffset = Math.round(h * (l.posY / 100));
    const color = "0x" + l.color.replace(/^#/, "");
    const tracking = l.letterSpacing ? `:tracking=${Math.round(l.letterSpacing)}` : "";
    const shadowFilter = l.shadow !== false ? ":shadowcolor=black@0.5:shadowx=2:shadowy=2" : "";

    const anim = l.animation ?? "none";
    const animDur = (l.animDurationSec ?? 0.5).toFixed(2);
    let xExpr = `(w-text_w)/2+${xOffset}`;
    let yExpr = `(h-text_h)/2+${yOffset}`;

    if (anim === "slide_left") {
      xExpr = `(w-text_w)/2+${xOffset}+if(lt(t,${animDur}),(1-t/${animDur})*-250,0)`;
    } else if (anim === "slide_bottom") {
      yExpr = `(h-text_h)/2+${yOffset}+if(lt(t,${animDur}),(1-t/${animDur})*150,0)`;
    } else if (anim === "slide_top") {
      yExpr = `(h-text_h)/2+${yOffset}+if(lt(t,${animDur}),(1-t/${animDur})*-150,0)`;
    } else if (anim === "pop") {
      yExpr = `(h-text_h)/2+${yOffset}+if(lt(t,${animDur}),(1-t/${animDur})*35,0)`;
    }

    let alphaExpr = "1";
    const needsIntroFade = anim === "fade" || anim === "pop" || anim === "slide_left" || anim === "slide_bottom" || anim === "slide_top";

    if (l.scope === "intro") {
      if (needsIntroFade) {
        alphaExpr = `if(lt(t,${animDur}),t/${animDur},if(lt(t,${fadeStart}),1,if(lt(t,${dur}),(${dur}-t)/${fade},0)))`;
      } else {
        alphaExpr = `if(lt(t,${fadeStart}),1,if(lt(t,${dur}),(${dur}-t)/${fade},0))`;
      }
    } else {
      if (needsIntroFade) {
        alphaExpr = `if(lt(t,${animDur}),t/${animDur},1)`;
      }
    }

    const alphaParam = alphaExpr !== "1" ? `:alpha='${alphaExpr}'` : "";
    const enableParam = l.scope === "intro" ? `:enable='between(t,0,${dur})'` : "";

    const drawFilter =
      `drawtext=fontfile=/${fontName}:textfile=/${textName}:expansion=none:` +
      `fontcolor=${color}:fontsize=${Math.round(l.sizePx)}${tracking}${shadowFilter}:` +
      `x=${xExpr}:y=${yExpr}${alphaParam}${enableParam}`;

    filterChains.push(`${lastV}${drawFilter}${nextV}`);
    lastV = nextV;
  }

  return {
    filterGraph: filterChains.join(";"),
    inputs,
    inputArgs,
    outputMap: lastV,
  };
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

// Centered captions: drawtext left-aligns the lines within a multi-line block
// (no reliable per-line centering in this ffmpeg-core), so render ONE drawtext
// per wrapped line, each independently centered (x=(w-text_w)/2) and stacked
// bottom-up. Each line gets its own text file to sidestep escaping.
function captionLayers(
  text: string,
  w: number,
  h: number,
  fontsize: number,
  bgOpacity: number,
  border: number,
  margin: number,
  lineHeight: number,
  tag = "",
  enable = "",
): { files: EngineInput[]; filters: string[] } {
  // Wrap the caption to fit the frame; long text becomes several visual rows,
  // stacked bottom-up. `enable` (e.g. ":enable='between(t,a,b)'") time-gates them.
  const lines = text.trim() ? wrapCaption(text.replace(/\n/g, " "), w, fontsize).split("\n") : [];
  const lineH = Math.round(fontsize * lineHeight);
  const files: EngineInput[] = [];
  const filters: string[] = [];
  lines.forEach((ln, i) => {
    const name = `cap_${tag}${i}.txt`;
    files.push({ name, data: new TextEncoder().encode(ln) });
    const y = h - margin - (lines.length - i) * lineH;
    filters.push(
      `drawtext=fontfile=/font.ttf:textfile=/${name}:expansion=none:` +
        `fontcolor=white:fontsize=${fontsize}:box=1:boxcolor=black@${bgOpacity}:boxborderw=${border}:` +
        `x=(w-text_w)/2:y=${y}${enable}`,
    );
  });
  return { files, filters };
}

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
): Promise<Uint8Array> {
  const activeOverlays = overlays.filter((o) => clips.some((c) => c.id === o.clipId));
  if (activeOverlays.length === 0) return videoBytes;

  let currentVideo = videoBytes;

  for (let idx = 0; idx < activeOverlays.length; idx++) {
    const o = activeOverlays[idx];
    const clip = clips.find((c) => c.id === o.clipId);
    if (!clip) continue;

    const overlayData = await bytesOf(clip.normalized ?? clip.file);
    const ovName = `overlay_${idx}.mp4`;
    const st = o.startTimeSec.toFixed(3);
    const dur = o.durationSec.toFixed(3);
    const inS = o.inSec.toFixed(3);

    const mode = o.blendMode ?? "normal";
    const op = (o.opacity ?? 1).toFixed(2);

    let filterGraph = "";
    if (mode === "screen") {
      filterGraph =
        `[1:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1[ov];` +
        `[0:v][ov]blend=all_mode=screen:all_opacity=${op}:enable='between(t,${st},${st}+${dur})'[v]`;
    } else if (mode === "multiply") {
      filterGraph =
        `[1:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1[ov];` +
        `[0:v][ov]blend=all_mode=multiply:all_opacity=${op}:enable='between(t,${st},${st}+${dur})'[v]`;
    } else if (mode === "overlay") {
      filterGraph =
        `[1:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1[ov];` +
        `[0:v][ov]blend=all_mode=overlay:all_opacity=${op}:enable='between(t,${st},${st}+${dur})'[v]`;
    } else {
      filterGraph =
        `[1:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=rgba,colorchannelmixer=aa=${op}[ov];` +
        `[0:v][ov]overlay=x=0:y=0:enable='between(t,${st},${st}+${dur})'[v]`;
    }

    currentVideo = await runIsolated(
      [
        { name: "in.mp4", data: currentVideo },
        { name: ovName, data: overlayData },
      ],
      [
        "-i", "in.mp4",
        "-ss", inS, "-t", dur, "-i", ovName,
        "-filter_complex", filterGraph,
        "-map", "[v]", "-map", "0:a:0?",
        "-c:v", "libx264", "-preset", preset, "-crf", String(crf), "-pix_fmt", "yuv420p",
        "-c:a", "copy",
        "overlaid.mp4",
      ],
      "overlaid.mp4",
    );
  }

  return currentVideo;
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
  const border = Math.round(fontsize * 0.3);
  const lineHeight = opts.captionLineHeight ?? 1.6;
  const margin = Math.round(h * 0.07);

  const qualityKey = opts.exportQuality ?? EDITOR_DEFAULTS.DEFAULT_EXPORT_QUALITY;
  const profile = EDITOR_DEFAULTS.EXPORT_QUALITY_PROFILES[qualityKey] ?? EDITOR_DEFAULTS.EXPORT_QUALITY_PROFILES.high;
  const { preset, crf, audioBitrate } = profile;

  // Render every beat's segment, up to exportConcurrency() at once. Each runs in
  // its own isolated engine, so parallelizing is safe; this overlaps both the
  // per-beat voiceover (TTS) waits and the ffmpeg encodes. Segments/timings are
  // written into fixed slots so the concat below stays in beat order regardless
  // of which finishes first.
  const n = cut.beats.length;
  const segSlots: (Uint8Array | null)[] = new Array(n).fill(null);
  const timingSlots: (BeatTiming | null)[] = new Array(n).fill(null);
  const prog = new Array<number>(n).fill(0);
  const scale = opts.music ? 0.9 : 1;
  const report = () => onProgress?.((prog.reduce((a, x) => a + x, 0) / n) * scale);

  await runPool(cut.beats, exportConcurrency(), async (b, i) => {
    const clip = clipById.get(b.clipId);
    if (!clip) { prog[i] = 1; report(); return; }
    const data = await bytesOf(clip.normalized ?? clip.file);
    const clipDur = clip.durationSec || b.outSec - b.inSec;

    const capLines = b.captionText.split("\n").map((l) => l.trim()).filter(Boolean);
    // Author-set per-line timers (opt-in): when present the caption lines play in
    // sequence and the timer sum is the segment's clock. Otherwise, null → today's
    // stacked / voiceover-driven paths below run unchanged.
    const schedule = captionSchedule(b.captionText, b.captionDurations);
    const inputs: EngineInput[] = [
      { name: sourceName(clip), data },
      { name: "font.ttf", data: opts.fontBytes },
    ];
    const vf = [
      `scale=${w}:${h}:force_original_aspect_ratio=decrease`,
      `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`,
      "setsar=1",
      ...ffmpegColorFilters(b.colorAdjustments, cut.globalFilterId, cut.globalFilterIntensity),
    ];

    const inSec = Math.min(Math.max(0, b.inSec), Math.max(0, clipDur - 0.1));
    const footageLen = Math.min(Math.max(0.1, b.outSec - b.inSec), Math.max(0.1, clipDur - inSec));
    let playFootage = footageLen; // footage actually played before any freeze tail
    let segDur = footageLen; // total on-screen length of the segment
    let audioInput: string[];
    let audioFilter: string[];

    const voOn = !!opts.voiceover && (capLines.length > 0 || b.scriptText.trim() !== "");

    if (schedule) {
      // Timed captions sequence OVER the manually-trimmed footage — they never cut
      // it short. The full trim window always plays; the caption lines (with their
      // silent lead-in / tail) run on top. The beat lasts as long as the longer of
      // the two: if the caption sequence outlasts the footage, the last frame
      // freezes to cover the overflow (see the "past the footage" indicator).
      const cues = schedule.cues;
      playFootage = footageLen; // respect the manual trim — always play the whole window
      segDur = Math.max(footageLen, schedule.total);
      const freeze = segDur - footageLen;
      if (freeze > 0.01) vf.push(`tpad=stop_duration=${freeze.toFixed(3)}:stop_mode=clone`);

      cues.forEach((cue, k) => {
        const enable = `:enable='between(t,${cue.start.toFixed(3)},${cue.end.toFixed(3)})'`;
        const c = captionLayers(cue.text, w, h, fontsize, bgOpacity, border, margin, lineHeight, `l${k}_`, enable);
        inputs.push(...c.files);
        vf.push(...c.filters);
      });

      if (voOn) {
        // One narration per line, each padded with silence / cut to fit its own
        // timer, concatenated, then delayed by the lead-in — so the spoken track
        // lands under each line's window. Author timers win, so narration bends to
        // them, not the reverse. The tail silence comes from apad below.
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
        audioFilter = ["-af", "aresample=48000,apad"];
      } else {
        audioInput = ["-f", "lavfi", "-t", String(segDur), "-i", "anullsrc=r=48000:cl=stereo"];
        audioFilter = [];
      }
    } else if (voOn) {
      const lead = Math.max(0, opts.voiceoverLeadSec ?? 0); // silence before the voice
      const gap = Math.max(0, opts.voiceoverGapSec ?? 0); // silence after the voice
      const ttsOpts = { engine: opts.ttsEngine ?? "kokoro", voice: opts.voice, elevenVoiceId: opts.elevenVoiceId, speed: opts.voiceoverSpeed };
      // One narration per caption line, read in sequence. Each line's caption
      // shows ONLY during its own narration (appears, then disappears before the
      // next). A single line shows for the whole beat. No caption lines → narrate
      // the script as one line, no on-screen text.
      const lineTexts = capLines.length > 0 ? capLines : [b.scriptText.trim()];
      const vos = await Promise.all(lineTexts.map((t) => synthesizeVoiceover(t, ttsOpts)));
      let cursor = 0;
      const timed = vos.map((vo, k) => {
        const d = vo.durationSec > 0 ? vo.durationSec : 1.5;
        const s = cursor; cursor += d;
        return { start: s, end: cursor, vo, text: lineTexts[k] };
      });
      // Narration sits at [lead, lead+cursor]; the tail gap follows. The beat lasts
      // the longer of the footage or the buffered narration.
      segDur = Math.max(footageLen, lead + cursor) + gap; // cursor = total narration length
      const freeze = segDur - footageLen;
      if (freeze > 0.01) vf.push(`tpad=stop_duration=${freeze.toFixed(3)}:stop_mode=clone`);

      if (capLines.length > 0) {
        timed.forEach((t, k) => {
          // Caption windows follow the (lead-delayed) narration.
          const enable = timed.length > 1 ? `:enable='between(t,${(lead + t.start).toFixed(3)},${(lead + t.end).toFixed(3)})'` : "";
          const c = captionLayers(t.text, w, h, fontsize, bgOpacity, border, margin, lineHeight, `l${k}_`, enable);
          inputs.push(...c.files);
          vf.push(...c.filters);
        });
      }

      // Beat audio = the line narrations concatenated in order.
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
      // Delay the whole narration by the lead-in; apad fills the trailing gap to
      // segDur. adelay is a no-op when lead is 0.
      const leadMs = Math.round(lead * 1000);
      audioFilter = ["-af", `${leadMs > 0 ? `adelay=${leadMs}|${leadMs},` : ""}aresample=48000,apad`];
    } else {
      if (capLines.length > 0) {
        const c = captionLayers(b.captionText, w, h, fontsize, bgOpacity, border, margin, lineHeight);
        inputs.push(...c.files);
        vf.push(...c.filters);
      }
      audioInput = [];
      audioFilter = [];
    }
    timingSlots[i] = { id: b.id, inSec, outSec: inSec + playFootage, durationSec: segDur };

    const beatVol = (b.volume ?? 1);
    const audioParams = voOn
      ? [...audioInput, "-map", "0:v:0", "-map", "1:a:0", ...audioFilter]
      : ["-map", "0:v:0", "-map", "0:a:0?", "-af", `volume=${beatVol.toFixed(2)},aresample=48000,apad`];

    segSlots[i] = await runIsolated(
      inputs,
      ["-ss", String(inSec), "-t", String(playFootage), "-i", sourceName(clip),
       ...audioParams,
       "-vf", vf.join(","),
       "-r", "30", "-c:v", "libx264", "-preset", preset, "-crf", String(crf), "-pix_fmt", "yuv420p",
       "-c:a", "aac", "-b:a", audioBitrate, "-ar", "48000", "-ac", "2", "seg.mp4"],
      "seg.mp4",
      (f) => { prog[i] = f; report(); },
    );
    prog[i] = 1;
    report();
  });

  // Drop any skipped beats (missing clip), preserving beat order.
  const timings: BeatTiming[] = timingSlots.filter((t): t is BeatTiming => t !== null);
  const segments: Uint8Array[] = segSlots.filter((s): s is Uint8Array => s !== null);

  const activeBeats = cut.beats.filter((b) => clips.some((c) => c.id === b.clipId));

  // Check if any beats have active transitions
  const hasTransitions = activeBeats.some((b) => b.transition && b.transition !== "none");
  let video: Uint8Array;

  if (hasTransitions && segments.length > 1) {
    const inputs: EngineInput[] = segments.map((data, i) => ({ name: `seg_${i}.mp4`, data }));
    const ffmpegArgs: string[] = [];
    segments.forEach((_, i) => ffmpegArgs.push("-i", `seg_${i}.mp4`));

    let filterGraph = "";
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

      // If no transition specified for this beat boundary, use 0.1s quick fade (3 frames at 30fps)
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

      const aIn1 = i === 0 ? "[0:a]" : `[a${i}]`;
      const aIn2 = `[${i + 1}:a]`;
      const aOut = i === segments.length - 2 ? "[a]" : `[a${i + 1}]`;

      filterGraph += `${vIn1}${vIn2}xfade=transition=${finalTr}:duration=${dur.toFixed(2)}:offset=${Math.max(0, currentOffset).toFixed(2)}${vOut};`;
      filterGraph += `${aIn1}${aIn2}acrossfade=d=${dur.toFixed(2)}${aOut}${i < segments.length - 2 ? ";" : ""}`;
    }

    video = await runIsolated(
      inputs,
      [...ffmpegArgs, "-filter_complex", filterGraph, "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", preset, "-crf", String(crf), "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", audioBitrate, "video.mp4"],
      "video.mp4",
    );
  } else {
    // Concat (stream copy) → the finished video with silent audio.
    const concatInputs: EngineInput[] = segments.map((data, i) => ({ name: `seg_${i}.mp4`, data }));
    concatInputs.push({ name: "concat.txt", data: new TextEncoder().encode(segments.map((_, i) => `file 'seg_${i}.mp4'`).join("\n")) });
    video = await runIsolated(concatInputs, ["-f", "concat", "-safe", "0", "-i", "concat.txt", "-c", "copy", "video.mp4"], "video.mp4");
  }

  // Handle intro fade at video start (Beat 0)
  const firstBeat = activeBeats[0];
  if (firstBeat?.transition && firstBeat.transition !== "none" && (firstBeat.transitionPosition ?? "start") === "start") {
    const fTr = firstBeat.transition;
    const fSec = Math.min(1.0, firstBeat.transitionSec ?? 0.5);
    if (fTr === "fadeblack" || fTr === "fade") {
      video = await runIsolated(
        [{ name: "in.mp4", data: video }],
        ["-i", "in.mp4", "-vf", `fade=t=in:st=0:d=${fSec.toFixed(2)}`, "-c:v", "libx264", "-preset", preset, "-crf", String(crf), "-pix_fmt", "yuv420p", "-c:a", "copy", "start_faded.mp4"],
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
        ["-i", "in.mp4", "-vf", `fade=t=out:st=${fadeStart}:d=${lSec.toFixed(2)}`, "-c:v", "libx264", "-preset", preset, "-crf", String(crf), "-pix_fmt", "yuv420p", "-c:a", "copy", "end_faded.mp4"],
        "end_faded.mp4",
      );
    }
  }

  // Burn the title overlay over the concatenated video (re-encode video, copy
  // audio). Runs before the music mux so the title survives the stream-copy there.
  if (opts.title && opts.title.layers.some((l) => l.enabled && l.text.trim())) {
    const { filterGraph, inputs, inputArgs, outputMap } = await buildTitleFilterGraph(opts.title, w, h, opts.fontBytes);
    video = await runIsolated(
      [{ name: "in.mp4", data: video }, ...inputs],
      [...inputArgs, "-filter_complex", filterGraph, "-map", outputMap, "-map", "0:a:0?", "-c:v", "libx264", "-preset", preset, "-crf", String(crf), "-pix_fmt", "yuv420p", "-c:a", "copy", "titled.mp4"],
      "titled.mp4",
    );
  }

  // Composite global overlay clips (B-roll & blend transitions) if any
  if (cut.overlays && cut.overlays.length > 0) {
    video = await applyOverlaysToVideo(video, cut.overlays, clips, w, h, preset, crf);
  }

  if (!opts.music) {
    onProgress?.(1);
    return { blob: new Blob([new Uint8Array(video)], { type: "video/mp4" }), timings };
  }

  // Lay the music bed over the whole video (loop to cover, trim to video length).
  // With voiceover the video already carries narration, so DUCK the music under
  // it (amix normalize=0 keeps the VO at full level); otherwise the video audio
  // is silence and the music simply becomes the track.
  const mExt = opts.music.name.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? "mp3";
  const vol = Math.min(1, Math.max(0, opts.musicVolume ?? 0.5));
  const musicArgs = opts.voiceover
    ? ["-i", "video.mp4", "-stream_loop", "-1", "-i", `music.${mExt}`,
       "-filter_complex", `[1:a]volume=${vol}[m];[0:a][m]amix=inputs=2:duration=first:normalize=0[a]`,
       "-map", "0:v:0", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-shortest", "final.mp4"]
    : ["-i", "video.mp4", "-stream_loop", "-1", "-i", `music.${mExt}`,
       "-filter_complex", `[1:a]volume=${vol}[a]`,
       "-map", "0:v:0", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-shortest", "final.mp4"];
  const withMusic = await runIsolated(
    [{ name: "video.mp4", data: video }, { name: `music.${mExt}`, data: await bytesOf(opts.music) }],
    musicArgs,
    "final.mp4",
  );
  onProgress?.(1);
  return { blob: new Blob([withMusic], { type: "video/mp4" }), timings };
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
