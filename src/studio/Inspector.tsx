import { useEffect, useRef, useState, useReducer } from "react";
import { useProject } from "../state/ProjectContext";
import { useSettings, toneHint, MODEL_OPTIONS, TONE_OPTIONS } from "../state/SettingsContext";
import type { Aspect, Beat, Clip, ColorAdjustments, KenBurns, VideoTransitionType, SplitLayoutType } from "../domain/types";
import { suggestCaptionAlternatives } from "../features/refine/refine";
import BeatTrimmer from "../features/refine/BeatTrimmer";
import { estimateSpokenSeconds, captionSchedule, scheduleDuration } from "../lib/pacing";
import { cutDuration } from "../features/assemble/assemble";
import { fmtSecs, sliderTrackStyle, cssFilterFor, getFilterPreset, rotationCoverScale, fillMove, KEN_BURNS_PRESETS, KEN_BURNS_DEFAULT } from "./util";
import { normalizeSplitConfig } from "../features/export/splitScreenCanvas";
import { isIdentityGrade } from "../lib/grade";
import { getClipBlobUrl } from "../lib/blobUrlCache";
import SplitClipPickerModal from "./SplitClipPickerModal";




import { stickerFileUrl } from "../lib/stickerLibrary";
import { beatSpans, resolveSticker, resolveSfx } from "../features/export/stickerCanvas";

import FilterPresetModal from "./FilterPresetModal";
import TitleTreatmentEditor from "../features/export/TitleTreatmentEditor";
import ColorField from "./ColorField";
import { makeBeatTitleLayers, useExportSettings, type TitleLayerSettings } from "../state/ExportSettingsContext";
import { canvasDims } from "../features/export/export";
import { synthesizeVoiceover } from "../lib/tts";
import { sfxFileUrl } from "../lib/sfxLibrary";
import Switch from "../design-system/Switch";
import { beatPosterBg } from "../lib/beatPosterCache";
import ClipTagEditor from "./ClipTagEditor";
import Modal from "../design-system/Modal";
import Button from "../design-system/Button";
import { ControlButton, InputControl, SelectControl, TextareaControl } from "../design-system/ControlPrimitives";
import ChevronDownIcon from "../design-system/icons/ChevronDownIcon";
import DeleteIcon from "../design-system/icons/DeleteIcon";
import LockIcon from "../design-system/icons/LockIcon";
import UnlockIcon from "../design-system/icons/UnlockIcon";
import CopyIcon from "../design-system/icons/CopyIcon";
import { collectBeatTitleEntries, updateBeatTitleText } from "./beatTitleIndex";


/** Short label for a model id, e.g. "claude-opus-4-8" → "opus-4-8". */
const modelLabel = (m: string) => m.replace(/^claude-/, "");

// Captions moved to the independent VO track (see VO Segment card + the timeline VO
// lane). The old per-beat caption editor is retired but kept behind this flag so its
// alternates/timed-line machinery stays available if we ever re-surface it.
const SHOW_PER_BEAT_CAPTION_BOX = false;

// ElevenLabs v3 inline "audio tags" — expressive cues the user can drop into the
// narration text to shape delivery. Grouped for the collapsible hints card in the
// VO Segment editor. (These only take effect with the ElevenLabs "v3 — expressive"
// model; other engines/models read them literally.)
const VO_HINT_GROUPS: { title: string; tags: string[]; note?: string }[] = [
  { title: "Laughter & amusement", tags: ["[laughs]", "[laughs harder]", "[starts laughing]", "[chuckles]", "[giggles]", "[wheezing]", "[snorts]", "[mischievously]"] },
  { title: "Emotion / tone", tags: ["[excited]", "[happy]", "[sad]", "[angry]", "[nervous]", "[curious]", "[sarcastic]", "[dramatic]", "[reassuring]", "[regretful]", "[sorrowful]", "[awe]", "[deadpan]"] },
  { title: "Volume & delivery", tags: ["[whispers]", "[shouting]", "[quietly]", "[loudly]", "[slowly]", "[rushed]", "[drawn out]", "[stammers]", "[stutters]"] },
  { title: "Breaths & body sounds", tags: ["[sighs]", "[exhales]", "[gasps]", "[gulps]", "[clears throat]", "[coughs]", "[sniffs]", "[groans]", "[yawns]", "[pants]", "[crying]"] },
  { title: "Pacing", tags: ["[pause]", "[short pause]", "[long pause]"], note: "Plus normal punctuation (…, —, !, ?) also shapes rhythm." },
  { title: "Character / accent (more experimental)", tags: ["[strong French accent]", "[pirate voice]", "[robotic]", "[singing]"], note: "Hit-or-miss depending on the voice." },
];

interface Props {
  beat: Beat | null;
  clip: Clip | undefined;
  clips: Clip[];
  logline: string;
  index: number;
  total: number;
  onSelectBeat?: (beatId: string) => void;
  onDuplicateBeat: (beatId: string) => void;
  selectedOverlayId?: string | null;
  onSelectOverlay?: (id: string | null) => void;
  selectedVoId?: string | null;
  onSelectVo?: (id: string | null) => void;
  selectedSfxId?: string | null;
  selectedStickerId?: string | null;
  onSelectSticker?: (id: string | null) => void;
  onSelectSfx?: (id: string | null) => void;
  onRequestDeleteSegment: (kind: "overlay" | "voiceover" | "sound effect" | "sticker", id: string, label: string) => void;
}




/**
 * The moving-framing controls (ADR-0015): named moves, then the six values
 * underneath them. The presets write the same fields the sliders edit — they
 * are an affordance, not a separate data model — so nothing is lost by nudging
 * a preset afterwards.
 */
function KenBurnsControls({ beat, clip, aspect, update }: {
  beat: Beat; clip: Clip; aspect: Aspect; update: (b: Beat) => void;
}) {
  const move = beat.kenBurns ?? KEN_BURNS_DEFAULT;
  const set = (patch: Partial<KenBurns>) => update({ ...beat, kenBurns: { ...move, ...patch } });
  const [cw, ch] = canvasDims(aspect);
  // Fill is computed per-Still rather than tabled: the scale that just covers
  // depends on THIS photo's aspect (~2.37x for a 3:4 in 16:9).
  const fill = fillMove(clip.width || 1, clip.height || 1, cw, ch);
  const presets = [...KEN_BURNS_PRESETS, { id: "fill", label: "Fill", move: fill }];
  const same = (a: KenBurns, b2: KenBurns) =>
    Math.abs(a.fromScale - b2.fromScale) < 1e-6 && Math.abs(a.toScale - b2.toScale) < 1e-6 &&
    a.fromX === b2.fromX && a.toX === b2.toX && a.fromY === b2.fromY && a.toY === b2.toY;

  const row = (label: string, value: number, min: number, max: number, step: number, fmt: (v: number) => string, key: keyof KenBurns, reset: number) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontSize: 11, width: 70, color: "var(--ink-2)" }}>{label}</span>
      <InputControl
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => set({ [key]: Number(e.target.value) } as Partial<KenBurns>)}
        onDoubleClick={() => set({ [key]: reset } as Partial<KenBurns>)}
        style={sliderTrackStyle(value, min, max)}
      />
      <span style={{ fontSize: 10, width: 34, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>{fmt(value)}</span>
    </div>
  );
  const pct = (v: number) => (v > 0 ? `+${v}` : String(v));
  const zoomFmt = (v: number) => `${v.toFixed(2)}×`;
  // The ceiling is available pixels, not a fixed number — a Fill on a tall
  // photo legitimately needs more than 2x (ADR-0015).
  const maxScale = Math.max(2, Math.ceil(fill.fromScale * 10) / 10);

  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <span style={{ fontSize: 11, width: 70, color: "var(--ink-2)", paddingTop: 4 }}>Move</span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {presets.map((p) => {
            const on = same(move, p.move);
            return (
              <ControlButton
                key={p.id}
                type="button"
                onClick={() => update({ ...beat, kenBurns: p.move })}
                title={p.id === "fill" ? `Fill the frame (${p.move.fromScale.toFixed(2)}× for this photo)` : p.label}
                style={{
                  fontSize: 10, padding: "3px 8px", borderRadius: 6, cursor: "pointer",
                  border: on ? "1px solid var(--accent)" : "1px solid var(--line)",
                  background: on ? "rgba(255, 179, 57, 0.15)" : "var(--panel-3)",
                  color: on ? "var(--accent)" : "var(--ink-2)",
                }}
              >
                {p.label}
              </ControlButton>
            );
          })}
        </div>
      </div>

      <div style={{ fontSize: 10, color: "var(--ink-3)", marginTop: 2 }}>Start</div>
      {row("Scale", move.fromScale, 1, maxScale, 0.01, zoomFmt, "fromScale", 1)}
      {row("Focus X", move.fromX, -50, 50, 1, pct, "fromX", 0)}
      {row("Focus Y", move.fromY, -50, 50, 1, pct, "fromY", 0)}

      <div style={{ fontSize: 10, color: "var(--ink-3)", marginTop: 4 }}>End</div>
      {row("Scale", move.toScale, 1, maxScale, 0.01, zoomFmt, "toScale", 1)}
      {row("Focus X", move.toX, -50, 50, 1, pct, "toX", 0)}
      {row("Focus Y", move.toY, -50, 50, 1, pct, "toY", 0)}

      <div style={{ fontSize: 10, color: "var(--ink-3)", lineHeight: 1.5, marginTop: 2 }}>
        The move always spans the whole Beat, so retrimming makes the same journey
        run faster or slower. Scale 1.00× is the photo fitted to frame, bars and all.
      </div>
    </>
  );
}

