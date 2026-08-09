import type { Aspect, Beat, ColorAdjustments, Clip, Cover, CoverTitle, Cut } from "../../domain/types";
import { makeBeatTitleLayers } from "../../state/ExportSettingsContext";
import { resolveGrade } from "../../lib/grade";
import { imageFrameBlob, probeStill, probeVideo, videoFrameBlob } from "../../lib/frameSampler";
import { isStillFile, prepareStillFile } from "../ingest/ingest";
import { kenBurnsAt } from "../../studio/util";
import { canvasDims } from "../export/export";
import { drawSplitScreenToCanvas, slotSourceTime } from "./splitScreenFrame";

// The two doors into a Cover (ADR-0021). They differ only in where the pixels
// come from and what they seed; everything past this module treats the results
// as one thing, because origin is not modelled.
//
// The seeding half is pure and takes the decoded frame as an argument, so the
// arithmetic is testable without a decoder — the canvas cannot be asserted in
// this project's default `node` test environment.

/**
 * The stored picture's long-edge cap.
 *
 * The largest canvas is 1920px on its long edge and Zoom reaches 3×, so full
 * per-pixel sharpness at maximum punch-in would want 5760. 3840 holds it to 2×
 * and softens only at the extreme, for a quarter of the bytes: uncapped, a
 * 12-megapixel phone upload puts 5–10MB into every autosave.
 */
export const COVER_MAX_EDGE = 3840;

/** JPEG quality for the stored picture. High enough that the cap, not the
 *  encoder, is what limits the Cover. */
export const COVER_FRAME_QUALITY = 0.95;

