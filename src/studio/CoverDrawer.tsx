import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Aspect, ColorAdjustments, Cover } from "../domain/types";
import { useProject } from "../state/ProjectContext";
import { canvasDims } from "../features/export/export";
import { renderCover } from "../features/cover/renderCover";
import { uploadCover } from "../features/cover/coverSource";
import {
  aspectResolutionLabel,
  coverBlob,
  coverFileName,
  exceedsYouTubeLimit,
  formatCoverSize,
  type CoverFormat,
} from "../features/cover/coverExport";
import { COVER_FILE_ACCEPT } from "../features/ingest/ingest";
import Drawer from "../design-system/Drawer";
import SegmentedControl from "../design-system/SegmentedControl";
import RangeField from "../design-system/RangeField";
import Button from "../design-system/Button";
import FileDropzone from "../design-system/FileDropzone";
import { ControlButton } from "../design-system/ControlPrimitives";
import TitleTreatmentEditor from "../features/export/TitleTreatmentEditor";
import type { TitleLayerSettings } from "../state/ExportSettingsContext";
import VeilEditor from "./VeilEditor";
import StickerPicker from "./StickerPicker";
import StickerAppearance from "./StickerCard";

// The Cover gallery and editor. The canvas on screen is the same renderCover
// call the download uses (ADR-0021), so there is no preview/export gap here —
// only a size difference, and a proof canvas while a slider is moving.

/**
 * Long edge of the on-screen proof; the download always renders full size.
 *
 * Sized against the canvas's 68vh display cap rather than the source: large
 * enough to look sharp there, small enough that the per-pixel Grade pass stays
 * interactive while a slider moves. Full resolution would be ~2M `gradePixel`
 * calls per tick.
 */
const PROOF_MAX_EDGE = 900;

const ASPECTS: { value: Aspect; label: string }[] = [
  { value: "16:9", label: "16:9" },
  { value: "9:16", label: "9:16" },
  { value: "1:1", label: "1:1" },
  { value: "4:5", label: "4:5" },
];

const FORMATS = [
  { value: "jpeg" as const, label: "JPEG" },
  { value: "png" as const, label: "PNG" },
];

/** The Grade axes worth having on a still. The full set lives on a Beat. */
const GRADE_AXES: { key: keyof ColorAdjustments; label: string }[] = [
  { key: "exposure", label: "Exposure" },
  { key: "contrast", label: "Contrast" },
  { key: "saturation", label: "Saturation" },
  { key: "warmth", label: "Warmth" },
  { key: "shadows", label: "Shadows" },
  { key: "highlights", label: "Highlights" },
];

/** The compact name · slider · value row (DESIGN_PATTERNS §2), via the shared field. */
function SliderRow({
  label, value, min, max, step = 1, format, onChange,
}: {
  label: string; value: number; min: number; max: number; step?: number;
  format?: (n: number) => string; onChange: (n: number) => void;
}) {
  return (
    <RangeField
      label={label}
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={onChange}
      formatValue={format ?? ((n) => (n > 0 ? `+${n}` : String(n)))}
    />
  );
}

/** Decode a Cover's stored picture once per File. */
function useCoverImage(frame: File | undefined) {
  const [state, setState] = useState<{ image: ImageBitmap; width: number; height: number } | null>(null);
  useEffect(() => {
    if (!frame) { setState(null); return; }
    let live = true;
    let created: ImageBitmap | null = null;
    createImageBitmap(frame)
      .then((image) => {
        created = image;
        if (live) setState({ image, width: image.width, height: image.height });
        else image.close();
      })
      .catch(() => { if (live) setState(null); });
    return () => { live = false; created?.close(); };
  }, [frame]);
  return state;
}

