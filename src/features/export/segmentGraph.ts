/**
 * Segment Graph module (ADR-0016).
 *
 * A Segment is one Beat rendered to `seg_N.mp4`. This module owns:
 *   - input ordering for every Layer composited onto that Segment,
 *   - input-index assignment,
 *   - label naming, and
 *   - which stage emits `[v]`.
 *
 * The base chain (Zoom, Ken Burns, rotation, Grade) is NOT a Layer and is NOT
 * managed here. The caller supplies `baseLabel` — the label the base chain
 * emitted — and `inputIndexBase` — the first free ffmpeg input index after the
 * caller's own inputs. The module appends its inputs starting there.
 *
 * Interface:
 *   buildSegmentGraph(layers, opts) → { inputs, inputArgs, chains, inputCount, lastLabel }
 *
 * `inputCount` is the number of video inputs the module added. The caller uses
 * it to place the audio input at `inputIndexBase + inputCount`.
 */

import type { EngineInput } from "../../lib/ffmpegEngine";
import type { OverlayClip } from "../../domain/types";
import { overlayVisual } from "../../domain/overlayClip";

// ---------------------------------------------------------------------------
// Layer Specs
// ---------------------------------------------------------------------------

export interface CaptionLayerSpec {
  kind: "caption";
  /** Filename inside the engine FS (e.g. `cap_0.png`). */
  pngName: string;
  /** Raw PNG bytes. */
  png: Uint8Array;
  /**
   * ffmpeg `enable` expression, e.g. `between(t,0.000,3.000)`.
   * Empty string = always visible (no enable gate).
   */
  enable: string;
}

export interface TitleLayerSpec {
  kind: "title";
  maskMode?: "none" | "video";
  /** Filename inside the engine FS (e.g. `title_seg_0.png`). */
  pngName: string;
  /** Raw PNG bytes. */
  png: Uint8Array;
  /**
   * Fade filter expressions to apply to the PNG before compositing
   * (e.g. `fade=t=in:st=0:d=0.500:alpha=1`). Empty array = no animation.
   */
  fadeParts: string[];
  /** x position expression for the overlay filter (e.g. `"0"` or a motion expr). */
  xExpr: string;
  /** y position expression for the overlay filter. */
  yExpr: string;
  /**
   * Enable expression fragment **including the leading colon**,
   * e.g. `:enable='between(t,0,3)'`. Empty string = no time gate (always visible).
   */
  enable: string;
}

export interface OverlayLayerSpec {
  kind: "overlay";
  /** Video filename inside the engine FS (e.g. `ov_seg_0.mp4`). */
  mp4Name: string;
  /** Raw MP4 bytes. */
  mp4: Uint8Array;
  /** Overlay clip domain object (for blendMode, opacity, startTimeSec). */
  overlayClip: OverlayClip;
  /** Local start time offset in segment seconds. */
  stLocalSec: number;
  /** Local duration in segment seconds. */
  durLocalSec: number;
  /** Beat start timestamp in overall video (bStart). */
  bStart: number;
  /** Segment duration in seconds (segDur). */
  segDur: number;
  /** Video resolution width. */
  w: number;
  /** Video resolution height. */
  h: number;
}

export interface StickerLayerSpec {
  kind: "sticker";
  /** Filename inside the engine FS (e.g. `sticker_0.png`). */
  pngName: string;
  /** Raw PNG bytes. */
  png: Uint8Array;
  /** ffmpeg `enable` expression, e.g. `between(t,0.500,2.500)`. */
  enable: string;
}

export interface LedMatrixLayerSpec {
  kind: "ledMatrix";
  pngName: string;
  png: Uint8Array;
}

export type LayerSpec = CaptionLayerSpec | TitleLayerSpec | OverlayLayerSpec | StickerLayerSpec | LedMatrixLayerSpec;

// ---------------------------------------------------------------------------
// Options & Result
// ---------------------------------------------------------------------------

export interface SegmentGraphOptions {
  /**
   * The first ffmpeg input index the module may use.
   * The caller owns indices 0..(inputIndexBase-1).
   */
  inputIndexBase: number;
  /**
   * The label the base chain (or last inline layer) already emitted.
   * The module's first chain reads from this label.
   */
  baseLabel: string;
  /**
   * Segment duration string, used for the `-t` arg of looped inputs (e.g. "4.000").
   */
  segDurStr: string;
  /**
   * RGB pixel format for the blend path (e.g. "gbrp"), or null for yuv420p.
   */
  rgbFormat: string | null;
  /**
   * When false, the module's last chain emits its natural intermediate label
   * instead of `[v]`.
   * @deprecated Optional transition flag; defaults to true.
   */
  terminal?: boolean;
}