/** The stored picture's dimensions: the source, with its long edge capped. */
export function fitCoverFrame(width: number, height: number): { width: number; height: number } {
  const w = Number.isFinite(width) && width > 0 ? width : 1;
  const h = Number.isFinite(height) && height > 0 ? height : 1;
  const longest = Math.max(w, h);
  const scale = longest > COVER_MAX_EDGE ? COVER_MAX_EDGE / longest : 1;
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

/** Provenance for the author's eye. Never resolved back into a Beat. */
export function capturedLabel(beatIndex: number, atSec: number): string {
  const t = Number.isFinite(atSec) ? Math.max(0, atSec) : 0;
  return `Beat ${beatIndex + 1} @ ${t.toFixed(1)}s`;
}

/**
 * The Beat's framing at one instant.
 *
 * A Ken Burns Beat has no static `zoom` to copy — its framing travels, which is
 * the whole point of it (ADR-0015) — so the position is evaluated at the moment
 * being captured. Without this, capturing from the Beats that most need a Cover
 * (a Still, whose only motion IS the Ken Burns) would silently seed 1×.
 */
export function framingAt(
  beat: Beat,
  atSec: number,
): { zoom: number; zoomX: number; zoomY: number; rotation: number } {
  if (beat.framing === "kenBurns" && beat.kenBurns) {
    const span = beat.outSec - beat.inSec;
    const t01 = span > 0 ? (atSec - beat.inSec) / span : 0;
    const at = kenBurnsAt(beat.kenBurns, t01);
    return { zoom: at.scale, zoomX: at.x, zoomY: at.y, rotation: beat.rotation ?? 0 };
  }
  return { zoom: beat.zoom ?? 1, zoomX: beat.zoomX ?? 0, zoomY: beat.zoomY ?? 0, rotation: beat.rotation ?? 0 };
}

interface CoverSeed {
  frame: File;
  sourceLabel: string;
  aspect: Aspect;
  zoom: number;
  zoomX: number;
  zoomY: number;
  rotation: number;
  grade: ColorAdjustments;
}

/**
 * The three empty Title layers a Cover starts with — the same ladder a Beat
 * gets, minus the timing fields a still has no use for. Without them the shared
 * title editor has no layer to render and shows nothing at all.
 */
export function makeCoverTitles(): CoverTitle[] {
  return makeBeatTitleLayers().map(
    ({ scope: _s, introSec: _i, startSec: _st, durationSec: _d, fadeOut: _f,
       animation: _a, animDurationSec: _ad, typewriterCursor: _t, ...rest }, i) =>
      ({ ...rest, id: `cover-layer-${i + 1}` }),
  );
}

function newCover(seed: CoverSeed): Cover {
  return { id: crypto.randomUUID(), ...seed, stickers: [], titles: makeCoverTitles() };
}

/**
 * A Cover seeded from a Beat: it looks like the video did, because it inherits
 * the Beat's framing and the Beat's Grade flattened with the Cut's Look.
 * Flattened once — a Cover never follows a later re-grade (ADR-0021).
 */
export function seedCapturedCover(args: {
  beat: Beat;
  cut: Cut;
  beatIndex: number;
  atSec: number;
  frame: File;
}): Cover {
  const { beat, cut, beatIndex, atSec, frame } = args;
  return newCover({
    frame,
    sourceLabel: capturedLabel(beatIndex, atSec),
    aspect: cut.aspect,
    ...framingAt(beat, atSec),
    grade: resolveGrade(
      beat.colorAdjustments,
      cut.globalFilterAdjustments,
      cut.globalFilterIntensity ?? 1,
    ),
  });
}

/**
 * A Cover seeded from a file the Author supplied. Neutral grade: this is not the
 * footage, and a Look built to correct one camera is as likely to hurt an
 * unrelated photo as help it. Aspect still comes from the Cut, because a Cover's
 * aspect is an output-format decision rather than a property of the input.
 */
export function seedUploadedCover(args: { frame: File; fileName: string; cut: Cut }): Cover {
  return newCover({
    frame: args.frame,
    sourceLabel: args.fileName,
    aspect: args.cut.aspect,
    zoom: 1,
    zoomX: 0,
    zoomY: 0,
    rotation: 0,
    grade: {},
  });
}

// ---------------------------------------------------------------------------
// The impure half: decode, cap, encode. Thin by design — every decision above
// it is a pure function with its own test.
// ---------------------------------------------------------------------------

async function cappedFrame(source: Blob, isStill: boolean, atSec: number, name: string): Promise<File> {
  const meta = isStill ? await probeStill(source) : await probeVideo(source);
  const { width, height } = fitCoverFrame(meta.width, meta.height);
  const blob = isStill
    ? await imageFrameBlob(source, width, height, COVER_FRAME_QUALITY)
    : await videoFrameBlob(source, atSec, width, height, COVER_FRAME_QUALITY);
  return new File([blob], name, { type: "image/jpeg" });
}

/** True when a Beat's picture is a composite of several clips rather than one. */
export function isSplitBeat(beat: Beat): boolean {
  return !!beat.splitScreen && beat.splitScreen.layout !== "none" && beat.splitScreen.slots.length > 1;
}

/**
 * A split-screen Beat's picture, composited once into a flat frame.
 *
 * It happens here rather than in `renderCover` because a Cover keeps its pixels
 * (ADR-0021) — by render time there is no layout left, only a picture. The
 * consequence is that a split capture is stored at canvas dimensions rather than
 * source resolution, so it has less zoom headroom than a single-clip capture.
 */
async function splitFrame(beat: Beat, clips: Clip[], cut: Cut, atSec: number): Promise<File> {
  const config = beat.splitScreen!;
  const [w, h] = canvasDims(cut.aspect);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d canvas context");

  const sources = await Promise.all(
    config.slots.map(async (slot) => {
      const clip = clips.find((c) => c.id === slot.clipId);
      if (!clip?.file) return undefined;
      const still = clip.kind === "still";
      const meta = still ? await probeStill(clip.file) : await probeVideo(clip.file);
      const at = slotSourceTime(slot.inSec, beat.inSec, atSec);
      const blob = still
        ? await imageFrameBlob(clip.file, meta.width, meta.height, COVER_FRAME_QUALITY)
        : await videoFrameBlob(clip.file, at, meta.width, meta.height, COVER_FRAME_QUALITY);
      return { image: await createImageBitmap(blob), width: meta.width, height: meta.height };
    }),
  );

  drawSplitScreenToCanvas(ctx, config.layout, config.slots, sources, w, h);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("canvas encode failed"))),
      "image/jpeg",
      COVER_FRAME_QUALITY,
    );
  });
  return new File([blob], "cover-frame.jpg", { type: "image/jpeg" });
}

/** Capture the frame a Beat is showing at `atSec` and seed a Cover from it. */
export async function captureCover(args: {
  beat: Beat;
  clip: Clip;
  clips: Clip[];
  cut: Cut;
  beatIndex: number;
  atSec: number;
}): Promise<Cover> {
  const { beat, clip, clips, cut, beatIndex, atSec } = args;
  const frame = isSplitBeat(beat)
    ? await splitFrame(beat, clips, cut, atSec)
    : await cappedFrame(clip.file, clip.kind === "still", atSec, "cover-frame.jpg");
  return seedCapturedCover({ beat, cut, beatIndex, atSec, frame });
}

/** Take a file the Author supplied and seed a Cover from it. */
export async function uploadCover(args: { file: File; cut: Cut }): Promise<Cover> {
  const { file, cut } = args;
  if (!isStillFile(file)) throw new Error(`${file.name} is not an image`);
  const source = await prepareStillFile(file);
  const frame = await cappedFrame(source, true, 0, source.name);
  return seedUploadedCover({ frame, fileName: file.name, cut });
}