export default function Inspector({ beat, clip, clips, logline, index, total, onSelectBeat, onDuplicateBeat, selectedOverlayId, onSelectOverlay, selectedVoId, onSelectVo, selectedSfxId, onSelectSfx, selectedStickerId, onSelectSticker, onRequestDeleteSegment }: Props) {
  const { state, dispatch } = useProject();
  const [, forceUpdate] = useReducer((x) => x + 1, 0);

  const { settings } = useSettings();
  const { settings: es } = useExportSettings();
  const [fitting, setFitting] = useState(false);
  const [fitErr, setFitErr] = useState<string | null>(null);
  const cut = state.cut;
  const overlays = cut?.overlays ?? [];
  const selectedOverlay = overlays.find((o) => o.id === selectedOverlayId);
  const selectedVo = (cut?.voSegments ?? []).find((s) => s.id === selectedVoId);
  const selectedSfx = (cut?.sfxSegments ?? []).find((s) => s.id === selectedSfxId);
  const selectedSticker = (cut?.stickers ?? []).find((s) => s.id === selectedStickerId);
  const clipHasOtherUses = Boolean(beat && cut && (
    cut.beats.some((candidate) =>
      candidate.id !== beat.id &&
      (candidate.clipId === beat.clipId || candidate.splitScreen?.slots.some((slot) => slot.clipId === beat.clipId))
    ) ||
    (cut.overlays ?? []).some((overlay) => overlay.clipId === beat.clipId)
  ));

  // Audition the selected SFX (like the music library preview): plays only the
  // trimmed window [0, durationSec] at the segment's volume.
  const sfxPreviewRef = useRef<HTMLAudioElement>(null);
  const [sfxPreviewing, setSfxPreviewing] = useState(false);

  function toggleSfxPreview() {
    const a = sfxPreviewRef.current;
    if (!a || !selectedSfx) return;
    if (sfxPreviewing) { a.pause(); setSfxPreviewing(false); return; }
    if (a.src !== location.origin + sfxFileUrl(selectedSfx.fileName)) a.src = sfxFileUrl(selectedSfx.fileName);
    a.volume = Math.min(1, Math.max(0, selectedSfx.volume));
    try { a.currentTime = 0; } catch { /* pre-metadata */ }
    a.play().then(() => setSfxPreviewing(true)).catch(() => {});
  }

  // Keep the preview volume live while a segment is auditioning, and stop the
  // preview whenever the selected segment changes.
  useEffect(() => {
    if (sfxPreviewRef.current && selectedSfx) sfxPreviewRef.current.volume = Math.min(1, Math.max(0, selectedSfx.volume));
  }, [selectedSfx?.volume, selectedSfx]);
  useEffect(() => {
    const a = sfxPreviewRef.current;
    return () => { if (a) { a.pause(); } };
  }, [selectedSfx?.id]);
  const [trimOpen, setTrimOpen] = useState(true);
  const [colorOpen, setColorOpen] = useState(false);
  const [titleOpen, setTitleOpen] = useState(false);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [rotationOpen, setRotationOpen] = useState(false);
  const [splitScreenOpen, setSplitScreenOpen] = useState(false);
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [pickerSlotIndex, setPickerSlotIndex] = useState<number | null>(null);
  const [showBeatClipPicker, setShowBeatClipPicker] = useState(false);
  const [sourceCardHovered, setSourceCardHovered] = useState(false);
  const [trimHistory, setTrimHistory] = useState<{ inSec: number; outSec: number; durationSec: number; durationPreset?: Beat["durationPreset"] }[]>([]);

  const activeGlobalFilter = getFilterPreset(cut?.globalFilterId);
  const currentGlobalAdj = cut?.globalFilterAdjustments ?? activeGlobalFilter?.colorAdjustments ?? {};
  const baseGlobalAdj = activeGlobalFilter?.colorAdjustments ?? {};
  const isGlobalFilterModified = !!cut?.globalFilterAdjustments && (
    (cut.globalFilterAdjustments.exposure ?? 0) !== (baseGlobalAdj.exposure ?? 0) ||
    (cut.globalFilterAdjustments.contrast ?? 0) !== (baseGlobalAdj.contrast ?? 0) ||
    (cut.globalFilterAdjustments.shadows ?? 0) !== (baseGlobalAdj.shadows ?? 0) ||
    (cut.globalFilterAdjustments.blackPoint ?? 0) !== (baseGlobalAdj.blackPoint ?? 0) ||
    (cut.globalFilterAdjustments.highlights ?? 0) !== (baseGlobalAdj.highlights ?? 0) ||
    (cut.globalFilterAdjustments.colorTone ?? 0) !== (baseGlobalAdj.colorTone ?? 0) ||
    (cut.globalFilterAdjustments.warmth ?? 0) !== (baseGlobalAdj.warmth ?? 0) ||
    (cut.globalFilterAdjustments.saturation ?? 0) !== (baseGlobalAdj.saturation ?? 0) ||
    (cut.globalFilterAdjustments.skinTone ?? 0) !== (baseGlobalAdj.skinTone ?? 0) ||
    (cut.globalFilterAdjustments.tint ?? 0) !== (baseGlobalAdj.tint ?? 0) ||
    (cut.globalFilterAdjustments.shadowWarmth ?? 0) !== (baseGlobalAdj.shadowWarmth ?? 0) ||
    (cut.globalFilterAdjustments.shadowTint ?? 0) !== (baseGlobalAdj.shadowTint ?? 0) ||
    (cut.globalFilterAdjustments.highlightWarmth ?? 0) !== (baseGlobalAdj.highlightWarmth ?? 0) ||
    (cut.globalFilterAdjustments.highlightTint ?? 0) !== (baseGlobalAdj.highlightTint ?? 0)
  );

  function updateGlobalAdj(key: keyof ColorAdjustments, value: number) {
    if (!cut?.globalFilterId) return;
    const nextAdj = { ...currentGlobalAdj, [key]: value };
    dispatch({
      type: "SET_GLOBAL_FILTER",
      filterId: cut.globalFilterId,
      intensity: cut.globalFilterIntensity,
      adjustments: nextAdj,
    });
  }

  // A labeled ±100 color slider row (matches the existing adjustment rows). Used for
  // the tint + split-tone controls in both the per-beat and global adjustment groups.
  const adjRow = (label: string, value: number, onChange: (v: number) => void, resetValue = 0) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontSize: 11, width: 70, color: "var(--ink-2)" }}>{label}</span>
      <InputControl
        type="range" min={-100} max={100} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => onChange(resetValue)}
        title={`Drag to adjust, double-click to reset to ${resetValue > 0 ? `+${resetValue}` : resetValue}`}
        style={sliderTrackStyle(value)}
      />
      <span style={{ fontSize: 10, width: 32, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
        {value > 0 ? `+${value}` : value}
      </span>
    </div>
  );
  // The tint + split-tone rows for an adjustment group (per-beat or global).
  const splitToneRows = (
    adj: ColorAdjustments,
    set: (k: keyof ColorAdjustments, v: number) => void,
    baseAdj?: ColorAdjustments,
  ) => (
    <>
      {adjRow("Tint", adj.tint ?? 0, (v) => set("tint", v), baseAdj?.tint ?? 0)}
      {/* Tonal range: brightness of the dark/bright regions. Distinct from the
          split-tone rows below, which colour those same regions. */}
      <div style={{ fontSize: 10, fontWeight: 700, color: "var(--accent)", marginTop: 2 }}>Tone</div>
      {adjRow("Shadows", adj.shadows ?? 0, (v) => set("shadows", v), baseAdj?.shadows ?? 0)}
      {adjRow("Black point", adj.blackPoint ?? 0, (v) => set("blackPoint", v), baseAdj?.blackPoint ?? 0)}
      {adjRow("Highlights", adj.highlights ?? 0, (v) => set("highlights", v), baseAdj?.highlights ?? 0)}
      <div style={{ fontSize: 10, fontWeight: 700, color: "var(--accent)", marginTop: 2 }}>Split tone</div>
      {adjRow("Orange / Skin", adj.skinTone ?? 0, (v) => set("skinTone", v), baseAdj?.skinTone ?? 0)}
      {adjRow("Shadow warm", adj.shadowWarmth ?? 0, (v) => set("shadowWarmth", v), baseAdj?.shadowWarmth ?? 0)}
      {adjRow("Shadow tint", adj.shadowTint ?? 0, (v) => set("shadowTint", v), baseAdj?.shadowTint ?? 0)}
      {adjRow("Highlt warm", adj.highlightWarmth ?? 0, (v) => set("highlightWarmth", v), baseAdj?.highlightWarmth ?? 0)}
      {adjRow("Highlt tint", adj.highlightTint ?? 0, (v) => set("highlightTint", v), baseAdj?.highlightTint ?? 0)}
    </>
  );
  // Per-line caption alternatives: model + mood chosen here (seeded from settings),
  // results aligned to caption rows (row i → its suggestions).
  const [altModel, setAltModel] = useState<string>(settings.authorModel);
  const [altMood, setAltMood] = useState<string>(settings.tone);
  const [altBusy, setAltBusy] = useState(false);
  const [altErr, setAltErr] = useState<string | null>(null);
  const [alts, setAlts] = useState<string[][]>([]);
  const [transitionOpen, setTransitionOpen] = useState(false);
  const [beatAudioOpen, setBeatAudioOpen] = useState(false);
  const [globalFilterOpen, setGlobalFilterOpen] = useState(false);
  const [voHintsOpen, setVoHintsOpen] = useState(false);
  const voTextRef = useRef<HTMLTextAreaElement>(null);

  // Insert an audio tag at the caret in the narration textarea (falls back to the
  // end if the field was never focused). Keeps single spaces around the tag and
  // restores the caret just after it so the user can keep typing.
  function insertHintTag(tag: string) {
    if (!selectedVo) return;
    const text = selectedVo.text;
    const el = voTextRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? start;
    const before = text.slice(0, start);
    const after = text.slice(end);
    const lead = before.length && !/\s$/.test(before) ? " " : "";
    const trail = after.length && !/^\s/.test(after) ? " " : after.length ? "" : " ";
    const snippet = `${lead}${tag}${trail}`;
    const caret = before.length + snippet.length;
    dispatch({ type: "UPDATE_VO", segment: { ...selectedVo, text: before + snippet + after } });
    requestAnimationFrame(() => {
      const e2 = voTextRef.current;
      if (e2) { e2.focus(); e2.setSelectionRange(caret, caret); }
    });
  }

  function applyTransitionToAllBeats() {
    if (!cut || !beat) return;
    const tr = beat.transition ?? "none";
    const sec = beat.transitionSec ?? 0.5;
    const pos = beat.transitionPosition ?? "start";
    const updatedBeats = cut.beats.map((b) => ({
      ...b,
      transition: tr,
      transitionSec: sec,
      transitionPosition: pos,
    }));
    dispatch({ type: "SET_CUT", cut: { ...cut, beats: updatedBeats } });
  }
  const [copiedColor, setCopiedColor] = useState<ColorAdjustments | null>(null);
  const [colorCopiedToast, setColorCopiedToast] = useState(false);

  function copyBeatColor() {
    if (!beat?.colorAdjustments) return;
    setCopiedColor({ ...beat.colorAdjustments });
    setColorCopiedToast(true);
    setTimeout(() => setColorCopiedToast(false), 2000);
  }

  function pasteBeatColor() {
    if (!copiedColor || !beat) return;
    update({ ...beat, colorAdjustments: { ...copiedColor } });
  }

  function applyColorToAllBeats() {
    if (!cut || !beat) return;
    const adj = beat.colorAdjustments;
    const updatedBeats = cut.beats.map((item) => ({
      ...item,
      colorAdjustments: adj ? { ...adj } : undefined,
    }));
    dispatch({ type: "SET_CUT", cut: { ...cut, beats: updatedBeats } });
  }

  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);

  // Suggestions & modals belong to one beat — clear them when a different beat is selected.
  useEffect(() => { setAlts([]); setAltErr(null); setConfirmRemoveOpen(false); setTrimHistory([]); }, [beat?.id]);

  // Synthesize this segment's narration and snap its length to the exact spoken
  // duration (from ElevenLabs timestamps / decoded audio) so the caption window fits.
  async function fitVoLength() {
    if (!selectedVo || !selectedVo.text.trim()) return;
    setFitting(true); setFitErr(null);
    try {
      const seg = selectedVo;
      const n = await synthesizeVoiceover(seg.text.trim(), {
        engine: es.ttsEngine, voice: es.voice, elevenVoiceId: es.elevenVoiceId,
        speed: es.voiceoverSpeed, elevenModel: es.elevenModel, elevenStability: es.elevenStability, elevenStyle: es.elevenStyle,
      });
      const dur = Math.max(0.3, Math.round((n.durationSec || 0) * 10) / 10);
      if (dur > 0.3) dispatch({ type: "UPDATE_VO", segment: { ...seg, durationSec: dur } });
      else setFitErr("Couldn't read a duration from the voice.");
    } catch (e) {
      setFitErr(e instanceof Error ? e.message : String(e));
    } finally {
      setFitting(false);
    }
  }

  // VO Segment editor card — narration text + caption visibility, decoupled from the
  // beat. Rendered in both the empty state and the normal Inspector so a selected VO
  // chip is always editable. (Mirrors the overlay clip card.)
  const voCard = selectedVo ? (
    <div className="st-field" style={{ background: "var(--panel-2)", padding: 12, borderRadius: 8, border: "1px solid var(--line)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
        <label style={{ margin: 0 }}>Voiceover segment</label>
        <div style={{ display: "flex", gap: 6 }}>
          <ControlButton
            type="button"
            className="st-btn ghost"
            style={{ padding: "3px 7px", fontSize: 10, display: "inline-flex", alignItems: "center", gap: 4 }}
            onClick={() => {
              const gid = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
              const newId = `vo-${gid()}`;
              dispatch({ type: "DUPLICATE_VO", id: selectedVo.id, newVoId: newId });
              onSelectVo?.(newId);
            }}
            title="Duplicate this VO segment"
          >
            <CopyIcon size={11} /> Duplicate
          </ControlButton>
          <ControlButton
            type="button"
            className="st-btn danger"
            style={{ padding: "3px 7px", fontSize: 10, display: "inline-flex", alignItems: "center", gap: 4 }}
            onClick={() => onRequestDeleteSegment("voiceover", selectedVo.id, selectedVo.text || "Voiceover segment")}
          >
            <DeleteIcon size={11} /> Remove
          </ControlButton>
        </div>
      </div>

      <label>Narration</label>
      <TextareaControl
        className="st-caption-edit"
        ref={voTextRef}
        value={selectedVo.text}
        onChange={(e) => dispatch({ type: "UPDATE_VO", segment: { ...selectedVo, text: e.target.value } })}
        placeholder="Type what the voiceover should say…"
        rows={3}
      />

      {/* Expressive hints — inline audio tags the user can drop into the narration. */}
      <div style={{ marginTop: 8 }}>
        <ControlButton
          type="button"
          className="st-color-collapsible-btn"
          onClick={() => setVoHintsOpen((o) => !o)}
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", padding: "6px 8px", background: "transparent", border: "1px solid var(--line)", borderRadius: 6, color: "var(--ink-2)", cursor: "pointer" }}
          title="Reference of expressive audio tags you can type into the narration"
        >
          <span style={{ fontSize: 10.5, fontWeight: 600 }}>Expressive delivery hints</span>
          <ChevronDownIcon
            size={11}
            style={{ transition: "transform .2s ease", transform: voHintsOpen ? "rotate(180deg)" : "none" }}
          />
        </ControlButton>

        <div className={"st-color-collapsible" + (voHintsOpen ? " open" : "")}>
          <div className="st-color-collapsible-inner">
            <div style={{ padding: "8px 10px", background: "var(--panel-3)", borderRadius: 6, border: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontSize: 10, color: "var(--ink-3)", lineHeight: 1.5 }}>
                Type these tags into the narration to shape delivery. Click one to insert it.
                {es.ttsEngine === "elevenlabs" && es.elevenModel === "eleven_v3"
                  ? " ✓ Your voice model (ElevenLabs v3) reads them."
                  : " ⚠ Only the ElevenLabs “v3 — expressive” model reads them — other engines/models say them out loud."}
              </div>

              {VO_HINT_GROUPS.map((group) => (
                <div key={group.title} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "var(--accent)", textTransform: "uppercase", letterSpacing: 0.4 }}>{group.title}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {group.tags.map((tag) => (
                      <ControlButton
                        key={tag}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => insertHintTag(tag)}
                        title={`Insert ${tag} at the cursor`}
                        style={{ fontFamily: "ui-monospace, monospace", fontSize: 10.5, padding: "2px 6px", background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: 4, color: "var(--ink-2)", cursor: "pointer" }}
                      >
                        {tag}
                      </ControlButton>
                    ))}
                  </div>
                  {group.note && <div style={{ fontSize: 9.5, color: "var(--ink-3)", lineHeight: 1.4 }}>{group.note}</div>}
                </div>
              ))}

              <div style={{ fontSize: 9.5, color: "var(--ink-3)", lineHeight: 1.5, borderTop: "1px solid var(--line)", paddingTop: 8 }}>
                <strong style={{ color: "var(--ink-2)" }}>Tips:</strong> a tag affects what comes <em>after</em> it until the next tag or a strong break. Combine for nuance — <code>[nervous] [quietly] maybe we should go…</code> — and match the voice: a calm narration voice won’t <code>[shouting]</code> convincingly.
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="ds-switch-row" style={{ marginTop: 8 }}>
        <span>
          <b>Show caption on screen</b>
          <small>Display narration text during this segment</small>
        </span>
        <Switch
          checked={selectedVo.captionVisible}
          onChange={(next) => dispatch({ type: "UPDATE_VO", segment: { ...selectedVo, captionVisible: next } })}
          label="Show caption on screen"
        />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }} title="Playback volume for this voiceover segment.">
        <span style={{ fontSize: 11, width: 60, color: "var(--ink-2)" }}>Volume</span>
        <InputControl
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={selectedVo.volume ?? 1}
          onChange={(e) => dispatch({ type: "UPDATE_VO", segment: { ...selectedVo, volume: Number(e.target.value) } })}
          style={sliderTrackStyle(selectedVo.volume ?? 1, 0, 1)}
        />
        <span style={{ fontSize: 10, width: 34, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
          {Math.round((selectedVo.volume ?? 1) * 100)}%
        </span>
      </div>


      <div style={{ display: "flex", gap: 10, marginTop: 8, fontSize: 11, color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
        <span>Start {selectedVo.startTimeSec.toFixed(1)}s</span>
        <span>Length {selectedVo.durationSec.toFixed(1)}s</span>
        {selectedVo.text.trim() && <span>· ~{estimateSpokenSeconds(selectedVo.text).toFixed(1)}s to speak</span>}
      </div>

      <ControlButton
        type="button"
        className="st-btn ghost"
        style={{ marginTop: 8, fontSize: 10.5, padding: "5px 10px", width: "100%", justifyContent: "center" }}
        onClick={fitVoLength}
        disabled={fitting || !selectedVo.text.trim()}
        title="Synthesize this narration and snap the segment length to its exact spoken duration"
      >
        {fitting ? "Fitting…" : "Fit length to voice"}
      </ControlButton>
      {fitErr && <div style={{ fontSize: 10, color: "var(--danger)", marginTop: 4 }}>⚠ {fitErr}</div>}

      <div style={{ fontSize: 10, color: "var(--ink-3)", marginTop: 4 }}>Drag the chip on the VO track to move; drag its edges to resize.</div>
    </div>
  ) : null;

  // SFX Segment editor — sound file + volume + duration + fit-to-beat, decoupled from the beat (mirrors VO/sticker cards).
  const effSfx = selectedSfx ? resolveSfx(selectedSfx, beatSpans(cut?.beats ?? [])) : null;
  const maxSfxDur = selectedSfx ? Math.max(0.1, Math.round(selectedSfx.sourceDurationSec * 10) / 10) : 1;

  const sfxCard = selectedSfx && effSfx ? (
    <div className="st-sec" style={{ background: "var(--panel-2)", padding: 12, borderRadius: 8, border: "1px solid #8b7cff" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#8b7cff" }}>🔊 SFX Segment</span>
        <div style={{ display: "flex", gap: 6 }}>
          <ControlButton
            type="button"
            className="st-btn ghost"
            style={{ padding: "2px 8px", fontSize: 11 }}
            onClick={() => {
              const gid = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
              const newId = `sfx-${gid()}`;
              dispatch({ type: "DUPLICATE_SFX", id: selectedSfx.id, newSfxId: newId });
              onSelectSfx?.(newId);
            }}
            title="Duplicate this SFX segment"
          >
            📋 Duplicate
          </ControlButton>
          <ControlButton
            type="button"
            className="st-btn danger"
            style={{ padding: "2px 8px", fontSize: 11 }}
            onClick={() => onRequestDeleteSegment("sound effect", selectedSfx.id, selectedSfx.fileName)}
          >
            Remove
          </ControlButton>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <ControlButton
          type="button"
          className="st-btn ghost"
          style={{ padding: "4px 9px", fontSize: 12, flexShrink: 0 }}
          onClick={toggleSfxPreview}
          title="Preview this sound at its trimmed length and volume"
        >
          {sfxPreviewing ? "⏸" : "▶"}
        </ControlButton>
        <div style={{ fontSize: 12, fontFamily: "var(--mono)", color: "var(--ink)", wordBreak: "break-all", minWidth: 0 }}>{selectedSfx.fileName}</div>
      </div>
      <audio
        ref={sfxPreviewRef}
        onEnded={() => setSfxPreviewing(false)}
        onPause={() => setSfxPreviewing(false)}
        onTimeUpdate={(e) => { if (e.currentTarget.currentTime >= effSfx.durationSec) { e.currentTarget.pause(); } }}
      />

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }} title="Playback volume for this sound.">
        <span style={{ fontSize: 11, width: 60, color: "var(--ink-2)" }}>Volume</span>
        <InputControl
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={selectedSfx.volume}
          onChange={(e) => dispatch({ type: "UPDATE_SFX", segment: { ...selectedSfx, volume: Number(e.target.value) } })}
          style={sliderTrackStyle(selectedSfx.volume, 0, 1)}
        />
        <span style={{ fontSize: 10, width: 34, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>{Math.round(selectedSfx.volume * 100)}%</span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }} title="Duration for this sound effect.">
        <span style={{ fontSize: 11, width: 60, color: "var(--ink-2)" }}>Duration</span>
        <InputControl
          type="range"
          min={0.1}
          max={maxSfxDur}
          step={0.1}
          disabled={!!selectedSfx.fitToBeat}
          value={effSfx.durationSec}
          onChange={(e) => dispatch({ type: "UPDATE_SFX", segment: { ...selectedSfx, durationSec: Number(e.target.value) } })}
          style={sliderTrackStyle(effSfx.durationSec, 0.1, maxSfxDur)}
        />
        <span style={{ fontSize: 10, width: 34, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
          {effSfx.durationSec.toFixed(1)}s
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10 }} title="Lock this sound effect's duration to the length of the beat it lands on.">
        <span style={{ fontSize: 11, color: "var(--ink-2)" }}>Fit to beat</span>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 11, color: "var(--ink-2)" }}>
          <InputControl
            type="checkbox"
            checked={!!selectedSfx.fitToBeat}
            onChange={(e) => dispatch({ type: "UPDATE_SFX", segment: { ...selectedSfx, fitToBeat: e.target.checked } })}
            style={{ accentColor: "var(--accent)", cursor: "pointer" }}
          />
          <span>Match beat duration</span>
        </label>
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 10, fontSize: 11, color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
        <span>Start {effSfx.startTimeSec.toFixed(1)}s</span>
        <span>Length {effSfx.durationSec.toFixed(1)}s</span>
        <span>· of {selectedSfx.sourceDurationSec.toFixed(1)}s</span>
      </div>
    </div>
  ) : null;

  // Sticker card — mirrors the SFX card's shell; the sliders reuse the same row
  // shape as the colour panel's adjRow.
  const stickerRow = (label: string, value: number, min: number, max: number, step: number, fmt: (v: number) => string, onChange: (v: number) => void, reset: number) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
      <span style={{ fontSize: 11, width: 62, color: "var(--ink-2)" }}>{label}</span>
      <InputControl
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => onChange(reset)}
        style={sliderTrackStyle(value, min, max)}
      />
      <span style={{ fontSize: 10, width: 42, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>{fmt(value)}</span>
    </div>
  );

  const stickerCard = selectedSticker ? (
    <div className="st-sec" style={{ background: "var(--panel-2)", padding: 12, borderRadius: 8, border: "1px solid rgb(167,139,250)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "rgb(167,139,250)" }}>🩹 Sticker</span>
        <div style={{ display: "flex", gap: 6 }}>
          <ControlButton
            type="button"
            className="st-btn ghost"
            style={{ padding: "2px 8px", fontSize: 11 }}
            onClick={() => {
              const gid = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
              const newId = `sticker-${gid()}`;
              dispatch({ type: "DUPLICATE_STICKER", id: selectedSticker.id, newStickerId: newId });
              onSelectSticker?.(newId);
            }}
            title="Duplicate this sticker"
          >
            Duplicate
          </ControlButton>
          <ControlButton
            type="button"
            className="st-btn ghost"
            style={{ padding: "2px 8px", fontSize: 11, color: "var(--danger)" }}
            onClick={() => onRequestDeleteSegment("sticker", selectedSticker.id, selectedSticker.fileName)}
            title="Remove this sticker"
          >
            Remove
          </ControlButton>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <img
          src={stickerFileUrl(selectedSticker.fileName)}
          alt=""
          style={{ width: 40, height: 40, objectFit: "contain", background: "var(--panel-3)", borderRadius: 6, padding: 3, flexShrink: 0 }}
        />
        <div style={{ fontSize: 12, fontFamily: "var(--mono)", color: "var(--ink)", wordBreak: "break-all", minWidth: 0 }}>{selectedSticker.fileName}</div>
      </div>

      {stickerRow("X", selectedSticker.x, 0, 1, 0.005, (v) => `${Math.round(v * 100)}%`,
        (v) => dispatch({ type: "UPDATE_STICKER", sticker: { ...selectedSticker, x: v } }), 0.5)}
      {stickerRow("Y", selectedSticker.y, 0, 1, 0.005, (v) => `${Math.round(v * 100)}%`,
        (v) => dispatch({ type: "UPDATE_STICKER", sticker: { ...selectedSticker, y: v } }), 0.5)}
      {stickerRow("Scale", selectedSticker.scale, 0.02, 1.5, 0.005, (v) => `${Math.round(v * 100)}%`,
        (v) => dispatch({ type: "UPDATE_STICKER", sticker: { ...selectedSticker, scale: v } }), 0.25)}
      {stickerRow("Rotation", selectedSticker.rotation, -180, 180, 1, (v) => `${v > 0 ? "+" : ""}${v.toFixed(0)}°`,
        (v) => dispatch({ type: "UPDATE_STICKER", sticker: { ...selectedSticker, rotation: v } }), 0)}
      {stickerRow("Opacity", selectedSticker.opacity, 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`,
        (v) => dispatch({ type: "UPDATE_STICKER", sticker: { ...selectedSticker, opacity: v } }), 1)}

      {/* Tint — strength slider plus the same swatch + picker idiom the Title
          treatment uses. A hue rotation would be useless here: most sticker
          assets are monochrome icons, and rotating the hue of near-black does
          nothing. This lays a colour over the asset clipped to its alpha. */}
      {stickerRow("Tint", selectedSticker.tintStrength ?? 0, 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`,
        (v) => dispatch({ type: "UPDATE_STICKER", sticker: { ...selectedSticker, tintStrength: v } }), 0)}
      {/* The shared palette (ADR-0013) — same swatches the Title row shows.
          Picking a colour still turns the tint on when it was off. */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, marginLeft: 70 }}>
        <ColorField
          value={selectedSticker.tintColor ?? "#ffffff"}
          onChange={(hex) => dispatch({ type: "UPDATE_STICKER", sticker: { ...selectedSticker, tintColor: hex, tintStrength: selectedSticker.tintStrength || 1 } })}
          label=""
          noun="tint"
        />
      </div>

      {/* Fit to beat — the Sticker follows its Beat's trim instead of its own
          timing. Resolved at read time, so retrimming the Beat can never leave a
          stale duration behind. */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, color: "var(--ink-2)" }}>Fit to beat</div>
          <div style={{ fontSize: 10, color: "var(--ink-3)" }}>
            {selectedSticker.fitToBeat
              ? "Spans its whole beat and follows its trim"
              : "Uses its own start and length"}
          </div>
        </div>
        <Switch
          checked={!!selectedSticker.fitToBeat}
          label="Fit sticker to the length of its beat"
          onChange={(next) => dispatch({ type: "UPDATE_STICKER", sticker: { ...selectedSticker, fitToBeat: next } })}
        />
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 8, fontSize: 11, color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
        {(() => {
          const eff = resolveSticker(selectedSticker, beatSpans(cut?.beats ?? []));
          return (
            <>
              <span>Start {eff.startTimeSec.toFixed(1)}s</span>
              <span>Length {eff.durationSec.toFixed(1)}s</span>
              {selectedSticker.fitToBeat && <span>· from its beat</span>}
            </>
          );
        })()}
      </div>

      <div style={{ fontSize: 10, color: "var(--ink-3)", marginTop: 6 }}>
        {selectedSticker.fitToBeat
          ? "Timing comes from its beat — turn off Fit to beat to drag or trim the chip. Double-click a slider to reset it."
          : "Drag the chip on the Sticker track to move; drag its right edge to change how long it shows. Double-click a slider to reset it."}
      </div>
    </div>
  ) : null;

  if (!beat) {
    return (
      <aside className="st-col insp">
        <div className="st-insp-inner">
        <div className="st-colhead">Inspector</div>
        <div className="st-insp-empty" style={{ display: "flex", flexDirection: "column", gap: 16, padding: 16 }}>
          {voCard}
          {sfxCard}
          {stickerCard}
          <span style={{ color: "var(--ink-3)", fontSize: 12 }}>Select a beat in the timeline to edit its caption, trim, and clip.</span>

          {cut && (
            <div className="st-sec" style={{ width: "100%", textAlign: "left" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink)" }}>🎨 Global Look & Feel Filter</span>
                <ControlButton
                  type="button"
                  className="st-btn ghost"
                  style={{
                    padding: "2px 8px",
                    fontSize: 11,
                    borderColor: activeGlobalFilter ? "var(--accent)" : undefined,
                    color: activeGlobalFilter ? "var(--accent)" : undefined,
                  }}
                  onClick={() => setFilterModalOpen(true)}
                  title="Choose a global color grading filter preset for the entire cut"
                >
                  {activeGlobalFilter ? `✨ ${activeGlobalFilter.name}` : "Choose Preset..."}
                </ControlButton>
              </div>

              {activeGlobalFilter && (
                <div style={{ marginTop: 8, padding: 10, background: "var(--panel-2)", borderRadius: 6, border: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 11, color: "var(--ink-2)" }}>Filter Intensity: {Math.round((cut?.globalFilterIntensity ?? 1) * 100)}%</span>
                    <ControlButton
                      type="button"
                      style={{ background: "none", border: "none", color: "var(--danger)", fontSize: 11, cursor: "pointer", padding: 0 }}
                      onClick={() => dispatch({ type: "SET_GLOBAL_FILTER", filterId: null })}
                    >
                      Remove Filter
                    </ControlButton>
                  </div>
                  <InputControl
                    type="range"
                    min="0.1"
                    max="1"
                    step="0.05"
                    value={cut?.globalFilterIntensity ?? 1}
                    onChange={(e) => dispatch({ type: "SET_GLOBAL_FILTER", filterId: cut?.globalFilterId ?? null, intensity: Number(e.target.value) })}
                    style={sliderTrackStyle(cut?.globalFilterIntensity ?? 1, 0.1, 1)}
                  />

                  <div className="st-color-adjustments" style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--accent)" }}>
                        🎛️ Fine-Tune Filter {isGlobalFilterModified ? <span style={{ fontSize: 10, fontStyle: "italic", fontWeight: 400, color: "var(--ink-3)" }}>(Modified)</span> : null}
                      </div>
                      {isGlobalFilterModified && (
                        <ControlButton
                          type="button"
                          className="st-btn ghost"
                          style={{ fontSize: 10, padding: "2px 6px", height: 20, color: "var(--accent)", display: "flex", alignItems: "center", gap: 3 }}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={() => {
                            dispatch({
                              type: "SET_GLOBAL_FILTER",
                              filterId: cut?.globalFilterId ?? null,
                              intensity: cut?.globalFilterIntensity ?? 1,
                              adjustments: activeGlobalFilter ? { ...activeGlobalFilter.colorAdjustments } : {},
                            });
                          }}
                          title="Reset fine-tuning adjustments back to original preset defaults"
                        >
                          ↺ Reset Preset
                        </ControlButton>
                      )}
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 11, width: 70, color: "var(--ink-2)" }}>Exposure</span>
                      <InputControl
                        type="range"
                        min="-100"
                        max="100"
                        value={currentGlobalAdj.exposure ?? 0}
                        onChange={(e) => updateGlobalAdj("exposure", Number(e.target.value))}
                        onDoubleClick={() => updateGlobalAdj("exposure", activeGlobalFilter?.colorAdjustments?.exposure ?? 0)}
                        style={sliderTrackStyle(currentGlobalAdj.exposure ?? 0, -100, 100)}
                      />
                      <span style={{ fontSize: 10, width: 32, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
                        {(currentGlobalAdj.exposure ?? 0) > 0 ? `+${currentGlobalAdj.exposure}` : (currentGlobalAdj.exposure ?? 0)}
                      </span>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 11, width: 70, color: "var(--ink-2)" }}>Contrast</span>
                      <InputControl
                        type="range"
                        min="-100"
                        max="100"
                        value={currentGlobalAdj.contrast ?? 0}
                        onChange={(e) => updateGlobalAdj("contrast", Number(e.target.value))}
                        onDoubleClick={() => updateGlobalAdj("contrast", activeGlobalFilter?.colorAdjustments?.contrast ?? 0)}
                        style={sliderTrackStyle(currentGlobalAdj.contrast ?? 0, -100, 100)}
                      />
                      <span style={{ fontSize: 10, width: 32, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
                        {(currentGlobalAdj.contrast ?? 0) > 0 ? `+${currentGlobalAdj.contrast}` : (currentGlobalAdj.contrast ?? 0)}
                      </span>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 11, width: 70, color: "var(--ink-2)" }}>Hue</span>
                      <InputControl
                        type="range"
                        min="-100"
                        max="100"
                        value={currentGlobalAdj.colorTone ?? 0}
                        onChange={(e) => updateGlobalAdj("colorTone", Number(e.target.value))}
                        onDoubleClick={() => updateGlobalAdj("colorTone", activeGlobalFilter?.colorAdjustments?.colorTone ?? 0)}
                        style={sliderTrackStyle(currentGlobalAdj.colorTone ?? 0, -100, 100)}
                      />
                      <span style={{ fontSize: 10, width: 32, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
                        {(currentGlobalAdj.colorTone ?? 0) > 0 ? `+${currentGlobalAdj.colorTone}` : (currentGlobalAdj.colorTone ?? 0)}
                      </span>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 11, width: 70, color: "var(--ink-2)" }}>Warmth</span>
                      <InputControl
                        type="range"
                        min="-100"
                        max="100"
                        value={currentGlobalAdj.warmth ?? 0}
                        onChange={(e) => updateGlobalAdj("warmth", Number(e.target.value))}
                        onDoubleClick={() => updateGlobalAdj("warmth", activeGlobalFilter?.colorAdjustments?.warmth ?? 0)}
                        style={sliderTrackStyle(currentGlobalAdj.warmth ?? 0, -100, 100)}
                      />
                      <span style={{ fontSize: 10, width: 32, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
                        {(currentGlobalAdj.warmth ?? 0) > 0 ? `+${currentGlobalAdj.warmth}` : (currentGlobalAdj.warmth ?? 0)}
                      </span>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 11, width: 70, color: "var(--ink-2)" }}>Saturation</span>
                      <InputControl
                        type="range"
                        min="-100"
                        max="100"
                        value={currentGlobalAdj.saturation ?? 0}
                        onChange={(e) => updateGlobalAdj("saturation", Number(e.target.value))}
                        onDoubleClick={() => updateGlobalAdj("saturation", activeGlobalFilter?.colorAdjustments?.saturation ?? 0)}
                        style={sliderTrackStyle(currentGlobalAdj.saturation ?? 0, -100, 100)}
                      />
                      <span style={{ fontSize: 10, width: 32, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
                        {(currentGlobalAdj.saturation ?? 0) > 0 ? `+${currentGlobalAdj.saturation}` : (currentGlobalAdj.saturation ?? 0)}
                      </span>
                    </div>
                    {splitToneRows(currentGlobalAdj, updateGlobalAdj, activeGlobalFilter?.colorAdjustments)}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {filterModalOpen && (
          <FilterPresetModal
            activeFilterId={cut?.globalFilterId}
            activeIntensity={cut?.globalFilterIntensity}
            activeAdjustments={cut?.globalFilterAdjustments}
            onSelectFilter={(filterId, intensity, adjustments) => {
              dispatch({ type: "SET_GLOBAL_FILTER", filterId, intensity, adjustments });
            }}
            onClose={() => setFilterModalOpen(false)}
          />
        )}
        </div>
      </aside>
    );
  }
  const b = beat;
  const update = (next: Beat) => dispatch({ type: "UPDATE_BEAT", beat: next });

  function handleSwapClip(newClipId: string) {
    if (!b || newClipId === b.clipId) return;
    if (clip?.isTemplatePlaceholder) {
      dispatch({ type: "FILL_TEMPLATE_SLOT", beatId: b.id, clipId: newClipId });
      return;
    }
    const newClip = clips.find((c) => c.id === newClipId);
    if (!newClip) return;

    const currentDur = b.durationSec ?? (b.outSec - b.inSec);
    const targetDur = Math.min(currentDur, newClip.durationSec || currentDur);

    let newIn = b.inSec;
    if (newIn + targetDur > newClip.durationSec) {
      newIn = Math.max(0, newClip.durationSec - targetDur);
    }
    const newOut = newIn + targetDur;

    update({
      ...b,
      clipId: newClipId,
      inSec: newIn,
      outSec: newOut,
      durationSec: targetDur,
    });
  }

  // Per-beat title layers (fall back to a fresh disabled stack for beats that
  // have never had a title). Editing dispatches the whole beat back.
  const beatTitleLayers: TitleLayerSettings[] = b.titleLayers ?? makeBeatTitleLayers();
  const beatTitleCount = beatTitleLayers.filter((l) => l.enabled && l.text.trim()).length;
  const indexedBeatTitles = collectBeatTitleEntries(cut?.beats ?? []);

  function editIndexedBeatTitle(targetBeat: Beat, layerId: string, text: string) {
    dispatch({
      type: "UPDATE_BEAT",
      beat: updateBeatTitleText(targetBeat, layerId, text),
    });
  }



  // The caption is stored as newline-separated lines. By default they stack
  // on-screen for the whole beat. When "Timed lines" is on, each line carries a
  // seconds timer (Beat.captionDurations, aligned by row) and the lines play in
  // sequence OVER the manually-trimmed footage — the trim always sets how much
  // footage plays; the beat only runs longer than the trim if the caption
  // sequence outlasts it (then the last frame freezes to cover the overflow).
  const captionLines = b.captionText.split("\n");
  const timed = b.captionDurations != null;
  const durations = b.captionDurations ?? [];
  const r1 = (n: number) => Math.round(n * 10) / 10;

  // The playable footage for a trim window — the trim, bounded by the clip.
  // Mirrors export.ts so the preview/readout match what gets rendered.
  function footageLenOf(inSec: number, outSec: number): number {
    const clipDur = clip?.durationSec ?? outSec;
    const cin = Math.min(Math.max(0, inSec), Math.max(0, clipDur - 0.1));
    return Math.min(Math.max(0.1, outSec - inSec), Math.max(0.1, clipDur - cin));
  }
  // Beat duration is the trim window (footage only) — narration lives on the VO
  // track now, so captions no longer stretch a beat. (Params kept for callers.)
  function durationFor(inSec: number, outSec: number, _captionText?: string, _durs?: number[]): number {
    return footageLenOf(inSec, outSec);
  }

  // Write lines (and, when timed, their aligned timers) back to the beat, keeping
  // scriptText === captionText and durationSec consistent with the export.
  function applyLines(lines: string[], durs?: number[]) {
    const captionText = (lines.length ? lines : [""]).join("\n");
    const durationSec = durationFor(b.inSec, b.outSec, captionText, durs);
    if (durs) {
      update({ ...b, captionText, scriptText: captionText, captionDurations: durs, durationSec });
    } else {
      const { captionDurations: _drop, ...rest } = b;
      update({ ...rest, captionText, scriptText: captionText, durationSec });
    }
  }
  const setLines = (next: string[]) => applyLines(next, timed ? durations : undefined);
  const editText = (i: number, value: string) => setLines(captionLines.map((l, j) => (j === i ? value : l)));
  const editDuration = (i: number, value: string) => {
    const v = parseFloat(value);
    applyLines(captionLines, durations.map((d, j) => (j === i ? (Number.isFinite(v) ? Math.max(0, v) : 0) : d)));
  };
  const addLine = () => { setAlts([]); applyLines([...captionLines, ""], timed ? [...durations, r1(estimateSpokenSeconds(""))] : undefined); };
  const removeLine = (i: number) => {
    setAlts([]);
    applyLines(captionLines.filter((_, j) => j !== i), timed ? durations.filter((_, j) => j !== i) : undefined);
  };
  // Toggle on → seed a timer per line from its spoken estimate; off → drop timers.
  const toggleTimed = (on: boolean) =>
    applyLines(captionLines, on ? captionLines.map((l) => r1(estimateSpokenSeconds(l))) : undefined);

  // Generate alternative captions for every line via the chosen model + mood, then
  // let the author click any suggestion to drop it into that line's input.
  async function genAlts() {
    setAltBusy(true);
    setAltErr(null);
    try {
      const result = await suggestCaptionAlternatives(clip, captionLines, logline, { model: altModel, tone: toneHint(altMood) }, 3);
      setAlts(result);
    } catch (e) {
      setAltErr(e instanceof Error ? e.message : String(e));
    } finally {
      setAltBusy(false);
    }
  }
  const useAlt = (i: number, alt: string) => {
    editText(i, alt);
    setAlts((a) => a.map((x, k) => (k === i ? [] : x))); // clear that line's chips once chosen
  };

  function undoTrim() {
    if (trimHistory.length === 0 || !b) return;
    const prevTrim = trimHistory[trimHistory.length - 1];
    setTrimHistory((prev) => prev.slice(0, -1));
    update({
      ...b,
      inSec: prevTrim.inSec,
      outSec: prevTrim.outSec,
      durationSec: prevTrim.durationSec,
      durationPreset: prevTrim.durationPreset,
    });
  }

  function setTrim(inSec: number, outSec: number) {
    if (!b) return;
    const maxOut = clip?.durationSec ?? Math.max(outSec, 10);
    const targetDur = b.lockDuration ? b.durationSec : undefined;

    if (Math.abs(inSec - b.inSec) > 0.01 || Math.abs(outSec - b.outSec) > 0.01) {
      setTrimHistory((prev) => [
        ...prev.slice(-20),
        { inSec: b.inSec, outSec: b.outSec, durationSec: b.durationSec, durationPreset: b.durationPreset },
      ]);
    }

    if (targetDur != null && targetDur > 0) {
      const fixedDur = Math.min(targetDur, maxOut);
      const inChanged = Math.abs(inSec - b.inSec) > 0.001;
      let nextIn = b.inSec;
      let nextOut = b.outSec;

      if (inChanged) {
        nextIn = Math.max(0, Math.min(inSec, maxOut - fixedDur));
        nextOut = Math.min(maxOut, Math.round((nextIn + fixedDur) * 10) / 10);
        nextIn = Math.round(nextIn * 10) / 10;
      } else {
        nextOut = Math.max(fixedDur, Math.min(outSec, maxOut));
        nextIn = Math.max(0, Math.round((nextOut - fixedDur) * 10) / 10);
        nextOut = Math.round(nextOut * 10) / 10;
      }
      update({ ...b, inSec: nextIn, outSec: nextOut, durationSec: fixedDur, durationPreset: "custom" });
      return;
    }

    const nextIn = Math.max(0, Math.min(inSec, maxOut - 0.1));
    const nextOut = Math.max(nextIn + 0.1, Math.min(outSec, maxOut));
    const durationSec = durationFor(nextIn, nextOut, b.captionText, b.captionDurations);
    update({ ...b, inSec: nextIn, outSec: nextOut, durationSec, durationPreset: "custom" });
  }

  const durationOptions = [
    { value: "0.5", seconds: 0.5, label: ".5" },
    { value: "1", seconds: 1, label: "1" },
    { value: "3", seconds: 3, label: "3" },
    { value: "5", seconds: 5, label: "5" },
    { value: "10", seconds: 10, label: "10" },
  ] as const;

  function setBeatDuration(seconds: number, preset: Beat["durationPreset"]) {
    if (!b || !clip) return;
    if (!Number.isFinite(seconds)) return;
    const durationSec = Math.max(0.1, Math.min(seconds, clip.durationSec));
    let nextIn = Math.max(0, Math.min(b.inSec, clip.durationSec - durationSec));
    let nextOut = nextIn + durationSec;
    nextIn = Math.round(nextIn * 10) / 10;
    nextOut = Math.round(nextOut * 10) / 10;
    update({ ...b, inSec: nextIn, outSec: nextOut, durationSec, durationPreset: preset });
  }


  function updateColorAdjustment(key: keyof ColorAdjustments, value: number) {
    const current = b.colorAdjustments ?? {};
    const nextAdj = { ...current, [key]: value };
    update({ ...b, colorAdjustments: nextAdj });
  }

  function resetColorAdjustments() {
    const { colorAdjustments: _drop, ...rest } = b;
    update(rest);
  }

  function hasColorAdjustments(adj?: ColorAdjustments) {
    return !isIdentityGrade(adj);
  }

  const aspect = state.cut?.aspect ?? "16:9";
  const posterStyle: React.CSSProperties = aspect === "9:16"
    ? { height: 180, aspectRatio: "9 / 16", width: "auto", margin: "0 auto 12px" }
    : aspect === "1:1"
    ? { height: 180, aspectRatio: "1 / 1", width: "auto", margin: "0 auto 12px" }
    : { width: "75%", aspectRatio: "16 / 9", maxHeight: 180, margin: "0 auto 12px" };


  return (
    <aside className="st-col insp">
      <div className="st-insp-inner">
      <div className="st-colhead">Beat {index + 1}/{total}</div>
      <div className="st-insp-body">
        {voCard}
        {sfxCard}
        {stickerCard}
        <div
          className="st-ip-poster"
          style={{
            ...posterStyle,
            background: beatPosterBg(b, clip, forceUpdate),
            filter: cssFilterFor(b.colorAdjustments),
          }}
        >
          <div className="cap">{b.captionText}</div>
        </div>

        {b.templateSlotDescription && (
          <div
            className="st-field"
            style={{
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid color-mix(in srgb, var(--accent) 38%, var(--line))",
              background: "color-mix(in srgb, var(--accent) 8%, var(--panel-2))",
            }}
          >
            <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: ".08em", color: "var(--accent)", textTransform: "uppercase" }}>
              Template slot · Beat {index + 1}
            </div>
            <div style={{ marginTop: 5, fontSize: 12, fontWeight: 650, lineHeight: 1.4, color: "var(--ink)" }}>
              {b.templateSlotDescription}
            </div>
            <div style={{ marginTop: 4, fontSize: 10, lineHeight: 1.35, color: "var(--ink-3)" }}>
              Choose footage that matches this role. The guidance remains when you swap clips.
            </div>
          </div>
        )}

        {/* Source Clip Switcher */}
        <div className="st-field" style={{ background: "var(--panel-2)", padding: 12, borderRadius: 8, border: "1px solid var(--line)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
            <label style={{ margin: 0, fontWeight: 700, fontSize: 12, color: "var(--ink)", display: "flex", alignItems: "center", gap: 6 }}>
              <span>🎬 Source Clip</span>
            </label>
            {clip && (
              <span className="st-source-duration" title="Source clip duration">
                {fmtSecs(clip.durationSec)}
              </span>
            )}
          </div>

          <div
            onMouseEnter={() => setSourceCardHovered(true)}
            onMouseLeave={() => setSourceCardHovered(false)}
            style={{ display: "flex", alignItems: "center", gap: 10 }}
          >
            {clip && !clip.isTemplatePlaceholder && sourceCardHovered && clip.kind !== "still" ? (
              <video
                src={getClipBlobUrl(clip.file)}
                autoPlay
                loop
                muted
                playsInline
                style={{
                  width: 44,
                  height: 32,
                  objectFit: "cover",
                  borderRadius: 4,
                  border: "1px solid var(--accent)",
                  background: "#000",
                  flexShrink: 0,
                }}
              />
            ) : clip?.poster ? (
              <img
                src={clip.poster}
                alt={clip.name}
                style={{
                  width: 44,
                  height: 32,
                  objectFit: "cover",
                  borderRadius: 4,
                  border: `1px solid ${sourceCardHovered ? "var(--accent)" : "var(--line)"}`,
                  background: "#000",
                  flexShrink: 0,
                }}
              />
            ) : (
              <div
                style={{
                  width: 44,
                  height: 32,
                  borderRadius: 4,
                  border: `1px solid ${sourceCardHovered ? "var(--accent)" : "var(--line)"}`,
                  background: "var(--panel-3)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 14,
                  flexShrink: 0,
                }}
              >
                🎥
              </div>
            )}

            <div style={{ flex: 1, minWidth: 0 }}>
              {clip ? (
                <InputControl
                  type="text"
                  value={clip.name}
                  onChange={(e) => dispatch({ type: "RENAME_CLIP", id: clip.id, name: e.target.value })}
                  placeholder="Clip title name…"
                  title="Click to edit clip title name"
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: "var(--ink)",
                    background: "var(--panel)",
                    border: "1px solid var(--line)",
                    borderRadius: 4,
                    padding: "2px 6px",
                    outline: "none",
                    width: "100%",
                    boxSizing: "border-box",
                  }}
                />
              ) : (
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-3)" }}>
                  No clip assigned
                </div>
              )}
            </div>

            <ControlButton
              type="button"
              className="st-btn primary"
              onClick={() => setShowBeatClipPicker(true)}
              title="Open visual clip picker to swap source clip for this beat"
              style={{ fontSize: 11, padding: "5px 10px", whiteSpace: "nowrap", flexShrink: 0 }}
            >
              ⇄ Swap Clip
            </ControlButton>
          </div>

          {clip && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--line)" }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-2)", marginBottom: 6 }}>
                Clip Tags
              </div>
              <ClipTagEditor clip={clip} />
            </div>
          )}

          <div style={{ fontSize: 10.5, color: "var(--ink-2)", marginTop: 8, lineHeight: 1.3 }}>
            💡 Swapping clip keeps zoom, color grade, titles, and beat duration intact.
          </div>
        </div>

        {/* Visual Clip Picker Modal for Active Beat */}
        {showBeatClipPicker && (
          <SplitClipPickerModal
            title={`Swap Source Clip for Beat ${String(index + 1).padStart(2, "0")}`}
            activeClipId={b.clipId}
            clips={clips.filter((candidate) => !candidate.isTemplatePlaceholder)}
            onSelectClip={(newClipId) => {
              handleSwapClip(newClipId);
              setShowBeatClipPicker(false);
            }}
            onClose={() => setShowBeatClipPicker(false)}
          />
        )}

        {SHOW_PER_BEAT_CAPTION_BOX && (
        <div className="st-field">
          <div className="st-caphead">
            <label>Caption · {timed ? "each line plays for its own seconds, in sequence" : "one line per row, stacked on screen"}</label>
            <label className="st-captoggle" title="Give each line a seconds timer; lines play one after another">
              <InputControl type="checkbox" checked={timed} onChange={(e) => toggleTimed(e.target.checked)} />
              <span>Timed lines</span>
            </label>
          </div>
          <div className="st-caplines">
            {captionLines.map((line, i) => (
              <div className="st-caprow" key={i}>
                <div className={timed ? "st-capline timed" : "st-capline"}>
                  <div className="st-capclear-wrap">
                    <InputControl
                      className="st-caption-line"
                      value={line}
                      placeholder="Caption line…"
                      onChange={(e) => editText(i, e.target.value)}
                    />
                    {line.length > 0 && (
                      <ControlButton
                        className="st-capclear"
                        title="Clear"
                        tabIndex={-1}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => editText(i, "")}
                      >×</ControlButton>
                    )}
                  </div>
                  {timed && (
                    <div className="st-capsec" title="Seconds this line stays on screen">
                      <InputControl type="number" min="0.1" step="0.1" value={durations[i] ?? ""} onChange={(e) => editDuration(i, e.target.value)} />
                      <span>s</span>
                    </div>
                  )}
                  {captionLines.length > 1 && (
                    <ControlButton className="st-capdel" title="Remove line" onClick={() => removeLine(i)}>×</ControlButton>
                  )}
                </div>
                {alts[i]?.length > 0 && (
                  <div className="st-capalts">
                    {alts[i].map((alt, j) => (
                      <ControlButton key={j} className="st-capalt" title="Use this line" onClick={() => useAlt(i, alt)}>{alt}</ControlButton>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <ControlButton className="st-capadd" onClick={addLine}>+ Add line</ControlButton>
            {timed && (() => {
              const schedule = captionSchedule(b.captionText, durations);
              const seqTotal = scheduleDuration(schedule);
              const linesSum = schedule ? schedule.cues.reduce((a, c) => a + c.sec, 0) : 0;
              // The footage the trim plays (matches export). Captions ride on top;
              // they only extend the beat if they run longer than this.
              const footageLen = footageLenOf(b.inSec, b.outSec);
              const overflow = seqTotal - footageLen;
              return (
                <div className="st-capseqfoot">
                  <div className={overflow > 0.05 ? "st-capseqtotal over" : "st-capseqtotal"}>
                    Sequence total · {fmtSecs(seqTotal)}
                    {overflow > 0.05
                      ? ` · ${fmtSecs(overflow)} past your ${fmtSecs(footageLen)} trim — last frame holds`
                      : ` · fits your ${fmtSecs(footageLen)} trim`}
                  </div>
                  <div className="st-capseqbreak">
                    {fmtSecs(schedule?.leadSec ?? 0)} lead-in · {fmtSecs(linesSum)} lines · {fmtSecs(schedule?.tailSec ?? 0)} tail
                  </div>
                </div>
              );
            })()}
          </div>

          <div className="st-capalt-controls">
            <ControlButton className="st-btn ghost" onClick={genAlts} disabled={altBusy || !clip}>
              {altBusy ? (
                <>
                  <span className="st-spinner-sm" />
                  Generating…
                </>
              ) : (
                "Generate alternatives"
              )}
            </ControlButton>
            <SelectControl value={altModel} onChange={(e) => setAltModel(e.target.value)} title="AI model">
              {MODEL_OPTIONS.map((m) => <option key={m} value={m}>{modelLabel(m)}</option>)}
            </SelectControl>
            <SelectControl value={altMood} onChange={(e) => setAltMood(e.target.value)} title="Mood / voice">
              {TONE_OPTIONS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </SelectControl>
          </div>
          {altBusy && (
            <div className="st-capalts-skeleton">
              <span className="st-chip-skel" style={{ width: 140 }} />
              <span className="st-chip-skel" style={{ width: 110 }} />
              <span className="st-chip-skel" style={{ width: 125 }} />
            </div>
          )}
          {altErr && (
            <div className="st-capalt-err" onClick={() => setAltErr(null)} title="Click to dismiss">
              ⚠ Could not generate alternatives: {altErr}
            </div>
          )}
        </div>
        )}

        <div className="st-field">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <label style={{ margin: 0, display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span>Trim · in / out of source · {fmtSecs(b.durationSec)}</span>
              {b.lockDuration && <LockIcon size={12} title="Duration locked" />}
            </label>
            <label
              className="st-captoggle"
              title={b.lockDuration
                ? "Timeline duration is locked. Changing in or out slips the clip window while preserving exact timeline length."
                : "Lock timeline duration (slip edit). Changing in or out recalculates the other bound to preserve timeline length."}
              style={{ display: "inline-flex", alignItems: "center", gap: 5, cursor: "pointer", fontSize: 11, color: "var(--ink-2)" }}
            >
              <InputControl
                type="checkbox"
                checked={b.lockDuration === true}
                onChange={(e) => update({ ...b, lockDuration: e.target.checked })}
                style={{ accentColor: "var(--accent)", cursor: "pointer" }}
              />
              <span>Lock duration</span>
            </label>
          </div>
          <div
            style={{
              fontSize: 10.5,
              padding: "6px 10px",
              borderRadius: 6,
              marginBottom: 8,
              lineHeight: 1.35,
              background: b.lockDuration
                ? "color-mix(in srgb, var(--accent) 10%, transparent)"
                : "var(--panel-2)",
              border: `1px solid ${b.lockDuration ? "color-mix(in srgb, var(--accent) 35%, transparent)" : "var(--line)"}`,
              color: b.lockDuration ? "var(--accent)" : "var(--ink-2)",
            }}
          >
            {b.lockDuration ? (
              <span style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
                <LockIcon size={13} />
                <span><strong>Duration locked ({fmtSecs(b.durationSec)})</strong>: Changing IN or OUT performs a slip edit—shifting the footage window while the timeline duration will be unchanged.</span>
              </span>
            ) : (
              <span style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
                <UnlockIcon size={13} />
                <span><strong>Unlocked duration</strong>: Changing IN or OUT trims footage and expands/shrinks beat length on the timeline. Check <strong>Lock duration</strong> for slip editing.</span>
              </span>
            )}
          </div>
          {clip && (
            <fieldset className="st-duration-presets">
              <legend>Beat duration</legend>
              <div className="st-duration-hint">Length in seconds. Adjusting the trim handles switches to Custom.</div>
              {durationOptions.map((option) => (
                <label key={option.value} title={option.seconds > clip.durationSec ? "This clip is shorter than the selected duration" : undefined}>
                  <InputControl
                    type="radio"
                    name={`beat-duration-${b.id}`}
                    value={option.value}
                    checked={(b.durationPreset ?? (Math.abs(b.durationSec - 5) < 0.001 ? "5" : "custom")) === option.value}
                    disabled={option.seconds > clip.durationSec}
                    onChange={() => setBeatDuration(option.seconds, option.value)}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
              <label>
                <InputControl
                  type="radio"
                  name={`beat-duration-${b.id}`}
                  value="custom"
                  checked={(b.durationPreset ?? (Math.abs(b.durationSec - 5) < 0.001 ? "5" : "custom")) === "custom"}
                  onChange={() => update({ ...b, durationPreset: "custom" })}
                />
                <span>Custom</span>
              </label>
              {(b.durationPreset ?? (Math.abs(b.durationSec - 5) < 0.001 ? "5" : "custom")) === "custom" && (
                <label className="st-duration-custom">
                  <InputControl
                    type="number"
                    min={0.1}
                    max={clip.durationSec}
                    step={0.1}
                    value={Number(b.durationSec.toFixed(1))}
                    onChange={(e) => {
                      if (e.target.value === "") return;
                      setBeatDuration(Number(e.target.value), "custom");
                    }}
                    aria-label="Custom beat duration in seconds"
                  />
                </label>
              )}
            </fieldset>
          )}
          {clip && (
            <div
              role="button"
              tabIndex={0}
              aria-expanded={trimOpen}
              onClick={() => setTrimOpen((open) => !open)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setTrimOpen((open) => !open);
                }
              }}
              style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", userSelect: "none", padding: "2px 0 4px" }}
            >
              <ChevronDownIcon
                size={14}
                style={{ transform: trimOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s ease", color: "var(--ink-2)" }}
              />
              <label style={{ margin: 0, cursor: "pointer" }}>Source Preview</label>
              <span style={{ fontSize: 10, color: "var(--accent)", fontWeight: 600 }}>
                • {fmtSecs(b.inSec)}–{fmtSecs(b.outSec)}
              </span>
            </div>
          )}
          {clip
            ? <BeatTrimmer beat={b} clip={clip} compact={!trimOpen} onChange={setTrim} lockDuration={b.lockDuration} />
            : <div style={{ color: "var(--ink-3)", fontSize: 12 }}>Clip missing.</div>}
          {clip && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              {trimHistory.length > 0 && (
                <ControlButton
                  type="button"
                  className="st-btn ghost"
                  onClick={undoTrim}
                  title="Undo previous trim change"
                  style={{
                    fontSize: 11.5,
                    padding: "5px 10px",
                    color: "var(--accent)",
                    borderColor: "color-mix(in srgb, var(--accent) 40%, transparent)",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  ↩ Undo Trim ({fmtSecs(trimHistory[trimHistory.length - 1].inSec)}–{fmtSecs(trimHistory[trimHistory.length - 1].outSec)})
                </ControlButton>
              )}
            </div>
          )}
        </div>

        {/* Split Screen Treatment Card */}
        <div className="st-field">
          <div
            role="button"
            tabIndex={0}
            aria-expanded={splitScreenOpen}
            onClick={() => setSplitScreenOpen((open) => !open)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setSplitScreenOpen((open) => !open);
              }
            }}
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", userSelect: "none", padding: "2px 0" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <ChevronDownIcon
                size={14}
                style={{ transform: splitScreenOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s ease", color: "var(--ink-2)" }}
              />
              <label style={{ margin: 0, cursor: "pointer" }}>Split Screen Layout</label>
              {b.splitScreen && b.splitScreen.layout !== "none" && (
                <span style={{ fontSize: 10, color: "var(--accent)", fontWeight: 600 }}>
                  • {({
                    "v2-stacked": "Top / Bottom",
                    "v2-side": "Left / Right",
                    "3-col": "3 Columns",
                    "4-grid": "2×2 Grid",
                  } as Record<string, string>)[b.splitScreen.layout]}
                </span>
              )}
            </div>
          </div>

          <div className={"st-color-collapsible" + (splitScreenOpen ? " open" : "")}>
            <div className="st-color-collapsible-inner">
              <div style={{ background: "var(--panel-2)", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", marginTop: 6 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: b.splitScreen && b.splitScreen.layout !== "none" ? 8 : 0 }}>
            <span style={{ fontSize: 11, color: "var(--ink-2)" }}>Layout</span>
            <SelectControl
              value={b.splitScreen?.layout ?? "none"}
              onChange={(e) => {
                const layout = e.target.value as SplitLayoutType;
                if (layout === "none") {
                  const { splitScreen: _drop, ...rest } = b;
                  update(rest);
                } else {
                  const norm = normalizeSplitConfig({ layout, slots: b.splitScreen?.slots ?? [] }, clip?.id ?? b.clipId, b.inSec);
                  update({ ...b, splitScreen: norm });
                }
              }}
              style={{ fontSize: 11, padding: "3px 8px", background: "var(--panel)", color: "var(--ink)", border: "1px solid var(--line)", borderRadius: 4, width: "auto" }}
            >
              <option value="none">Single clip (none)</option>
              <option value="v2-stacked">Top / bottom stack (2)</option>
              <option value="v2-side">Left / right side (2)</option>
              <option value="3-col">3-column split (3)</option>
              <option value="4-grid">2×2 grid (4)</option>
            </SelectControl>
          </div>

          {b.splitScreen && b.splitScreen.layout !== "none" && (() => {
            const norm = normalizeSplitConfig(b.splitScreen, clip?.id ?? b.clipId, b.inSec);
            const allClips: Clip[] = state.clips ?? [];

            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
                {norm.slots.map((slot, idx) => {
                  const slotClip = allClips.find((c) => c.id === slot.clipId) ?? clip;
                  const blobUrl = slotClip ? getClipBlobUrl(slotClip.file) : null;

                  return (
                    <div key={idx} style={{ background: "var(--panel)", padding: 8, borderRadius: 6, border: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 11, fontWeight: 600 }}>
                        <span>Slot {idx + 1} {idx === 0 ? "(Primary)" : ""}</span>
                        <label style={{ display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer", fontSize: 10, color: "var(--ink-2)" }}>
                          <InputControl
                            type="checkbox"
                            checked={(slot.volume ?? (idx === 0 ? 1 : 0)) > 0}
                            onChange={(e) => {
                              const newSlots = [...norm.slots];
                              newSlots[idx] = { ...slot, volume: e.target.checked ? 1 : 0 };
                              update({ ...b, splitScreen: { ...norm, slots: newSlots } });
                            }}
                            style={{ accentColor: "var(--accent)" }}
                          />
                          <span>Audio</span>
                        </label>
                      </div>

                      {/* Visual Clip Thumbnail Card Button */}
                      <div
                        onClick={() => setPickerSlotIndex(idx)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          background: "var(--panel-2)",
                          border: "1px solid var(--line)",
                          borderRadius: 6,
                          padding: 6,
                          cursor: "pointer",
                          transition: "all 0.15s ease",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#8b7cff"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--line)"; }}
                        title="Click to change clip"
                      >
                        <div style={{ width: 44, height: 32, borderRadius: 4, overflow: "hidden", background: "#000", flexShrink: 0, position: "relative" }}>
                          {slotClip?.kind === "still" ? (
                            <img src={blobUrl ?? undefined} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                          ) : (
                            <video src={blobUrl ?? undefined} style={{ width: "100%", height: "100%", objectFit: "cover" }} muted playsInline />
                          )}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {slotClip?.name ?? "Select clip..."}
                          </div>
                          <div style={{ fontSize: 10, color: "var(--ink-3)" }}>
                            {slotClip ? fmtSecs(slotClip.durationSec) : "No clip selected"}
                          </div>
                        </div>
                        <ControlButton
                          type="button"
                          className="st-btn ghost"
                          style={{ fontSize: 10, padding: "2px 6px" }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setPickerSlotIndex(idx);
                          }}
                        >
                          Change ▾
                        </ControlButton>
                      </div>

                      {/* Per-Slot Reframing & Transform Sliders */}
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 2, background: "var(--panel-2)", padding: 8, borderRadius: 6, border: "1px solid var(--line)" }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "var(--ink-2)", textTransform: "uppercase", letterSpacing: "0.4px" }}>Slot Reframing & Transform</div>

                        {/* Scale / Zoom */}
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 10, width: 44, color: "var(--ink-2)" }}>Scale</span>
                          <InputControl
                            type="range"
                            min={1}
                            max={3}
                            step={0.05}
                            value={slot.scale ?? 1}
                            onChange={(e) => {
                              const newSlots = [...norm.slots];
                              newSlots[idx] = { ...slot, scale: Number(e.target.value) };
                              update({ ...b, splitScreen: { ...norm, slots: newSlots } });
                            }}
                            onDoubleClick={() => {
                              const newSlots = [...norm.slots];
                              newSlots[idx] = { ...slot, scale: 1 };
                              update({ ...b, splitScreen: { ...norm, slots: newSlots } });
                            }}
                            style={sliderTrackStyle(slot.scale ?? 1, 1, 3)}
                            title="Double-click to reset scale to 1.0"
                          />
                          <span style={{ fontSize: 10, width: 32, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
                            {(slot.scale ?? 1).toFixed(2)}x
                          </span>
                        </div>

                        {/* Pan X */}
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 10, width: 44, color: "var(--ink-2)" }}>Pan X</span>
                          <InputControl
                            type="range"
                            min={-50}
                            max={50}
                            step={1}
                            value={slot.panX ?? 0}
                            onChange={(e) => {
                              const newSlots = [...norm.slots];
                              newSlots[idx] = { ...slot, panX: Number(e.target.value) };
                              update({ ...b, splitScreen: { ...norm, slots: newSlots } });
                            }}
                            onDoubleClick={() => {
                              const newSlots = [...norm.slots];
                              newSlots[idx] = { ...slot, panX: 0 };
                              update({ ...b, splitScreen: { ...norm, slots: newSlots } });
                            }}
                            style={sliderTrackStyle(slot.panX ?? 0, -50, 50)}
                            title="Double-click to reset Pan X to 0"
                          />
                          <span style={{ fontSize: 10, width: 32, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
                            {slot.panX ?? 0}%
                          </span>
                        </div>

                        {/* Pan Y */}
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 10, width: 44, color: "var(--ink-2)" }}>Pan Y</span>
                          <InputControl
                            type="range"
                            min={-50}
                            max={50}
                            step={1}
                            value={slot.panY ?? 0}
                            onChange={(e) => {
                              const newSlots = [...norm.slots];
                              newSlots[idx] = { ...slot, panY: Number(e.target.value) };
                              update({ ...b, splitScreen: { ...norm, slots: newSlots } });
                            }}
                            onDoubleClick={() => {
                              const newSlots = [...norm.slots];
                              newSlots[idx] = { ...slot, panY: 0 };
                              update({ ...b, splitScreen: { ...norm, slots: newSlots } });
                            }}
                            style={sliderTrackStyle(slot.panY ?? 0, -50, 50)}
                            title="Double-click to reset Pan Y to 0"
                          />
                          <span style={{ fontSize: 10, width: 32, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
                            {slot.panY ?? 0}%
                          </span>
                        </div>

                        {/* Rotation */}
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 10, width: 44, color: "var(--ink-2)" }}>Rotate</span>
                          <InputControl
                            type="range"
                            min={-180}
                            max={180}
                            step={1}
                            value={slot.rotation ?? 0}
                            onChange={(e) => {
                              const newSlots = [...norm.slots];
                              newSlots[idx] = { ...slot, rotation: Number(e.target.value) };
                              update({ ...b, splitScreen: { ...norm, slots: newSlots } });
                            }}
                            onDoubleClick={() => {
                              const newSlots = [...norm.slots];
                              newSlots[idx] = { ...slot, rotation: 0 };
                              update({ ...b, splitScreen: { ...norm, slots: newSlots } });
                            }}
                            style={sliderTrackStyle(slot.rotation ?? 0, -180, 180)}
                            title="Double-click to reset rotation angle to 0°"
                          />
                          <span style={{ fontSize: 10, width: 32, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
                            {slot.rotation ?? 0}°
                          </span>
                        </div>
                      </div>


                      {/* Pop-Up Modal when active */}
                      {pickerSlotIndex === idx && (
                        <SplitClipPickerModal
                          slotIndex={idx}
                          activeClipId={slot.clipId}
                          clips={allClips}
                          onSelectClip={(newClipId) => {
                            const newSlots = [...norm.slots];
                            newSlots[idx] = { ...slot, clipId: newClipId };
                            update({ ...b, splitScreen: { ...norm, slots: newSlots } });
                          }}
                          onClose={() => setPickerSlotIndex(null)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })()}

              </div>
            </div>
          </div>
        </div>



        <div className="st-field">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              cursor: "pointer",
              userSelect: "none",
              padding: "2px 0",
            }}
            onClick={() => setColorOpen((v) => !v)}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <ChevronDownIcon
                size={14}
                style={{
                  transform: colorOpen ? "rotate(180deg)" : "rotate(0deg)",
                  transition: "transform 0.2s ease",
                  color: "var(--ink-2)",
                }}
              />
              <label style={{ margin: 0, cursor: "pointer" }}>Color Adjustments</label>
              {hasColorAdjustments(b.colorAdjustments) && (
                <span style={{ fontSize: 10, color: "var(--accent)", fontWeight: 600 }}>• Adjusted</span>
              )}
            </div>

            {hasColorAdjustments(b.colorAdjustments) && (
              <ControlButton
                style={{ fontSize: 10, fontWeight: 600, background: "none", border: "none", color: "var(--accent)", cursor: "pointer", padding: 0 }}
                onClick={(e) => {
                  e.stopPropagation();
                  resetColorAdjustments();
                }}
                title="Reset all color adjustments to default"
              >
                Reset color
              </ControlButton>
            )}
          </div>

          <div className={"st-color-collapsible" + (colorOpen ? " open" : "")}>
            <div className="st-color-collapsible-inner">
              <div className="st-color-adjustments" style={{ display: "flex", flexDirection: "column", gap: 8, background: "var(--panel-2)", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11, width: 70, color: "var(--ink-2)" }}>Exposure</span>
                  <InputControl
                    type="range"
                    min="-100"
                    max="100"
                    value={b.colorAdjustments?.exposure ?? 0}
                    onChange={(e) => updateColorAdjustment("exposure", Number(e.target.value))}
                    onDoubleClick={() => updateColorAdjustment("exposure", 0)}
                    title="Drag to adjust, double-click to reset to 0"
                    style={sliderTrackStyle(b.colorAdjustments?.exposure ?? 0)}
                  />
                  <span style={{ fontSize: 10, width: 32, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
                    {(b.colorAdjustments?.exposure ?? 0) > 0 ? `+${b.colorAdjustments?.exposure}` : (b.colorAdjustments?.exposure ?? 0)}
                  </span>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11, width: 70, color: "var(--ink-2)" }}>Contrast</span>
                  <InputControl
                    type="range"
                    min="-100"
                    max="100"
                    value={b.colorAdjustments?.contrast ?? 0}
                    onChange={(e) => updateColorAdjustment("contrast", Number(e.target.value))}
                    onDoubleClick={() => updateColorAdjustment("contrast", 0)}
                    title="Drag to adjust, double-click to reset to 0"
                    style={sliderTrackStyle(b.colorAdjustments?.contrast ?? 0)}
                  />
                  <span style={{ fontSize: 10, width: 32, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
                    {(b.colorAdjustments?.contrast ?? 0) > 0 ? `+${b.colorAdjustments?.contrast}` : (b.colorAdjustments?.contrast ?? 0)}
                  </span>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11, width: 70, color: "var(--ink-2)" }}>Hue</span>
                  <InputControl
                    type="range"
                    min="-100"
                    max="100"
                    value={b.colorAdjustments?.colorTone ?? 0}
                    onChange={(e) => updateColorAdjustment("colorTone", Number(e.target.value))}
                    onDoubleClick={() => updateColorAdjustment("colorTone", 0)}
                    title="Drag to adjust, double-click to reset to 0"
                    style={sliderTrackStyle(b.colorAdjustments?.colorTone ?? 0)}
                  />
                  <span style={{ fontSize: 10, width: 32, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
                    {(b.colorAdjustments?.colorTone ?? 0) > 0 ? `+${b.colorAdjustments?.colorTone}` : (b.colorAdjustments?.colorTone ?? 0)}
                  </span>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11, width: 70, color: "var(--ink-2)" }}>Warmth</span>
                  <InputControl
                    type="range"
                    min="-100"
                    max="100"
                    value={b.colorAdjustments?.warmth ?? 0}
                    onChange={(e) => updateColorAdjustment("warmth", Number(e.target.value))}
                    onDoubleClick={() => updateColorAdjustment("warmth", 0)}
                    title="Drag to adjust, double-click to reset to 0"
                    style={sliderTrackStyle(b.colorAdjustments?.warmth ?? 0)}
                  />
                  <span style={{ fontSize: 10, width: 32, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
                    {(b.colorAdjustments?.warmth ?? 0) > 0 ? `+${b.colorAdjustments?.warmth}` : (b.colorAdjustments?.warmth ?? 0)}
                  </span>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11, width: 70, color: "var(--ink-2)" }}>Orange / Skin</span>
                  <InputControl
                    type="range"
                    min="-100"
                    max="100"
                    value={b.colorAdjustments?.skinTone ?? 0}
                    onChange={(e) => updateColorAdjustment("skinTone", Number(e.target.value))}
                    onDoubleClick={() => updateColorAdjustment("skinTone", 0)}
                    title="Drag to adjust, double-click to reset to 0"
                    style={sliderTrackStyle(b.colorAdjustments?.skinTone ?? 0)}
                  />
                  <span style={{ fontSize: 10, width: 32, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
                    {(b.colorAdjustments?.skinTone ?? 0) > 0 ? `+${b.colorAdjustments?.skinTone}` : (b.colorAdjustments?.skinTone ?? 0)}
                  </span>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11, width: 70, color: "var(--ink-2)" }}>Saturation</span>
                  <InputControl
                    type="range"
                    min="-100"
                    max="100"
                    value={b.colorAdjustments?.saturation ?? 0}
                    onChange={(e) => updateColorAdjustment("saturation", Number(e.target.value))}
                    onDoubleClick={() => updateColorAdjustment("saturation", 0)}
                    title="Drag to adjust, double-click to reset to 0"
                    style={sliderTrackStyle(b.colorAdjustments?.saturation ?? 0)}
                  />
                  <span style={{ fontSize: 10, width: 32, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
                    {(b.colorAdjustments?.saturation ?? 0) > 0 ? `+${b.colorAdjustments?.saturation}` : (b.colorAdjustments?.saturation ?? 0)}
                  </span>
                </div>

                {splitToneRows(b.colorAdjustments ?? {}, updateColorAdjustment)}

                <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                  <ControlButton
                    type="button"
                    className="st-btn ghost"
                    style={{ flex: 1, fontSize: 10, padding: "4px 6px", justifyContent: "center" }}
                    onClick={copyBeatColor}
                    disabled={!hasColorAdjustments(b.colorAdjustments)}
                    title="Copy these color adjustments to clipboard"
                  >
                    {colorCopiedToast ? "✓ Copied!" : "📋 Copy Color"}
                  </ControlButton>

                  <ControlButton
                    type="button"
                    className="st-btn ghost"
                    style={{ flex: 1, fontSize: 10, padding: "4px 6px", justifyContent: "center" }}
                    onClick={pasteBeatColor}
                    disabled={!copiedColor}
                    title={copiedColor ? "Paste copied color adjustments to this beat" : "Copy a color adjustment first to paste"}
                  >
                    📥 Paste Color
                  </ControlButton>
                </div>

                <ControlButton
                  type="button"
                  className="st-btn ghost"
                  style={{ fontSize: 10, padding: "4px 8px", marginTop: 2, alignSelf: "flex-end" }}
                  onClick={applyColorToAllBeats}
                  disabled={!hasColorAdjustments(b.colorAdjustments)}
                  title="Apply these color adjustments to all beats in the cut"
                >
                  Apply color to all beats
                </ControlButton>
              </div>
            </div>
          </div>
        </div>

        {/* Per-Beat Title Treatment Collapsible Section */}
        <div className="st-field" style={{ marginTop: 8 }}>
          <div
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", userSelect: "none", padding: "2px 0" }}
            onClick={() => setTitleOpen((v) => !v)}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <ChevronDownIcon
                size={14}
                style={{ transform: titleOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s ease", color: "var(--ink-2)" }}
              />
              <label style={{ margin: 0, cursor: "pointer" }}>Title Treatment</label>
              {beatTitleCount > 0 && (
                <span style={{ fontSize: 10, color: "var(--accent)", fontWeight: 600 }}>• {beatTitleCount} layer{beatTitleCount === 1 ? "" : "s"}</span>
              )}
            </div>
          </div>

          <div className={"st-color-collapsible" + (titleOpen ? " open" : "")}>
            <div className="st-color-collapsible-inner">
              <div style={{ display: "flex", flexDirection: "column", gap: 12, background: "var(--panel-2)", padding: 12, borderRadius: 8, border: "1px solid var(--line)", marginTop: 6 }}>
                <div className="st-beat-title-index">
                  <div className="st-beat-title-index-head">
                    <div>
                      <strong>Beat title index</strong>
                      <span>Edit title copy here or open its Beat for full styling.</span>
                    </div>
                    <span>{indexedBeatTitles.length} titled</span>
                  </div>

                  {indexedBeatTitles.length > 0 ? (
                    <div className="st-beat-title-index-list">
                      {indexedBeatTitles.map((entry) => {
                        const sourceName = clips.find((candidate) => candidate.id === entry.beat.clipId)?.name;
                        const active = entry.beat.id === b.id;
                        return (
                          <div
                            key={entry.beat.id}
                            className={`st-beat-title-index-item${active ? " active" : ""}`}
                          >
                            <ControlButton
                              type="button"
                              className="st-beat-title-index-jump"
                              onClick={() => {
                                onSelectBeat?.(entry.beat.id);
                                setTitleOpen(true);
                              }}
                              title={`Open Beat ${entry.beatIndex + 1}${sourceName ? ` · ${sourceName}` : ""}`}
                            >
                              <strong>{String(entry.beatIndex + 1).padStart(2, "0")}</strong>
                              <span>{active ? "Current" : "Open"}</span>
                            </ControlButton>
                            <div className="st-beat-title-index-fields">
                              {entry.layers.map((layer, layerIndex) => (
                                <InputControl
                                  key={layer.id}
                                  value={layer.text}
                                  onChange={(event) =>
                                    editIndexedBeatTitle(entry.beat, layer.id, event.target.value)
                                  }
                                  aria-label={`Beat ${entry.beatIndex + 1} title layer ${layerIndex + 1}`}
                                  title={sourceName}
                                />
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="st-beat-title-index-empty">
                      No Beat titles yet. Add one below and it will appear here.
                    </div>
                  )}
                </div>

                <div style={{ fontSize: 11, color: "var(--ink-3)" }}>
                  Titles shown only during this beat. The cut-level intro title (in Export) stays separate.
                </div>
                <TitleTreatmentEditor
                  layers={beatTitleLayers}
                  onChange={(next) => update({ ...b, titleLayers: next })}
                  scopeEntireLabel="Entire beat"
                  introScopeLabel="Beat intro (fade out)"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Beat Zoom / Punch-In Collapsible Section */}
        <div className="st-field" style={{ marginTop: 8 }}>
          <div
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", userSelect: "none", padding: "2px 0" }}
            onClick={() => setZoomOpen((v) => !v)}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <ChevronDownIcon
                size={14}
                style={{ transform: zoomOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s ease", color: "var(--ink-2)" }}
              />
              <label style={{ margin: 0, cursor: "pointer" }}>Zoom / Punch-In</label>
              {(b.zoom ?? 1) > 1.001 && (
                <span style={{ fontSize: 10, color: "var(--accent)", fontWeight: 600 }}>• {(b.zoom ?? 1).toFixed(2)}×</span>
              )}
            </div>

            {(b.zoom ?? 1) > 1.001 && (
              <ControlButton
                style={{ fontSize: 10, fontWeight: 600, background: "none", border: "none", color: "var(--accent)", cursor: "pointer", padding: 0 }}
                onClick={(e) => { e.stopPropagation(); update({ ...b, zoom: 1, zoomX: 0, zoomY: 0, zoomScope: "entire", zoomSec: 3 }); }}
                title="Reset zoom to 1× (no punch-in)"
              >
                Reset zoom
              </ControlButton>
            )}
          </div>

          <div className={"st-color-collapsible" + (zoomOpen ? " open" : "")}>
            <div className="st-color-collapsible-inner">
              <div className="st-color-adjustments" style={{ display: "flex", flexDirection: "column", gap: 8, background: "var(--panel-2)", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", marginTop: 6 }}>

                {/* A Beat's framing is static (Zoom) or moving (Ken Burns) —
                    a mode, never both (ADR-0015). Stills only for now, so a
                    video Beat never sees the switch and keeps the Zoom it had. */}
                {clip?.kind === "still" && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 11, width: 70, color: "var(--ink-2)" }}>Framing</span>
                    <div style={{ display: "inline-flex", border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden" }}>
                      {([["zoom", "Zoom"], ["kenBurns", "Ken Burns"]] as const).map(([mode, label]) => {
                        const on = (b.framing ?? "zoom") === mode;
                        return (
                          <ControlButton
                            key={mode}
                            type="button"
                            onClick={() => update(mode === "kenBurns"
                              // Seed a visible-but-subtle move, and clear the Zoom
                              // so nothing is left set that no longer applies.
                              ? { ...b, framing: "kenBurns", kenBurns: b.kenBurns ?? KEN_BURNS_DEFAULT, zoom: 1, zoomX: 0, zoomY: 0 }
                              : { ...b, framing: "zoom" })}
                            style={{
                              fontSize: 10, padding: "3px 10px", border: "none", cursor: "pointer",
                              background: on ? "rgba(255, 179, 57, 0.15)" : "var(--panel-3)",
                              color: on ? "var(--accent)" : "var(--ink-2)", fontWeight: on ? 600 : 400,
                            }}
                          >
                            {label}
                          </ControlButton>
                        );
                      })}
                    </div>
                  </div>
                )}

                {b.framing === "kenBurns" && clip?.kind === "still" ? (
                  <KenBurnsControls beat={b} clip={clip} aspect={cut?.aspect ?? "16:9"} update={update} />
                ) : (
                <>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11, width: 70, color: "var(--ink-2)" }}>Zoom</span>
                  <InputControl
                    type="range"
                    min={1}
                    max={3}
                    step={0.05}
                    value={b.zoom ?? 1}
                    onChange={(e) => update({ ...b, zoom: Number(e.target.value) })}
                    onDoubleClick={() => update({ ...b, zoom: 1 })}
                    title="Punch-in scale (double-click to reset to 1×)"
                    style={sliderTrackStyle(b.zoom ?? 1, 1, 3)}
                  />
                  <span style={{ fontSize: 10, width: 32, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
                    {(b.zoom ?? 1).toFixed(2)}×
                  </span>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 8, opacity: (b.zoom ?? 1) > 1.001 ? 1 : 0.5 }}>
                  <span style={{ fontSize: 11, width: 70, color: "var(--ink-2)" }}>Focus X</span>
                  <InputControl
                    type="range"
                    min={-50}
                    max={50}
                    step={1}
                    value={b.zoomX ?? 0}
                    disabled={(b.zoom ?? 1) <= 1.001}
                    onChange={(e) => update({ ...b, zoomX: Number(e.target.value) })}
                    onDoubleClick={() => update({ ...b, zoomX: 0 })}
                    title="Pan the punch-in left/right (double-click to center)"
                    style={sliderTrackStyle(b.zoomX ?? 0, -50, 50)}
                  />
                  <span style={{ fontSize: 10, width: 32, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
                    {(b.zoomX ?? 0) > 0 ? `+${b.zoomX}` : (b.zoomX ?? 0)}
                  </span>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 8, opacity: (b.zoom ?? 1) > 1.001 ? 1 : 0.5 }}>
                  <span style={{ fontSize: 11, width: 70, color: "var(--ink-2)" }}>Focus Y</span>
                  <InputControl
                    type="range"
                    min={-50}
                    max={50}
                    step={1}
                    value={b.zoomY ?? 0}
                    disabled={(b.zoom ?? 1) <= 1.001}
                    onChange={(e) => update({ ...b, zoomY: Number(e.target.value) })}
                    onDoubleClick={() => update({ ...b, zoomY: 0 })}
                    title="Pan the punch-in up/down (double-click to center)"
                    style={sliderTrackStyle(b.zoomY ?? 0, -50, 50)}
                  />
                  <span style={{ fontSize: 10, width: 32, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
                    {(b.zoomY ?? 0) > 0 ? `+${b.zoomY}` : (b.zoomY ?? 0)}
                  </span>
                </div>

                <div style={{ display: "flex", gap: 12, alignItems: "center", fontSize: 12, marginTop: 2, opacity: (b.zoom ?? 1) > 1.001 ? 1 : 0.5 }}>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    Show
                    <SelectControl
                      value={b.zoomScope ?? "entire"}
                      disabled={(b.zoom ?? 1) <= 1.001}
                      onChange={(e) => update({ ...b, zoomScope: e.target.value as "entire" | "intro" })}
                      title="Zoom the whole beat, or only punch in for the first few seconds"
                      style={{ background: "var(--panel-3)", border: "1px solid var(--line)", borderRadius: 6, color: "var(--ink)", fontSize: 12, padding: "4px 8px", outline: "none" }}
                    >
                      <option value="entire">Entire beat</option>
                      <option value="intro">First seconds</option>
                    </SelectControl>
                  </label>
                  {(b.zoomScope ?? "entire") === "intro" && (
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      Duration
                      <SelectControl
                        value={b.zoomSec ?? 3}
                        disabled={(b.zoom ?? 1) <= 1.001}
                        onChange={(e) => update({ ...b, zoomSec: Number(e.target.value) })}
                        style={{ background: "var(--panel-3)", border: "1px solid var(--line)", borderRadius: 6, color: "var(--ink)", fontSize: 12, padding: "4px 8px", outline: "none" }}
                      >
                        <option value={1}>1s</option>
                        <option value={2}>2s</option>
                        <option value={3}>3s</option>
                        <option value={4}>4s</option>
                        <option value={5}>5s</option>
                      </SelectControl>
                    </label>
                  )}
                </div>
                </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Rotation — its own section, independent of zoom. It has its own pivot
            (the frame centre, matching ffmpeg's rotate) and its own cover scale,
            so it composes with zoom rather than sharing a transform with it. */}
        <div className="st-field" style={{ marginTop: 8 }}>
          <div
            role="button"
            tabIndex={0}
            aria-expanded={rotationOpen}
            onClick={() => setRotationOpen((open) => !open)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setRotationOpen((open) => !open);
              }
            }}
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", userSelect: "none", padding: "2px 0" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <ChevronDownIcon
                size={14}
                style={{ transform: rotationOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s ease", color: "var(--ink-2)" }}
              />
              <label style={{ margin: 0, cursor: "pointer" }}>Rotation & Orientation</label>
              {Math.abs(b.rotation ?? 0) >= 0.05 && (
                <span style={{ fontSize: 10, color: "var(--accent)", fontWeight: 600 }}>
                  • {(b.rotation ?? 0) > 0 ? "+" : ""}{(b.rotation ?? 0).toFixed(1)}°
                </span>
              )}
            </div>
            {Math.abs(b.rotation ?? 0) >= 0.05 && (
              <ControlButton
                style={{ fontSize: 10, fontWeight: 600, background: "none", border: "none", color: "var(--accent)", cursor: "pointer", padding: 0 }}
                onClick={(e) => { e.stopPropagation(); update({ ...b, rotation: 0 }); }}
                onPointerDown={(e) => e.stopPropagation()}
                title="Reset rotation to 0°"
              >
                Reset rotation
              </ControlButton>
            )}
          </div>

          <div className={"st-color-collapsible" + (rotationOpen ? " open" : "")}>
            <div className="st-color-collapsible-inner">
              <div className="st-color-adjustments" style={{ background: "var(--panel-2)", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", marginTop: 6, display: "flex", flexDirection: "column", gap: 10 }}>
                {/* Quick orientation presets (180° Flip for upside down videos, 90° turn) */}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11, width: 70, color: "var(--ink-2)" }}>Quick Fix</span>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", flex: 1 }}>
                    <ControlButton
                      type="button"
                      onClick={(e) => { e.stopPropagation(); update({ ...b, rotation: (Math.abs(b.rotation ?? 0) === 180 ? 0 : 180) }); }}
                      onPointerDown={(e) => e.stopPropagation()}
                      title="Flip 180° (Fix upside-down video)"
                      style={{
                        fontSize: 11,
                        padding: "3px 8px",
                        background: Math.abs(b.rotation ?? 0) === 180 ? "rgba(255, 179, 57, 0.25)" : "var(--panel-3)",
                        border: Math.abs(b.rotation ?? 0) === 180 ? "1px solid var(--accent)" : "1px solid var(--line)",
                        color: Math.abs(b.rotation ?? 0) === 180 ? "var(--accent)" : "var(--ink)",
                        fontWeight: Math.abs(b.rotation ?? 0) === 180 ? 600 : 400,
                        borderRadius: 6,
                        cursor: "pointer",
                      }}
                    >
                      🙃 180° Flip
                    </ControlButton>
                    <ControlButton
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        const cur = b.rotation ?? 0;
                        const next = cur - 90;
                        const normalized = next < -180 ? next + 360 : next;
                        update({ ...b, rotation: normalized });
                      }}
                      onPointerDown={(e) => e.stopPropagation()}
                      title="Rotate 90° counter-clockwise"
                      style={{
                        fontSize: 11,
                        padding: "3px 8px",
                        background: "var(--panel-3)",
                        border: "1px solid var(--line)",
                        color: "var(--ink)",
                        borderRadius: 6,
                        cursor: "pointer",
                      }}
                    >
                      ↺ -90°
                    </ControlButton>
                    <ControlButton
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        const cur = b.rotation ?? 0;
                        const next = cur + 90;
                        const normalized = next > 180 ? next - 360 : next;
                        update({ ...b, rotation: normalized });
                      }}
                      onPointerDown={(e) => e.stopPropagation()}
                      title="Rotate 90° clockwise"
                      style={{
                        fontSize: 11,
                        padding: "3px 8px",
                        background: "var(--panel-3)",
                        border: "1px solid var(--line)",
                        color: "var(--ink)",
                        borderRadius: 6,
                        cursor: "pointer",
                      }}
                    >
                      ↻ +90°
                    </ControlButton>
                    {Math.abs(b.rotation ?? 0) >= 0.05 && (
                      <ControlButton
                        type="button"
                        onClick={(e) => { e.stopPropagation(); update({ ...b, rotation: 0 }); }}
                        onPointerDown={(e) => e.stopPropagation()}
                        title="Reset rotation to 0°"
                        style={{
                          fontSize: 11,
                          padding: "3px 8px",
                          background: "var(--panel-3)",
                          border: "1px solid var(--line)",
                          color: "var(--ink-2)",
                          borderRadius: 6,
                          cursor: "pointer",
                        }}
                      >
                        0° Reset
                      </ControlButton>
                    )}
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11, width: 70, color: "var(--ink-2)" }}>Angle</span>
                  <InputControl
                    type="range" min={-180} max={180} step={0.5}
                    value={b.rotation ?? 0}
                    onChange={(e) => update({ ...b, rotation: Number(e.target.value) })}
                    onDoubleClick={() => update({ ...b, rotation: 0 })}
                    title="Rotation angle (-180° to +180°). Double-click to reset."
                    style={sliderTrackStyle(b.rotation ?? 0, -180, 180)}
                  />
                  <span style={{ fontSize: 10, width: 40, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
                    {(b.rotation ?? 0) > 0 ? `+${(b.rotation ?? 0).toFixed(1)}` : (b.rotation ?? 0).toFixed(1)}°
                  </span>
                </div>
                {Math.abs(b.rotation ?? 0) >= 0.05 && Math.abs(b.rotation ?? 0) !== 180 && (
                  <div style={{ fontSize: 10, color: "var(--ink-3)", marginLeft: 78, marginTop: 2 }}>
                    Corners show — zoom to {rotationCoverScale(...canvasDims(cut?.aspect ?? "16:9"), b.rotation).toFixed(2)}× to hide them
                  </div>
                )}
                {((b.zoom ?? 1) > 1.001 || (b.zoomX ?? 0) !== 0 || (b.zoomY ?? 0) !== 0) && (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--panel-3)", padding: "4px 8px", borderRadius: 6, fontSize: 10, color: "var(--ink-2)", marginTop: 4 }}>
                    <span>Active Zoom: {(b.zoom ?? 1).toFixed(2)}× (focus: {b.zoomX ?? 0}, {b.zoomY ?? 0})</span>
                    <ControlButton
                      type="button"
                      onClick={(e) => { e.stopPropagation(); update({ ...b, zoom: 1, zoomX: 0, zoomY: 0 }); }}
                      onPointerDown={(e) => e.stopPropagation()}
                      style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontWeight: 600, padding: 0 }}
                    >
                      Reset Zoom
                    </ControlButton>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Video Transition Collapsible Section */}
        <div className="st-field" style={{ marginTop: 8 }}>
          <div>
            <div
              role="button"
              tabIndex={0}
              aria-expanded={transitionOpen}
              onClick={() => setTransitionOpen((open) => !open)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setTransitionOpen((open) => !open);
                }
              }}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", userSelect: "none", padding: "2px 0" }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <ChevronDownIcon
                  size={14}
                  style={{ transform: transitionOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s ease", color: "var(--ink-2)" }}
                />
                <label style={{ margin: 0, cursor: "pointer" }}>Video Transition</label>
                {b.transition && b.transition !== "none" && (
                  <span className="st-transition-summary">
                    • {b.transition} ({b.transitionSec ?? 0.5}s)
                  </span>
                )}
              </div>
            </div>

            {transitionOpen && (
              <div className="st-transition-fields">
                <label className="st-transition-row">
                  <span>Effect</span>
                  <SelectControl
                    value={b.transition ?? "none"}
                    onChange={(e) => update({ ...b, transition: e.target.value as VideoTransitionType })}
                  >
                    <option value="none">Cut (none)</option>
                    <option value="fade">Crossfade</option>
                    <option value="fadeblack">Fade to black</option>
                    <option value="fadewhite">Fade to white</option>
                    <option value="wipeleft">Wipe left</option>
                    <option value="wiperight">Wipe right</option>
                    <option value="slideleft">Slide left</option>
                    <option value="slideright">Slide right</option>
                  </SelectControl>
                </label>

                {b.transition && b.transition !== "none" && (
                  <>
                    <label className="st-transition-row">
                      <span>Position</span>
                      <SelectControl
                        value={b.transitionPosition ?? "start"}
                        onChange={(e) => update({ ...b, transitionPosition: e.target.value as "start" | "end" })}
                      >
                        <option value="start">Beginning of beat</option>
                        <option value="end">End of beat</option>
                      </SelectControl>
                    </label>

                    <label className="st-transition-row">
                      <span>Duration</span>
                      <SelectControl
                        value={b.transitionSec ?? 0.5}
                        onChange={(e) => update({ ...b, transitionSec: Number(e.target.value) })}
                      >
                        <option value={0.3}>0.3s · Fast</option>
                        <option value={0.5}>0.5s · Standard</option>
                        <option value={0.8}>0.8s · Smooth</option>
                        <option value={1.0}>1.0s · Slow</option>
                      </SelectControl>
                    </label>

                    <ControlButton
                      type="button"
                      className="st-btn ghost"
                      style={{ fontSize: 10, padding: "4px 8px", marginTop: 2, alignSelf: "flex-end" }}
                      onClick={applyTransitionToAllBeats}
                      title="Apply this transition effect to all beats in the cut"
                    >
                      Apply to all beats
                    </ControlButton>
                  </>
                )}
              </div>
            )}

            {/* Beat Audio Volume Settings */}
            <div className="st-field" style={{ marginTop: 10 }}>
              <div
                role="button"
                tabIndex={0}
                aria-expanded={beatAudioOpen}
                onClick={() => setBeatAudioOpen((open) => !open)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setBeatAudioOpen((open) => !open);
                  }
                }}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", userSelect: "none", padding: "2px 0" }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <ChevronDownIcon
                    size={14}
                    style={{ transform: beatAudioOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s ease", color: "var(--ink-2)" }}
                  />
                  <label style={{ margin: 0, cursor: "pointer" }}>Beat Audio Volume</label>
                  <span style={{ fontSize: 10, color: "var(--accent)", fontWeight: 600 }}>
                    • {Math.round((b.volume ?? 1) * 100)}%
                  </span>
                </div>
              </div>

              <div className={"st-color-collapsible" + (beatAudioOpen ? " open" : "")}>
                <div className="st-color-collapsible-inner">
                  <div className="st-color-adjustments" style={{ background: "var(--panel-2)", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", marginTop: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 11, width: 70, color: "var(--ink-2)" }}>Volume</span>
                      <InputControl
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={b.volume ?? 1}
                        onChange={(e) => update({ ...b, volume: Number(e.target.value) })}
                        style={sliderTrackStyle(b.volume ?? 1, 0, 1)}
                        title="Adjust the original audio volume of this beat's video clip"
                      />
                      <span style={{ width: 36, textAlign: "right", fontSize: 10, color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
                        {Math.round((b.volume ?? 1) * 100)}%
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Global Cut Color Filter Card */}
            <div className="st-field" style={{ marginTop: 10 }}>
              <div
                role="button"
                tabIndex={0}
                aria-expanded={globalFilterOpen}
                onClick={() => setGlobalFilterOpen((open) => !open)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setGlobalFilterOpen((open) => !open);
                  }
                }}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", userSelect: "none", padding: "2px 0" }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <ChevronDownIcon
                    size={14}
                    style={{ transform: globalFilterOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s ease", color: "var(--ink-2)" }}
                  />
                  <label style={{ margin: 0, cursor: "pointer" }}>Global Filter</label>
                  {activeGlobalFilter && (
                    <span style={{ fontSize: 10, color: "var(--accent)", fontWeight: 600 }}>• {activeGlobalFilter.name}</span>
                  )}
                </div>
              </div>

              <div className={"st-color-collapsible" + (globalFilterOpen ? " open" : "")}>
                <div className="st-color-collapsible-inner">
                  <div style={{ background: "var(--panel-2)", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", marginTop: 6 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 11, color: "var(--ink-2)" }}>{activeGlobalFilter ? "Preset" : "Choose a color preset"}</span>
                <ControlButton
                  type="button"
                  className="st-btn ghost"
                  style={{
                    padding: "2px 8px",
                    fontSize: 11,
                    borderColor: activeGlobalFilter ? "var(--accent)" : undefined,
                    color: activeGlobalFilter ? "var(--accent)" : undefined,
                  }}
                  onClick={() => setFilterModalOpen(true)}
                  title="Choose a global color grading filter preset for the entire cut"
                >
                  {activeGlobalFilter ? activeGlobalFilter.name : "Choose preset"}
                </ControlButton>
              </div>

              {activeGlobalFilter && (
                <div style={{ marginTop: 8, padding: 10, background: "var(--panel-2)", borderRadius: 6, border: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 11, color: "var(--ink-2)" }}>Filter Intensity: {Math.round((cut?.globalFilterIntensity ?? 1) * 100)}%</span>
                    <ControlButton
                      type="button"
                      style={{ background: "none", border: "none", color: "var(--danger)", fontSize: 11, cursor: "pointer", padding: 0 }}
                      onClick={() => dispatch({ type: "SET_GLOBAL_FILTER", filterId: null })}
                    >
                      Remove Filter
                    </ControlButton>
                  </div>
                  <InputControl
                    type="range"
                    min="0.1"
                    max="1"
                    step="0.05"
                    value={cut?.globalFilterIntensity ?? 1}
                    onChange={(e) => dispatch({ type: "SET_GLOBAL_FILTER", filterId: cut?.globalFilterId ?? null, intensity: Number(e.target.value) })}
                    style={sliderTrackStyle(cut?.globalFilterIntensity ?? 1, 0.1, 1)}
                  />

                  <div className="st-color-adjustments" style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--accent)" }}>
                        🎛️ Fine-Tune Filter {isGlobalFilterModified ? <span style={{ fontSize: 10, fontStyle: "italic", fontWeight: 400, color: "var(--ink-3)" }}>(Modified)</span> : null}
                      </div>
                      {isGlobalFilterModified && (
                        <ControlButton
                          type="button"
                          className="st-btn ghost"
                          style={{ fontSize: 10, padding: "2px 6px", height: 20, color: "var(--accent)", display: "flex", alignItems: "center", gap: 3 }}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={() => {
                            dispatch({
                              type: "SET_GLOBAL_FILTER",
                              filterId: cut?.globalFilterId ?? null,
                              intensity: cut?.globalFilterIntensity ?? 1,
                              adjustments: activeGlobalFilter ? { ...activeGlobalFilter.colorAdjustments } : {},
                            });
                          }}
                          title="Reset fine-tuning adjustments back to original preset defaults"
                        >
                          ↺ Reset Preset
                        </ControlButton>
                      )}
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 11, width: 70, color: "var(--ink-2)" }}>Exposure</span>
                      <InputControl
                        type="range"
                        min="-100"
                        max="100"
                        value={currentGlobalAdj.exposure ?? 0}
                        onChange={(e) => updateGlobalAdj("exposure", Number(e.target.value))}
                        onDoubleClick={() => updateGlobalAdj("exposure", activeGlobalFilter?.colorAdjustments?.exposure ?? 0)}
                        style={sliderTrackStyle(currentGlobalAdj.exposure ?? 0, -100, 100)}
                      />
                      <span style={{ fontSize: 10, width: 32, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
                        {(currentGlobalAdj.exposure ?? 0) > 0 ? `+${currentGlobalAdj.exposure}` : (currentGlobalAdj.exposure ?? 0)}
                      </span>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 11, width: 70, color: "var(--ink-2)" }}>Contrast</span>
                      <InputControl
                        type="range"
                        min="-100"
                        max="100"
                        value={currentGlobalAdj.contrast ?? 0}
                        onChange={(e) => updateGlobalAdj("contrast", Number(e.target.value))}
                        onDoubleClick={() => updateGlobalAdj("contrast", activeGlobalFilter?.colorAdjustments?.contrast ?? 0)}
                        style={sliderTrackStyle(currentGlobalAdj.contrast ?? 0, -100, 100)}
                      />
                      <span style={{ fontSize: 10, width: 32, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
                        {(currentGlobalAdj.contrast ?? 0) > 0 ? `+${currentGlobalAdj.contrast}` : (currentGlobalAdj.contrast ?? 0)}
                      </span>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 11, width: 70, color: "var(--ink-2)" }}>Hue</span>
                      <InputControl
                        type="range"
                        min="-100"
                        max="100"
                        value={currentGlobalAdj.colorTone ?? 0}
                        onChange={(e) => updateGlobalAdj("colorTone", Number(e.target.value))}
                        onDoubleClick={() => updateGlobalAdj("colorTone", activeGlobalFilter?.colorAdjustments?.colorTone ?? 0)}
                        style={sliderTrackStyle(currentGlobalAdj.colorTone ?? 0, -100, 100)}
                      />
                      <span style={{ fontSize: 10, width: 32, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
                        {(currentGlobalAdj.colorTone ?? 0) > 0 ? `+${currentGlobalAdj.colorTone}` : (currentGlobalAdj.colorTone ?? 0)}
                      </span>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 11, width: 70, color: "var(--ink-2)" }}>Warmth</span>
                      <InputControl
                        type="range"
                        min="-100"
                        max="100"
                        value={currentGlobalAdj.warmth ?? 0}
                        onChange={(e) => updateGlobalAdj("warmth", Number(e.target.value))}
                        onDoubleClick={() => updateGlobalAdj("warmth", activeGlobalFilter?.colorAdjustments?.warmth ?? 0)}
                        style={sliderTrackStyle(currentGlobalAdj.warmth ?? 0, -100, 100)}
                      />
                      <span style={{ fontSize: 10, width: 32, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
                        {(currentGlobalAdj.warmth ?? 0) > 0 ? `+${currentGlobalAdj.warmth}` : (currentGlobalAdj.warmth ?? 0)}
                      </span>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 11, width: 70, color: "var(--ink-2)" }}>Saturation</span>
                      <InputControl
                        type="range"
                        min="-100"
                        max="100"
                        value={currentGlobalAdj.saturation ?? 0}
                        onChange={(e) => updateGlobalAdj("saturation", Number(e.target.value))}
                        onDoubleClick={() => updateGlobalAdj("saturation", activeGlobalFilter?.colorAdjustments?.saturation ?? 0)}
                        style={sliderTrackStyle(currentGlobalAdj.saturation ?? 0, -100, 100)}
                      />
                      <span style={{ fontSize: 10, width: 32, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
                        {(currentGlobalAdj.saturation ?? 0) > 0 ? `+${currentGlobalAdj.saturation}` : (currentGlobalAdj.saturation ?? 0)}
                      </span>
                    </div>
                    {splitToneRows(currentGlobalAdj, updateGlobalAdj, activeGlobalFilter?.colorAdjustments)}
                  </div>
                </div>
              )}
                  </div>
                </div>
              </div>
            </div>

            {filterModalOpen && (
              <FilterPresetModal
                activeFilterId={cut?.globalFilterId}
                activeIntensity={cut?.globalFilterIntensity}
                activeAdjustments={cut?.globalFilterAdjustments}
                onSelectFilter={(filterId, intensity, adjustments) => {
                  dispatch({ type: "SET_GLOBAL_FILTER", filterId, intensity, adjustments });
                }}
                onClose={() => setFilterModalOpen(false)}
              />
            )}

            {/* Overlay Clip Inspector Card */}
            {selectedOverlay && (
              <div className="st-sec" style={{ marginTop: 10, background: "var(--panel-2)", padding: 12, borderRadius: 8, border: "1px solid var(--accent)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--accent)" }}>🎞️ Overlay Clip Settings</span>
                  <div style={{ display: "flex", gap: 6 }}>
                    <ControlButton
                      type="button"
                      className="st-btn ghost"
                      style={{ padding: "2px 8px", fontSize: 11 }}
                      onClick={() => {
                        const genId = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
                        const newId = `overlay-${genId()}`;
                        dispatch({ type: "DUPLICATE_OVERLAY", id: selectedOverlay.id, newOverlayId: newId });
                        onSelectOverlay?.(newId);
                      }}
                      title="Duplicate this overlay clip (Cmd+D / Ctrl+D)"
                    >
                      📋 Duplicate
                    </ControlButton>
                    <ControlButton
                      type="button"
                      className="st-btn danger"
                      style={{ padding: "2px 8px", fontSize: 11 }}
                      onClick={() => onRequestDeleteSegment("overlay", selectedOverlay.id, clips.find((item) => item.id === selectedOverlay.clipId)?.name ?? "Overlay clip")}
                    >
                      Remove
                    </ControlButton>
                  </div>
                </div>

                {/* Clip Selector */}
                <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
                  <label style={{ fontSize: 11, color: "var(--ink-2)" }}>Overlay Footage Clip</label>
                  <SelectControl
                    value={selectedOverlay.clipId}
                    onChange={(e) => dispatch({ type: "UPDATE_OVERLAY", overlay: { ...selectedOverlay, clipId: e.target.value } })}
                    style={{ background: "var(--panel-3)", border: "1px solid var(--line)", borderRadius: 6, color: "var(--ink)", padding: "4px 8px", fontSize: 12 }}
                  >
                    {clips.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </SelectControl>
                </div>

                {/* Blend Mode Selector */}
                <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
                  <label style={{ fontSize: 11, color: "var(--ink-2)" }}>Visual Blend Mode</label>
                  <SelectControl
                    value={selectedOverlay.blendMode}
                    onChange={(e) => dispatch({ type: "UPDATE_OVERLAY", overlay: { ...selectedOverlay, blendMode: e.target.value as any } })}
                    style={{ background: "var(--panel-3)", border: "1px solid var(--line)", borderRadius: 6, color: "var(--accent)", fontWeight: 600, padding: "4px 8px", fontSize: 12 }}
                  >
                    <option value="normal">Normal / Overwrite Opacity</option>
                    <option value="screen">Screen (Lighten Blend)</option>
                    <option value="multiply">Multiply (Darken Blend)</option>
                    <option value="overlay">Overlay (Contrast Blend)</option>
                  </SelectControl>
                </div>

                {/* Opacity Slider */}
                <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                    <span>Opacity</span>
                    <span>{Math.round(selectedOverlay.opacity * 100)}%</span>
                  </div>
                  <InputControl
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={selectedOverlay.opacity}
                    onChange={(e) => dispatch({ type: "UPDATE_OVERLAY", overlay: { ...selectedOverlay, opacity: Number(e.target.value) } })}
                    style={sliderTrackStyle(selectedOverlay.opacity, 0, 1)}
                  />
                </div>

                {/* Audio Volume Slider */}
                <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                    <span>Audio Volume</span>
                    <span>{Math.round(selectedOverlay.volume * 100)}%</span>
                  </div>
                  <InputControl
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={selectedOverlay.volume}
                    onChange={(e) => dispatch({ type: "UPDATE_OVERLAY", overlay: { ...selectedOverlay, volume: Number(e.target.value) } })}
                    style={sliderTrackStyle(selectedOverlay.volume, 0, 1)}
                  />
                </div>

                {/* Timing Inputs */}
                <div style={{ display: "flex", gap: 8 }}>
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
                    <label style={{ fontSize: 10, color: "var(--ink-2)" }}>Timeline Start (s)</label>
                    <InputControl
                      type="number"
                      step="0.1"
                      min="0"
                      value={selectedOverlay.startTimeSec}
                      onChange={(e) => dispatch({ type: "UPDATE_OVERLAY", overlay: { ...selectedOverlay, startTimeSec: Number(e.target.value) } })}
                      style={{ background: "var(--panel-3)", border: "1px solid var(--line)", borderRadius: 6, color: "var(--ink)", padding: "4px 8px", fontSize: 11 }}
                    />
                  </div>

                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
                    <label style={{ fontSize: 10, color: "var(--ink-2)" }}>Duration (s)</label>
                    <InputControl
                      type="number"
                      step="0.1"
                      min="0.5"
                      value={selectedOverlay.durationSec}
                      onChange={(e) => dispatch({ type: "UPDATE_OVERLAY", overlay: { ...selectedOverlay, durationSec: Number(e.target.value) } })}
                      style={{ background: "var(--panel-3)", border: "1px solid var(--line)", borderRadius: 6, color: "var(--ink)", padding: "4px 8px", fontSize: 11 }}
                    />
                  </div>
                </div>

                {/* Timing Quick Shortcuts */}
                <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                  {cut && (
                    <ControlButton
                      type="button"
                      className="st-btn ghost"
                      style={{ flex: 1, fontSize: 10, padding: "3px 6px" }}
                      onClick={() => {
                        const totalDur = cutDuration(cut);
                        dispatch({ type: "UPDATE_OVERLAY", overlay: { ...selectedOverlay, startTimeSec: 0, durationSec: totalDur } });
                      }}
                      title="Set overlay duration to cover the full assembled video timeline"
                    >
                      ✨ Span Full Cut ({fmtSecs(cutDuration(cut))})
                    </ControlButton>
                  )}
                  {beat && cut && (
                    <ControlButton
                      type="button"
                      className="st-btn ghost"
                      style={{ flex: 1, fontSize: 10, padding: "3px 6px" }}
                      onClick={() => {
                        const beatStart = cut.beats.slice(0, Math.max(0, index)).reduce((sum, b) => sum + b.durationSec, 0);
                        dispatch({ type: "UPDATE_OVERLAY", overlay: { ...selectedOverlay, startTimeSec: beatStart, durationSec: beat.durationSec } });
                      }}
                      title={`Align overlay to match Beat ${index + 1}`}
                    >
                      🎯 Align to Beat {index + 1}
                    </ControlButton>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="st-beat-actions" style={{ marginTop: "auto", display: "flex", gap: 8 }}>
          <ControlButton
            className="st-btn ghost"
            style={{ flex: 1, justifyContent: "center", padding: "9px 14px" }}
            onClick={() => onDuplicateBeat(b.id)}
            title="Duplicate this beat"
          >
            Duplicate beat
          </ControlButton>
          <ControlButton
            className="st-btn danger"
            style={{ flex: 1, justifyContent: "center", padding: "9px 14px" }}
            onClick={() => setConfirmRemoveOpen(true)}
            title="Remove beat from cut"
          >
            Remove beat
          </ControlButton>
        </div>
      </div>

      <Modal
        open={confirmRemoveOpen}
        title={`Remove Beat ${String(index + 1).padStart(2, "0")}?`}
        description="Choose whether to keep or remove its source clip."
        ariaLabel="Confirm beat removal"
        maxWidth={380}
        onClose={() => setConfirmRemoveOpen(false)}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setConfirmRemoveOpen(false)}>Cancel</Button>
            <Button
              variant="secondary"
              onClick={() => {
                setConfirmRemoveOpen(false);
                dispatch({ type: "REMOVE_BEAT", id: b.id });
              }}
            >
              Beat only
            </Button>
            <Button
              variant="danger"
              disabled={clipHasOtherUses}
              title={clipHasOtherUses ? "This clip is still used by another beat, split screen, or overlay." : "Remove the beat and delete its clip from the project."}
              onClick={() => {
                setConfirmRemoveOpen(false);
                dispatch({ type: "REMOVE_BEAT_AND_CLIP", id: b.id });
              }}
            >
              Beat + clip
            </Button>
          </>
        )}
      >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(229, 105, 95, 0.15)", color: "var(--danger)", display: "grid", placeItems: "center", flexShrink: 0 }}>
                <DeleteIcon size={20} />
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-2)", lineHeight: 1.45 }}>
                <strong style={{ color: "var(--ink)" }}>{clip?.name ?? "Referenced clip"}</strong>
                <br />
                “Beat only” keeps it in the Clips panel. “Beat + clip” removes it from the project too.
                {clipHasOtherUses && (
                  <span style={{ display: "block", marginTop: 5, color: "var(--danger)" }}>
                    Clip removal is unavailable because this clip is also used elsewhere in the cut.
                  </span>
                )}
              </div>
            </div>
      </Modal>
      </div>
    </aside>
  );
}