export interface SegmentGraphResult {
  /** EngineInput entries to append to the caller's `inputs` array. */
  inputs: EngineInput[];
  /** ffmpeg argv fragment for each Layer's input. */
  inputArgs: string[];
  /** Filter chain strings to append to the caller's chain list. */
  chains: string[];
  /** Number of video inputs added by the module. */
  inputCount: number;
  /** The label the module's last chain emitted. `[v]` when chains is non-empty. */
  lastLabel: string;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export function buildSegmentGraph(
  layers: LayerSpec[],
  opts: SegmentGraphOptions,
): SegmentGraphResult {
  const { inputIndexBase, baseLabel, segDurStr, rgbFormat } = opts;
  const terminal = opts.terminal !== false;

  if (layers.length === 0) {
    return { inputs: [], inputArgs: [], chains: [], inputCount: 0, lastLabel: baseLabel };
  }

  const inputs: EngineInput[] = [];
  const inputArgs: string[] = [];
  const chains: string[] = [];
  let nextIdx = inputIndexBase;
  let prev = baseLabel;

  let capIdx = 0;
  let titleIdx = 0;
  let overlayIdx = 0;
  let stickerIdx = 0;
  let ledMatrixIdx = 0;

  const totalStickers = layers.filter((l) => l.kind === "sticker").length;

  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    const isLast = i === layers.length - 1;

    if (layer.kind === "ledMatrix") {
      const k = ledMatrixIdx++;
      const out = isLast ? (terminal ? "[v]" : `[vled_${k}]`) : `[vled_${k}]`;
      const texture = `[led_texture_${k}]`;
      inputs.push({ name: layer.pngName, data: layer.png });
      inputArgs.push("-loop", "1", "-t", segDurStr, "-r", "30", "-i", layer.pngName);
      chains.push(`[${nextIdx}:v]format=rgba${texture}`);
      chains.push(`${prev}${texture}overlay=x=0:y=0:eof_action=pass${out}`);
      nextIdx++;
      prev = out;
    }

    if (layer.kind === "caption") {
      const k = capIdx++;
      const out = isLast ? (terminal ? "[v]" : `[vcap_${k}]`) : `[vcap_${k}]`;
      const en = layer.enable ? `:enable='${layer.enable}'` : "";
      inputs.push({ name: layer.pngName, data: layer.png });
      inputArgs.push("-loop", "1", "-t", segDurStr, "-r", "30", "-i", layer.pngName);
      chains.push(`${prev}[${nextIdx}:v]overlay=x=0:y=0:eof_action=pass${en}${out}`);
      nextIdx++;
      prev = out;
    }

    if (layer.kind === "title") {
      const k = titleIdx++;
      const out = isLast ? (terminal ? "[v]" : `[vtitle_${k}]`) : `[vtitle_${k}]`;
      const ovLabel = `[ovt_${k}]`;
      const head = `[${nextIdx}:v]format=rgba`;
      inputs.push({ name: layer.pngName, data: layer.png });
      inputArgs.push("-loop", "1", "-t", segDurStr, "-r", "30", "-i", layer.pngName);
      if (layer.fadeParts.length > 0) {
        chains.push(`${head},${layer.fadeParts.join(",")}${ovLabel}`);
      } else {
        chains.push(`${head}${ovLabel}`);
      }
      chains.push(`${prev}${ovLabel}overlay=x='${layer.xExpr}':y='${layer.yExpr}':eof_action=pass${layer.enable}${out}`);
      nextIdx++;
      prev = out;
    }

    if (layer.kind === "overlay") {
      const k = overlayIdx++;
      const isOverlayTerminal = totalStickers === 0;
      const out = (isLast && isOverlayTerminal)
        ? (rgbFormat ? `[vout_raw_${k}]` : (terminal ? "[v]" : `[voverlay_${k}]`))
        : `[voverlay_${k}]`;

      const { overlayClip, stLocalSec, durLocalSec, bStart, segDur, w, h } = layer;
      const visual = overlayVisual(overlayClip);
      const isPip = visual.layoutMode === "pip";
      const mode = isPip ? "normal" : (overlayClip.blendMode ?? "normal");
      const op = (overlayClip.opacity ?? 1).toFixed(3);
      const stSec = stLocalSec;
      const dur = durLocalSec;
      const boxW = isPip ? Math.max(2, Math.round(w * visual.width / 2) * 2) : w;
      const boxH = isPip ? Math.max(2, Math.round(h * visual.height / 2) * 2) : h;
      const overlayX = isPip ? Math.round((visual.x - visual.width / 2) * w) : 0;
      const overlayY = isPip ? Math.round((visual.y - visual.height / 2) * h) : 0;
      const scaleF = visual.fit === "cover" && isPip
        ? `scale=${boxW}:${boxH}:force_original_aspect_ratio=increase,crop=${boxW}:${boxH}`
        : `scale=${boxW}:${boxH}:force_original_aspect_ratio=decrease`;
      const padF = visual.fit === "cover" && isPip
        ? ""
        : isPip
          ? `,format=rgba,pad=${boxW}:${boxH}:(ow-iw)/2:(oh-ih)/2:color=black@0.0`
          : `,pad=${boxW}:${boxH}:(ow-iw)/2:(oh-ih)/2:color=black@0.0`;
      const radiusPx = isPip ? Math.round(Math.min(boxW, boxH) * visual.cornerRadius) : 0;
      const roundedF = radiusPx > 0
        ? `,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lte(hypot(max(0,${radiusPx}-min(X,W-1-X)),max(0,${radiusPx}-min(Y,H-1-Y))),${radiusPx}),alpha(X,Y),0)'`
        : "";

      const beatIntoOverlay = Math.max(0, bStart - overlayClip.startTimeSec);
      const seekStart = beatIntoOverlay.toFixed(3);
      const seekEnd = (beatIntoOverlay + dur).toFixed(3);
      const stStr = stSec.toFixed(3);
      const trailDur = Math.max(0, segDur - stSec - dur);
      const trailStr = trailDur.toFixed(3);

      inputs.push({ name: layer.mp4Name, data: layer.mp4 });
      inputArgs.push("-i", layer.mp4Name);

      if (mode === "normal") {
        const concatParts: string[] = [];

        if (stSec > 0.001) {
          const lbl = `[ov_lead_${k}]`;
          chains.push(`color=c=black@0.0:s=${boxW}x${boxH}:r=30:d=${stStr},format=rgba${lbl}`);
          concatParts.push(lbl);
        }

        const contLbl = `[ov_cont_${k}]`;
        chains.push(
          `[${nextIdx}:v]trim=start=${seekStart}:end=${seekEnd},setpts=PTS-STARTPTS,` +
          `${scaleF}${padF},setsar=1,` +
          `format=rgba,colorchannelmixer=aa=${op}${roundedF}${contLbl}`
        );
        concatParts.push(contLbl);

        if (trailDur > 0.001) {
          const lbl = `[ov_trail_${k}]`;
          chains.push(`color=c=black@0.0:s=${boxW}x${boxH}:r=30:d=${trailStr},format=rgba${lbl}`);
          concatParts.push(lbl);
        }

        let ovFull: string;
        if (concatParts.length > 1) {
          ovFull = `[ov_full_${k}]`;
          chains.push(`${concatParts.join("")}concat=n=${concatParts.length}:v=1:a=0${ovFull}`);
        } else {
          ovFull = concatParts[0];
        }

        chains.push(`${prev}${ovFull}overlay=x=${overlayX}:y=${overlayY}:eof_action=pass${out}`);

      } else {
        const neutralColor = mode === "multiply" ? "white" : mode === "overlay" ? "0x808080" : "black";
        const pixFmt = rgbFormat ?? "yuv420p";
        const concatParts: string[] = [];

        if (stSec > 0.001) {
          const lbl = `[ov_lead_${k}]`;
          chains.push(`color=c=${neutralColor}:s=${w}x${h}:r=30:d=${stStr},format=${pixFmt}${lbl}`);
          concatParts.push(lbl);
        }

        const contLbl = `[ov_cont_${k}]`;
        chains.push(
          `[${nextIdx}:v]trim=start=${seekStart}:end=${seekEnd},setpts=PTS-STARTPTS,` +
          `${scaleF},pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=${neutralColor},setsar=1,format=${pixFmt}${contLbl}`
        );
        concatParts.push(contLbl);

        if (trailDur > 0.001) {
          const lbl = `[ov_trail_${k}]`;
          chains.push(`color=c=${neutralColor}:s=${w}x${h}:r=30:d=${trailStr},format=${pixFmt}${lbl}`);
          concatParts.push(lbl);
        }

        let ovFull: string;
        if (concatParts.length > 1) {
          ovFull = `[ov_full_${k}]`;
          chains.push(`${concatParts.join("")}concat=n=${concatParts.length}:v=1:a=0${ovFull}`);
        } else {
          ovFull = concatParts[0];
        }

        if (rgbFormat) {
          const base = `[base_${k}]`;
          chains.push(`${prev}format=${rgbFormat}${base}`);
          chains.push(`${base}${ovFull}blend=all_mode=${mode}:all_opacity=${op}${out}`);
        } else {
          chains.push(`${prev}${ovFull}blend=all_mode=${mode}:all_opacity=${op}${out}`);
        }
      }

      nextIdx++;
      prev = out;

      const isLastOverlay = i === layers.length - 1 || layers[i + 1].kind !== "overlay";
      if (rgbFormat && isLastOverlay) {
        const rgbOut = (totalStickers === 0 && terminal) ? "[v]" : "[vrgbout]";
        chains.push(`${prev}format=yuv420p${rgbOut}`);
        prev = rgbOut;
      }
    }

    if (layer.kind === "sticker") {
      const k = stickerIdx++;
      const out = isLast ? (terminal ? "[v]" : `[vsticker_${k}]`) : `[vsticker_${k}]`;
      const en = layer.enable ? `:enable='${layer.enable}'` : "";
      inputs.push({ name: layer.pngName, data: layer.png });
      inputArgs.push("-loop", "1", "-t", segDurStr, "-r", "30", "-i", layer.pngName);
      chains.push(`${prev}[${nextIdx}:v]overlay=x=0:y=0:eof_action=pass${en}${out}`);
      nextIdx++;
      prev = out;
    }
  }

  return {
    inputs,
    inputArgs,
    chains,
    inputCount: nextIdx - inputIndexBase,
    lastLabel: prev,
  };
}