export default function CoverDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, dispatch } = useProject();
  const covers = useMemo(() => state.covers ?? [], [state.covers]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [format, setFormat] = useState<CoverFormat>("jpeg");
  const [size, setSize] = useState<number | null>(null);
  const [pickingSticker, setPickingSticker] = useState(false);
  /** Whether the sticker picker was open when the current press began. */
  const pickerWasOpen = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const selected = covers.find((c) => c.id === selectedId) ?? covers[0];
  const picture = useCoverImage(selected?.frame);

  useEffect(() => {
    if (!selectedId && covers.length) setSelectedId(covers[0].id);
  }, [covers, selectedId]);

  const update = useCallback((next: Cover) => dispatch({ type: "UPDATE_COVER", cover: next }), [dispatch]);

  /** Render at an explicit size. The one path — the download uses it too. */
  const paint = useCallback(async (cover: Cover, canvas: HTMLCanvasElement, longEdge?: number) => {
    const [fullW, fullH] = canvasDims(cover.aspect);
    const scale = longEdge ? Math.min(1, longEdge / Math.max(fullW, fullH)) : 1;
    const w = Math.max(1, Math.round(fullW * scale));
    const h = Math.max(1, Math.round(fullH * scale));
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx || !picture) return;
    await renderCover(ctx, cover, picture.image, picture.width, picture.height, w, h);
  }, [picture]);

  // Repaint the proof whenever the Cover or its decoded picture changes.
  useEffect(() => {
    if (!selected || !picture || !canvasRef.current) return;
    let live = true;
    (async () => {
      if (live && canvasRef.current) await paint(selected, canvasRef.current, PROOF_MAX_EDGE);
    })();
    return () => { live = false; };
  }, [selected, picture, paint]);

  // Full-resolution size readout, debounced. The proof's byte count would clear
  // 2MB while the real file did not, which is worse than showing nothing.
  useEffect(() => {
    if (!selected || !picture) { setSize(null); return; }
    let live = true;
    const timer = setTimeout(async () => {
      const canvas = document.createElement("canvas");
      await paint(selected, canvas, undefined);
      try {
        const blob = await coverBlob(canvas, format);
        if (live) setSize(blob.size);
      } catch { if (live) setSize(null); }
    }, 400);
    return () => { live = false; clearTimeout(timer); };
  }, [selected, picture, format, paint]);

  async function onUpload(files: File[]) {
    const file = files[0];
    if (!file || !state.cut) return;
    setBusy(true);
    setError(null);
    try {
      const cover = await uploadCover({ file, cut: state.cut });
      dispatch({ type: "ADD_COVER", cover });
      setSelectedId(cover.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that image");
    } finally {
      setBusy(false);
    }
  }

  async function onDownload() {
    if (!selected) return;
    setBusy(true);
    try {
      const canvas = document.createElement("canvas");
      await paint(selected, canvas, undefined);
      const blob = await coverBlob(canvas, format);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = coverFileName(state.title, covers.indexOf(selected), format);
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not export that cover");
    } finally {
      setBusy(false);
    }
  }

  const grade = selected?.grade ?? {};
  const setGrade = (key: keyof ColorAdjustments, value: number) => {
    if (!selected) return;
    update({ ...selected, grade: { ...selected.grade, [key]: value } });
  };

  return (
    <Drawer open={open} title="Covers" onClose={onClose} width="full">
      {/* `.ui-drawer-body` ships padding: 0 — every drawer supplies its own. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "16px 20px 28px" }}>
        <p style={{ fontSize: 11, color: "var(--ink-2)", margin: 0, lineHeight: 1.5, maxWidth: 620 }}>
          A cover is a still, dressed to advertise this project. Capture one from a beat
          with the camera button on the preview, or drop an image below.
        </p>

        {/* Gallery */}
        <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
          {covers.map((cover, i) => (
            <ControlButton
              key={cover.id}
              type="button"
              onClick={() => setSelectedId(cover.id)}
              aria-label={`Cover ${i + 1} — ${cover.sourceLabel}`}
              aria-pressed={cover.id === selected?.id}
              style={{
                flex: "0 0 auto", width: 96, padding: 6, borderRadius: 8, cursor: "pointer",
                background: "var(--panel-2)", textAlign: "left", display: "block",
                border: cover.id === selected?.id ? "2px solid var(--accent)" : "1px solid var(--line)",
              }}
            >
              <div style={{ fontSize: 10, color: "var(--ink)", fontWeight: 600 }}>Cover {i + 1}</div>
              <div style={{ fontSize: 9, color: "var(--ink-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {cover.sourceLabel}
              </div>
            </ControlButton>
          ))}
          <div style={{ flex: "0 0 auto", width: 190 }}>
            <FileDropzone
              title="Upload a picture"
              description="JPG, PNG, WebP, AVIF"
              accept={COVER_FILE_ACCEPT}
              disabled={busy || !state.cut}
              onFiles={onUpload}
            />
          </div>
        </div>

        {error && <div style={{ fontSize: 11, color: "var(--danger)" }}>{error}</div>}

        {!selected && (
          <div style={{ fontSize: 12, color: "var(--ink-3)" }}>No covers yet.</div>
        )}

        {selected && (
          <div style={{ display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap" }}>
            {/* The canvas IS the deliverable. Capped in height rather than
                stretched to the column: a 9:16 cover in a full-width drawer is
                16/9 of half the window, which runs off the bottom of the screen.
                max-width/max-height on a replaced element preserve its aspect. */}
            <div style={{ flex: "1 1 320px", minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center" }}>
              <canvas
                ref={canvasRef}
                aria-label={`Cover preview — ${selected.sourceLabel}`}
                style={{
                  maxWidth: "100%", maxHeight: "68vh", width: "auto", height: "auto",
                  borderRadius: 8, background: "#0a0b0d", display: "block",
                }}
              />
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, flexWrap: "wrap", width: "100%", maxWidth: 560 }}>
                <SegmentedControl value={format} options={FORMATS} onChange={setFormat} ariaLabel="Cover file format" />
                <span
                  style={{ fontSize: 11, color: size !== null && exceedsYouTubeLimit(size) ? "var(--danger)" : "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}
                  title={size !== null && exceedsYouTubeLimit(size) ? "Over YouTube's 2 MB thumbnail limit" : undefined}
                >
                  {size === null ? "…" : formatCoverSize(size)}
                  {size !== null && exceedsYouTubeLimit(size) ? " · over YouTube's 2 MB limit" : ""}
                </span>
                <span style={{ marginLeft: "auto" }}>
                  <Button variant="primary" size="small" onClick={onDownload} disabled={busy}>Download</Button>
                </span>
                <ControlButton
                  aria-label="Delete this cover"
                  title="Delete this cover"
                  onClick={() => { dispatch({ type: "REMOVE_COVER", id: selected.id }); setSelectedId(null); }}
                >
                  Delete
                </ControlButton>
              </div>
            </div>

            {/* Controls. Bounded width so the compact name·slider·value rows of
                DESIGN_PATTERNS §2 stay compact — unbounded in a 100vw drawer they
                stretch to ~900px and push the value column off the edge. */}
            <div style={{ flex: "1 1 340px", minWidth: 0, maxWidth: 420, display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: "var(--ink-2)" }}>Aspect</span>
                  <span
                    style={{ fontSize: 10, color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}
                    title="Pixel dimensions this cover exports at"
                  >
                    {aspectResolutionLabel(selected.aspect)}
                  </span>
                </div>
                <SegmentedControl
                  value={selected.aspect}
                  options={ASPECTS}
                  onChange={(aspect) => update({ ...selected, aspect })}
                  ariaLabel="Cover aspect ratio"
                />
              </div>

              <div className="st-color-adjustments" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ fontSize: 11, color: "var(--ink-2)" }}>Framing</div>
                <SliderRow label="Zoom" value={selected.zoom} min={1} max={3} step={0.05}
                  format={(n) => `${n.toFixed(2)}×`} onChange={(zoom) => update({ ...selected, zoom })} />
                <SliderRow label="Pan X" value={selected.zoomX} min={-50} max={50}
                  onChange={(zoomX) => update({ ...selected, zoomX })} />
                <SliderRow label="Pan Y" value={selected.zoomY} min={-50} max={50}
                  onChange={(zoomY) => update({ ...selected, zoomY })} />
                <SliderRow label="Rotation" value={selected.rotation ?? 0} min={-15} max={15} step={0.5}
                  format={(n) => `${n > 0 ? "+" : ""}${n}°`}
                  onChange={(rotation) => update({ ...selected, rotation })} />
              </div>

              <div className="st-color-adjustments" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ fontSize: 11, color: "var(--ink-2)" }}>Colour</div>
                {GRADE_AXES.map(({ key, label }) => (
                  <SliderRow key={key} label={label} value={(grade[key] as number) ?? 0} min={-100} max={100}
                    onChange={(v) => setGrade(key, v)} />
                ))}
              </div>

              <VeilEditor veil={selected.veil} onChange={(veil) => update({ ...selected, veil })} />

              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: "var(--ink-2)" }}>Stickers ({selected.stickers.length})</span>
                  {/* StickerPicker is `position: absolute; top: 100%` and anchors
                      to its nearest positioned ancestor. Without this wrapper it
                      anchors to the fixed drawer instead and lands 6px below the
                      bottom of the whole panel — mounted, and invisible. Timeline
                      wraps its own button the same way. */}
                  <div style={{ position: "relative" }}>
                    {/* The picker dismisses itself on any document pointerdown,
                        including this button's own — so by the time `click` runs
                        it has already closed, and a naive toggle would reopen it.
                        Record the state as the press begins instead. */}
                    <ControlButton
                      aria-label="Add a sticker to this cover"
                      aria-pressed={pickingSticker}
                      onPointerDown={() => { pickerWasOpen.current = pickingSticker; }}
                      onClick={() => setPickingSticker(!pickerWasOpen.current)}
                    >
                      + Sticker
                    </ControlButton>
                    {pickingSticker && (
                      <StickerPicker
                        onClose={() => setPickingSticker(false)}
                        onPick={(fileName) => {
                          update({
                            ...selected,
                            stickers: [...selected.stickers, {
                              id: crypto.randomUUID(), fileName,
                              x: 0.5, y: 0.5, scale: 0.25, rotation: 0, opacity: 1,
                            }],
                          });
                          setPickingSticker(false);
                        }}
                      />
                    )}
                  </div>
                </div>
                {/* The Inspector's Sticker card, minus its timing footer — a
                    Cover is a still, so "fit to beat", start and length have
                    nothing to refer to. */}
                {selected.stickers.map((sticker) => (
                  <div
                    key={sticker.id}
                    className="st-sec"
                    style={{ background: "var(--panel-2)", padding: 12, borderRadius: 8, border: "1px solid rgb(167,139,250)", marginTop: 8 }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "rgb(167,139,250)" }}>🩹 Sticker</span>
                      <ControlButton
                        type="button"
                        className="st-btn ghost"
                        style={{ padding: "2px 8px", fontSize: 11, color: "var(--danger)" }}
                        aria-label={`Remove ${sticker.fileName}`}
                        title="Remove this sticker"
                        onClick={() => update({ ...selected, stickers: selected.stickers.filter((s) => s.id !== sticker.id) })}
                      >
                        Remove
                      </ControlButton>
                    </div>
                    <StickerAppearance
                      sticker={sticker}
                      onChange={(patch) => update({
                        ...selected,
                        stickers: selected.stickers.map((s) => (s.id === sticker.id ? { ...s, ...patch } : s)),
                      })}
                    />
                  </div>
                ))}
              </div>

              <div>
                <div style={{ fontSize: 11, color: "var(--ink-2)", marginBottom: 6 }}>Title</div>
                <TitleTreatmentEditor
                  showTiming={false}
                  layers={selected.titles as unknown as TitleLayerSettings[]}
                  onChange={(next) => update({ ...selected, titles: next as unknown as Cover["titles"] })}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </Drawer>
  );
}
