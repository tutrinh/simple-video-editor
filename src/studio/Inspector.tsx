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
import Switch from "./Switch";
import { beatPosterBg } from "../lib/beatPosterCache";
import ClipTagEditor from "./ClipTagEditor";


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
  onDuplicateBeat: (beatId: string) => void;
  selectedOverlayId?: string | null;
  onSelectOverlay?: (id: string | null) => void;
  selectedVoId?: string | null;
  onSelectVo?: (id: string | null) => void;
  selectedSfxId?: string | null;
  selectedStickerId?: string | null;
  onSelectSticker?: (id: string | null) => void;
  onSelectSfx?: (id: string | null) => void;
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
      <input
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
              <button
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
              </button>
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

export default function Inspector({ beat, clip, clips, logline, index, total, onDuplicateBeat, selectedOverlayId, onSelectOverlay, selectedVoId, onSelectVo, selectedSfxId, onSelectSfx, selectedStickerId, onSelectSticker }: Props) {
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
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [pickerSlotIndex, setPickerSlotIndex] = useState<number | null>(null);
  const [showBeatClipPicker, setShowBeatClipPicker] = useState(false);
  const [sourceCardHovered, setSourceCardHovered] = useState(false);
  const [trimHistory, setTrimHistory] = useState<{ inSec: number; outSec: number; durationSec: number }[]>([]);

  const activeGlobalFilter = getFilterPreset(cut?.globalFilterId);
  const currentGlobalAdj = cut?.globalFilterAdjustments ?? activeGlobalFilter?.colorAdjustments ?? {};

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
  const adjRow = (label: string, value: number, onChange: (v: number) => void) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontSize: 11, width: 70, color: "var(--ink-2)" }}>{label}</span>
      <input
        type="range" min={-100} max={100} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => onChange(0)}
        style={sliderTrackStyle(value)}
      />
      <span style={{ fontSize: 10, width: 32, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
        {value > 0 ? `+${value}` : value}
      </span>
    </div>
  );
  // The tint + split-tone rows for an adjustment group (per-beat or global).
  const splitToneRows = (adj: ColorAdjustments, set: (k: keyof ColorAdjustments, v: number) => void) => (
    <>
      {adjRow("Tint", adj.tint ?? 0, (v) => set("tint", v))}
      {/* Tonal range: brightness of the dark/bright regions. Distinct from the
          split-tone rows below, which colour those same regions. */}
      <div style={{ fontSize: 10, fontWeight: 700, color: "var(--accent)", marginTop: 2 }}>Tone</div>
      {adjRow("Shadows", adj.shadows ?? 0, (v) => set("shadows", v))}
      {adjRow("Black point", adj.blackPoint ?? 0, (v) => set("blackPoint", v))}
      {adjRow("Highlights", adj.highlights ?? 0, (v) => set("highlights", v))}
      <div style={{ fontSize: 10, fontWeight: 700, color: "var(--accent)", marginTop: 2 }}>Split tone</div>
      {adjRow("Skin tone", adj.skinTone ?? 0, (v) => set("skinTone", v))}
      {adjRow("Shadow warm", adj.shadowWarmth ?? 0, (v) => set("shadowWarmth", v))}
      {adjRow("Shadow tint", adj.shadowTint ?? 0, (v) => set("shadowTint", v))}
      {adjRow("Highlt warm", adj.highlightWarmth ?? 0, (v) => set("highlightWarmth", v))}
      {adjRow("Highlt tint", adj.highlightTint ?? 0, (v) => set("highlightTint", v))}
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
    <div className="st-sec" style={{ background: "var(--panel-2)", padding: 12, borderRadius: 8, border: "1px solid var(--accent)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--accent)" }}>🎙️ VO Segment</span>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            className="st-btn ghost"
            style={{ padding: "2px 8px", fontSize: 11 }}
            onClick={() => {
              const gid = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
              const newId = `vo-${gid()}`;
              dispatch({ type: "DUPLICATE_VO", id: selectedVo.id, newVoId: newId });
              onSelectVo?.(newId);
            }}
            title="Duplicate this VO segment"
          >
            📋 Duplicate
          </button>
          <button
            type="button"
            className="st-btn danger"
            style={{ padding: "2px 8px", fontSize: 11 }}
            onClick={() => { dispatch({ type: "REMOVE_VO", id: selectedVo.id }); onSelectVo?.(null); }}
          >
            Remove
          </button>
        </div>
      </div>

      <label style={{ fontSize: 11, color: "var(--ink-2)" }}>Narration text (read by ElevenLabs / Kokoro)</label>
      <textarea
        ref={voTextRef}
        value={selectedVo.text}
        onChange={(e) => dispatch({ type: "UPDATE_VO", segment: { ...selectedVo, text: e.target.value } })}
        placeholder="Type what the voiceover should say…"
        rows={3}
        style={{ width: "100%", marginTop: 4, background: "var(--panel-3)", border: "1px solid var(--line)", borderRadius: 6, color: "var(--ink)", padding: "6px 8px", fontSize: 12, resize: "vertical", outline: "none", boxSizing: "border-box" }}
      />

      {/* Expressive hints — inline audio tags the user can drop into the narration. */}
      <div style={{ marginTop: 8 }}>
        <button
          type="button"
          className="st-color-collapsible-btn"
          onClick={() => setVoHintsOpen((o) => !o)}
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", padding: "6px 10px", background: "var(--panel-3)", border: "1px solid var(--line)", borderRadius: 6, color: "var(--ink)", cursor: "pointer" }}
          title="Reference of expressive audio tags you can type into the narration"
        >
          <span style={{ fontSize: 11, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>✨ Expressive hints</span>
          <span style={{ fontSize: 10, color: "var(--ink-3)", transition: "transform .25s cubic-bezier(.4,0,.2,1)", transform: voHintsOpen ? "rotate(180deg)" : "none" }}>▼</span>
        </button>

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
                      <button
                        key={tag}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => insertHintTag(tag)}
                        title={`Insert ${tag} at the cursor`}
                        style={{ fontFamily: "ui-monospace, monospace", fontSize: 10.5, padding: "2px 6px", background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: 4, color: "var(--ink-2)", cursor: "pointer" }}
                      >
                        {tag}
                      </button>
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

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
        <div style={{ fontSize: 11, color: "var(--ink-2)" }}>Show caption on screen</div>
        <Switch
          checked={selectedVo.captionVisible}
          onChange={(next) => dispatch({ type: "UPDATE_VO", segment: { ...selectedVo, captionVisible: next } })}
          label="Show caption on screen"
        />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }} title="Playback volume for this voiceover segment.">
        <span style={{ fontSize: 11, width: 60, color: "var(--ink-2)" }}>Volume</span>
        <input
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

      <button
        type="button"
        className="st-btn ghost"
        style={{ marginTop: 8, fontSize: 11, padding: "5px 10px", width: "100%", justifyContent: "center" }}
        onClick={fitVoLength}
        disabled={fitting || !selectedVo.text.trim()}
        title="Synthesize this narration and snap the segment length to its exact spoken duration"
      >
        {fitting ? "Fitting…" : "⤢ Fit length to voice"}
      </button>
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
          <button
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
          </button>
          <button
            type="button"
            className="st-btn danger"
            style={{ padding: "2px 8px", fontSize: 11 }}
            onClick={() => { dispatch({ type: "REMOVE_SFX", id: selectedSfx.id }); onSelectSfx?.(null); }}
          >
            Remove
          </button>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          type="button"
          className="st-btn ghost"
          style={{ padding: "4px 9px", fontSize: 12, flexShrink: 0 }}
          onClick={toggleSfxPreview}
          title="Preview this sound at its trimmed length and volume"
        >
          {sfxPreviewing ? "⏸" : "▶"}
        </button>
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
        <input
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
        <input
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
          <input
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
      <input
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
          <button
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
          </button>
          <button
            type="button"
            className="st-btn ghost"
            style={{ padding: "2px 8px", fontSize: 11, color: "var(--danger)" }}
            onClick={() => { dispatch({ type: "REMOVE_STICKER", id: selectedSticker.id }); onSelectSticker?.(null); }}
            title="Remove this sticker"
          >
            Remove
          </button>
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
                <button
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
                </button>
              </div>

              {activeGlobalFilter && (
                <div style={{ marginTop: 8, padding: 10, background: "var(--panel-2)", borderRadius: 6, border: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 11, color: "var(--ink-2)" }}>Filter Intensity: {Math.round((cut?.globalFilterIntensity ?? 1) * 100)}%</span>
                    <button
                      type="button"
                      style={{ background: "none", border: "none", color: "var(--danger)", fontSize: 11, cursor: "pointer", padding: 0 }}
                      onClick={() => dispatch({ type: "SET_GLOBAL_FILTER", filterId: null })}
                    >
                      Remove Filter
                    </button>
                  </div>
                  <input
                    type="range"
                    min="0.1"
                    max="1"
                    step="0.05"
                    value={cut?.globalFilterIntensity ?? 1}
                    onChange={(e) => dispatch({ type: "SET_GLOBAL_FILTER", filterId: cut?.globalFilterId ?? null, intensity: Number(e.target.value) })}
                    style={sliderTrackStyle(cut?.globalFilterIntensity ?? 1, 0.1, 1)}
                  />

                  <div className="st-color-adjustments" style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--accent)" }}>🎛️ Fine-Tune Filter</div>

                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 11, width: 70, color: "var(--ink-2)" }}>Exposure</span>
                      <input
                        type="range"
                        min="-100"
                        max="100"
                        value={currentGlobalAdj.exposure ?? 0}
                        onChange={(e) => updateGlobalAdj("exposure", Number(e.target.value))}
                        style={sliderTrackStyle(currentGlobalAdj.exposure ?? 0, -100, 100)}
                      />
                      <span style={{ fontSize: 10, width: 32, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
                        {(currentGlobalAdj.exposure ?? 0) > 0 ? `+${currentGlobalAdj.exposure}` : (currentGlobalAdj.exposure ?? 0)}
                      </span>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 11, width: 70, color: "var(--ink-2)" }}>Contrast</span>
                      <input
                        type="range"
                        min="-100"
                        max="100"
                        value={currentGlobalAdj.contrast ?? 0}
                        onChange={(e) => updateGlobalAdj("contrast", Number(e.target.value))}
                        style={sliderTrackStyle(currentGlobalAdj.contrast ?? 0, -100, 100)}
                      />
                      <span style={{ fontSize: 10, width: 32, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
                        {(currentGlobalAdj.contrast ?? 0) > 0 ? `+${currentGlobalAdj.contrast}` : (currentGlobalAdj.contrast ?? 0)}
                      </span>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 11, width: 70, color: "var(--ink-2)" }}>Hue</span>
                      <input
                        type="range"
                        min="-100"
                        max="100"
                        value={currentGlobalAdj.colorTone ?? 0}
                        onChange={(e) => updateGlobalAdj("colorTone", Number(e.target.value))}
                        style={sliderTrackStyle(currentGlobalAdj.colorTone ?? 0, -100, 100)}
                      />
                      <span style={{ fontSize: 10, width: 32, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
                        {(currentGlobalAdj.colorTone ?? 0) > 0 ? `+${currentGlobalAdj.colorTone}` : (currentGlobalAdj.colorTone ?? 0)}
                      </span>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 11, width: 70, color: "var(--ink-2)" }}>Warmth</span>
                      <input
                        type="range"
                        min="-100"
                        max="100"
                        value={currentGlobalAdj.warmth ?? 0}
                        onChange={(e) => updateGlobalAdj("warmth", Number(e.target.value))}
                        style={sliderTrackStyle(currentGlobalAdj.warmth ?? 0, -100, 100)}
                      />
                      <span style={{ fontSize: 10, width: 32, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
                        {(currentGlobalAdj.warmth ?? 0) > 0 ? `+${currentGlobalAdj.warmth}` : (currentGlobalAdj.warmth ?? 0)}
                      </span>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 11, width: 70, color: "var(--ink-2)" }}>Saturation</span>
                      <input
                        type="range"
                        min="-100"
                        max="100"
                        value={currentGlobalAdj.saturation ?? 0}
                        onChange={(e) => updateGlobalAdj("saturation", Number(e.target.value))}
                        style={sliderTrackStyle(currentGlobalAdj.saturation ?? 0, -100, 100)}
                      />
                      <span style={{ fontSize: 10, width: 32, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
                        {(currentGlobalAdj.saturation ?? 0) > 0 ? `+${currentGlobalAdj.saturation}` : (currentGlobalAdj.saturation ?? 0)}
                      </span>
                    </div>
                    {splitToneRows(currentGlobalAdj, updateGlobalAdj)}
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
    });
  }

  function setTrim(inSec: number, outSec: number) {
    if (!b) return;
    const maxOut = clip?.durationSec ?? Math.max(outSec, 10);
    const targetDur = b.lockDuration ? b.durationSec : undefined;

    if (Math.abs(inSec - b.inSec) > 0.01 || Math.abs(outSec - b.outSec) > 0.01) {
      setTrimHistory((prev) => [
        ...prev.slice(-20),
        { inSec: b.inSec, outSec: b.outSec, durationSec: b.durationSec },
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
      update({ ...b, inSec: nextIn, outSec: nextOut, durationSec: fixedDur });
      return;
    }

    const nextIn = Math.max(0, Math.min(inSec, maxOut - 0.1));
    const nextOut = Math.max(nextIn + 0.1, Math.min(outSec, maxOut));
    const durationSec = durationFor(nextIn, nextOut, b.captionText, b.captionDurations);
    update({ ...b, inSec: nextIn, outSec: nextOut, durationSec });
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
      <div className="st-colhead">Beat {String(index + 1).padStart(2, "0")} <span className="cnt">of {total}</span></div>
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

        {/* Source Clip Switcher */}
        <div className="st-field" style={{ background: "var(--panel-2)", padding: 12, borderRadius: 8, border: "1px solid var(--line)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
            <label style={{ margin: 0, fontWeight: 700, fontSize: 12, color: "var(--ink)", display: "flex", alignItems: "center", gap: 6 }}>
              <span>🎬 Source Clip</span>
            </label>
            <span style={{ fontSize: 11, color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
              {clip ? fmtSecs(clip.durationSec) : ""}
            </span>
          </div>

          <div
            onMouseEnter={() => setSourceCardHovered(true)}
            onMouseLeave={() => setSourceCardHovered(false)}
            style={{ display: "flex", alignItems: "center", gap: 10 }}
          >
            {clip && sourceCardHovered && clip.kind !== "still" ? (
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

            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
              {clip ? (
                <input
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
              <div style={{ fontSize: 10.5, color: "var(--ink-3)", fontVariantNumeric: "tabular-nums", marginTop: 2 }}>
                ⏱ Duration: {clip ? fmtSecs(clip.durationSec) : "0s"}
              </div>
            </div>

            <button
              type="button"
              className="st-btn primary"
              onClick={() => setShowBeatClipPicker(true)}
              title="Open visual clip picker to swap source clip for this beat"
              style={{ fontSize: 11, padding: "5px 10px", whiteSpace: "nowrap", flexShrink: 0 }}
            >
              ⇄ Swap Clip
            </button>
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
            clips={clips}
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
              <input type="checkbox" checked={timed} onChange={(e) => toggleTimed(e.target.checked)} />
              <span>Timed lines</span>
            </label>
          </div>
          <div className="st-caplines">
            {captionLines.map((line, i) => (
              <div className="st-caprow" key={i}>
                <div className={timed ? "st-capline timed" : "st-capline"}>
                  <div className="st-capclear-wrap">
                    <input
                      className="st-caption-line"
                      value={line}
                      placeholder="Caption line…"
                      onChange={(e) => editText(i, e.target.value)}
                    />
                    {line.length > 0 && (
                      <button
                        className="st-capclear"
                        title="Clear"
                        tabIndex={-1}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => editText(i, "")}
                      >×</button>
                    )}
                  </div>
                  {timed && (
                    <div className="st-capsec" title="Seconds this line stays on screen">
                      <input type="number" min="0.1" step="0.1" value={durations[i] ?? ""} onChange={(e) => editDuration(i, e.target.value)} />
                      <span>s</span>
                    </div>
                  )}
                  {captionLines.length > 1 && (
                    <button className="st-capdel" title="Remove line" onClick={() => removeLine(i)}>×</button>
                  )}
                </div>
                {alts[i]?.length > 0 && (
                  <div className="st-capalts">
                    {alts[i].map((alt, j) => (
                      <button key={j} className="st-capalt" title="Use this line" onClick={() => useAlt(i, alt)}>{alt}</button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <button className="st-capadd" onClick={addLine}>+ Add line</button>
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
            <button className="st-btn ghost" onClick={genAlts} disabled={altBusy || !clip}>
              {altBusy ? (
                <>
                  <span className="st-spinner-sm" />
                  Generating…
                </>
              ) : (
                "Generate alternatives"
              )}
            </button>
            <select value={altModel} onChange={(e) => setAltModel(e.target.value)} title="AI model">
              {MODEL_OPTIONS.map((m) => <option key={m} value={m}>{modelLabel(m)}</option>)}
            </select>
            <select value={altMood} onChange={(e) => setAltMood(e.target.value)} title="Mood / voice">
              {TONE_OPTIONS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
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
            <label style={{ margin: 0 }}>
              Trim · in / out of source · {fmtSecs(b.durationSec)} {b.lockDuration ? "🔒" : ""}
            </label>
            <label
              className="st-captoggle"
              title={b.lockDuration
                ? "Timeline duration is locked. Changing in or out slips the clip window while preserving exact timeline length."
                : "Lock timeline duration (slip edit). Changing in or out recalculates the other bound to preserve timeline length."}
              style={{ display: "inline-flex", alignItems: "center", gap: 5, cursor: "pointer", fontSize: 11, color: "var(--ink-2)" }}
            >
              <input
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
              <span>
                🔒 <strong>Duration locked ({fmtSecs(b.durationSec)})</strong>: Changing IN or OUT performs a slip edit—shifting the footage window while the timeline duration will be unchanged.
              </span>
            ) : (
              <span>
                🔓 <strong>Unlocked duration</strong>: Changing IN or OUT trims footage and expands/shrinks beat length on the timeline. Check <strong>Lock duration</strong> for slip editing.
              </span>
            )}
          </div>
          {clip
            ? <BeatTrimmer beat={b} clip={clip} compact={!trimOpen} onChange={setTrim} lockDuration={b.lockDuration} />
            : <div style={{ color: "var(--ink-3)", fontSize: 12 }}>Clip missing.</div>}
          {clip && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              <button className="st-btn ghost" style={{ fontSize: 12, padding: "5px 10px" }} onClick={() => setTrimOpen((v) => !v)}>
                {trimOpen ? "Hide video scrubber" : "Open video scrubber"}
              </button>

              {trimHistory.length > 0 && (
                <button
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
                </button>
              )}
            </div>
          )}
        </div>

        {/* Split Screen Treatment Card */}
        <div className="st-field" style={{ background: "var(--panel-2)", padding: 12, borderRadius: 8, border: "1px solid var(--line)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <label style={{ margin: 0, fontWeight: 700, color: "var(--purple)", fontSize: 12 }}>
              🥞 Split Screen Layout
            </label>
            <select
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
              <option value="none">Single Clip (None)</option>
              <option value="v2-stacked">🥞 Top / Bottom Stack (2)</option>
              <option value="v2-side">📂 Left / Right Side (2)</option>
              <option value="3-col">📊 3-Column Split (3)</option>
              <option value="4-grid">🏁 2x2 Quad Grid (4)</option>
            </select>
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
                          <input
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
                        <button
                          type="button"
                          className="st-btn ghost"
                          style={{ fontSize: 10, padding: "2px 6px" }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setPickerSlotIndex(idx);
                          }}
                        >
                          Change ▾
                        </button>
                      </div>

                      {/* Per-Slot Reframing & Transform Sliders */}
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 2, background: "var(--panel-2)", padding: 8, borderRadius: 6, border: "1px solid var(--line)" }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "var(--ink-2)", textTransform: "uppercase", letterSpacing: "0.4px" }}>Slot Reframing & Transform</div>

                        {/* Scale / Zoom */}
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 10, width: 44, color: "var(--ink-2)" }}>Scale</span>
                          <input
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
                          <input
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
                          <input
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
                          <input
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
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{
                  transform: colorOpen ? "rotate(180deg)" : "rotate(0deg)",
                  transition: "transform 0.2s ease",
                  color: "var(--ink-2)",
                }}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
              <label style={{ margin: 0, cursor: "pointer" }}>Color Adjustments</label>
              {hasColorAdjustments(b.colorAdjustments) && (
                <span style={{ fontSize: 10, color: "var(--accent)", fontWeight: 600 }}>• Adjusted</span>
              )}
            </div>

            {hasColorAdjustments(b.colorAdjustments) && (
              <button
                style={{ fontSize: 10, fontWeight: 600, background: "none", border: "none", color: "var(--accent)", cursor: "pointer", padding: 0 }}
                onClick={(e) => {
                  e.stopPropagation();
                  resetColorAdjustments();
                }}
                title="Reset all color adjustments to default"
              >
                Reset color
              </button>
            )}
          </div>

          <div className={"st-color-collapsible" + (colorOpen ? " open" : "")}>
            <div className="st-color-collapsible-inner">
              <div className="st-color-adjustments" style={{ display: "flex", flexDirection: "column", gap: 8, background: "var(--panel-2)", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11, width: 70, color: "var(--ink-2)" }}>Exposure</span>
                  <input
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
                  <input
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
                  <input
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
                  <input
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
                  <span style={{ fontSize: 11, width: 70, color: "var(--ink-2)" }}>Skin tone</span>
                  <input
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
                  <input
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
                  <button
                    type="button"
                    className="st-btn ghost"
                    style={{ flex: 1, fontSize: 10, padding: "4px 6px", justifyContent: "center" }}
                    onClick={copyBeatColor}
                    disabled={!hasColorAdjustments(b.colorAdjustments)}
                    title="Copy these color adjustments to clipboard"
                  >
                    {colorCopiedToast ? "✓ Copied!" : "📋 Copy Color"}
                  </button>

                  <button
                    type="button"
                    className="st-btn ghost"
                    style={{ flex: 1, fontSize: 10, padding: "4px 6px", justifyContent: "center" }}
                    onClick={pasteBeatColor}
                    disabled={!copiedColor}
                    title={copiedColor ? "Paste copied color adjustments to this beat" : "Copy a color adjustment first to paste"}
                  >
                    📥 Paste Color
                  </button>
                </div>

                <button
                  type="button"
                  className="st-btn ghost"
                  style={{ fontSize: 10, padding: "4px 8px", marginTop: 2, alignSelf: "flex-end" }}
                  onClick={applyColorToAllBeats}
                  disabled={!hasColorAdjustments(b.colorAdjustments)}
                  title="Apply these color adjustments to all beats in the cut"
                >
                  Apply color to all beats
                </button>
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
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ transform: titleOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s ease", color: "var(--ink-2)" }}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
              <label style={{ margin: 0, cursor: "pointer" }}>Title Treatment</label>
              {beatTitleCount > 0 && (
                <span style={{ fontSize: 10, color: "var(--accent)", fontWeight: 600 }}>• {beatTitleCount} layer{beatTitleCount === 1 ? "" : "s"}</span>
              )}
            </div>
          </div>

          <div className={"st-color-collapsible" + (titleOpen ? " open" : "")}>
            <div className="st-color-collapsible-inner">
              <div style={{ display: "flex", flexDirection: "column", gap: 12, background: "var(--panel-2)", padding: 12, borderRadius: 8, border: "1px solid var(--line)", marginTop: 6 }}>
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
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ transform: zoomOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s ease", color: "var(--ink-2)" }}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
              <label style={{ margin: 0, cursor: "pointer" }}>Zoom / Punch-In</label>
              {(b.zoom ?? 1) > 1.001 && (
                <span style={{ fontSize: 10, color: "var(--accent)", fontWeight: 600 }}>• {(b.zoom ?? 1).toFixed(2)}×</span>
              )}
            </div>

            {(b.zoom ?? 1) > 1.001 && (
              <button
                style={{ fontSize: 10, fontWeight: 600, background: "none", border: "none", color: "var(--accent)", cursor: "pointer", padding: 0 }}
                onClick={(e) => { e.stopPropagation(); update({ ...b, zoom: 1, zoomX: 0, zoomY: 0, zoomScope: "entire", zoomSec: 3 }); }}
                title="Reset zoom to 1× (no punch-in)"
              >
                Reset zoom
              </button>
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
                          <button
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
                          </button>
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
                  <input
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
                  <input
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
                  <input
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
                    <select
                      value={b.zoomScope ?? "entire"}
                      disabled={(b.zoom ?? 1) <= 1.001}
                      onChange={(e) => update({ ...b, zoomScope: e.target.value as "entire" | "intro" })}
                      title="Zoom the whole beat, or only punch in for the first few seconds"
                      style={{ background: "var(--panel-3)", border: "1px solid var(--line)", borderRadius: 6, color: "var(--ink)", fontSize: 12, padding: "4px 8px", outline: "none" }}
                    >
                      <option value="entire">Entire beat</option>
                      <option value="intro">First seconds</option>
                    </select>
                  </label>
                  {(b.zoomScope ?? "entire") === "intro" && (
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      Duration
                      <select
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
                      </select>
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
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <label style={{ margin: 0, fontWeight: 600 }}>Rotation</label>
            {Math.abs(b.rotation ?? 0) >= 0.05 && (
              <button
                style={{ fontSize: 10, fontWeight: 600, background: "none", border: "none", color: "var(--accent)", cursor: "pointer", padding: 0 }}
                onClick={() => update({ ...b, rotation: 0 })}
                title="Reset rotation to 0°"
              >
                Reset rotation
              </button>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11, width: 70, color: "var(--ink-2)" }}>Angle</span>
            <input
              type="range" min={-15} max={15} step={0.1}
              value={b.rotation ?? 0}
              onChange={(e) => update({ ...b, rotation: Number(e.target.value) })}
              onDoubleClick={() => update({ ...b, rotation: 0 })}
              title="Fine rotation — straighten a horizon or add a subtle tilt. Double-click to reset."
              style={sliderTrackStyle(b.rotation ?? 0, -15, 15)}
            />
            <span style={{ fontSize: 10, width: 40, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
              {(b.rotation ?? 0) > 0 ? `+${(b.rotation ?? 0).toFixed(1)}` : (b.rotation ?? 0).toFixed(1)}°
            </span>
          </div>
          {Math.abs(b.rotation ?? 0) >= 0.05 && (
            <div style={{ fontSize: 10, color: "var(--ink-3)", marginLeft: 78, marginTop: 2 }}>
              corners show — zoom to {rotationCoverScale(...canvasDims(cut?.aspect ?? "16:9"), b.rotation).toFixed(2)}× to hide them
            </div>
          )}
        </div>

        {/* Video Transition Collapsible Section */}
        <div className="st-field" style={{ marginTop: 8 }}>
          <div className="st-color-collapsible">
            <button
              type="button"
              className="st-color-collapsible-btn"
              onClick={() => setTransitionOpen(!transitionOpen)}
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", padding: "8px 10px", background: "var(--panel-3)", border: "1px solid var(--line)", borderRadius: 6, color: "var(--ink)", cursor: "pointer" }}
            >
              <span style={{ fontSize: 11, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                🎬 Video Transition
                {b.transition && b.transition !== "none" && (
                  <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: "var(--accent-glow)", color: "var(--accent)", fontWeight: 700 }}>
                    {b.transition} ({b.transitionSec ?? 0.5}s)
                  </span>
                )}
              </span>
              <span style={{ fontSize: 10, color: "var(--ink-3)" }}>{transitionOpen ? "▲" : "▼"}</span>
            </button>

            {transitionOpen && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6, padding: "8px 10px", background: "var(--panel-3)", borderRadius: 6, border: "1px solid var(--line)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11, width: 80, color: "var(--ink-2)" }}>Effect</span>
                  <select
                    value={b.transition ?? "none"}
                    onChange={(e) => update({ ...b, transition: e.target.value as VideoTransitionType })}
                    style={{ flex: 1, background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: 5, color: "var(--ink)", fontSize: 11, padding: "4px 6px", outline: "none", cursor: "pointer" }}
                  >
                    <option value="none">🚫 Cut (None)</option>
                    <option value="fade">✨ Crossfade</option>
                    <option value="fadeblack">🌑 Fade to Black</option>
                    <option value="fadewhite">☀️ Fade to White</option>
                    <option value="wipeleft">👈 Wipe Left</option>
                    <option value="wiperight">👉 Wipe Right</option>
                    <option value="slideleft">◀ Slide Left</option>
                    <option value="slideright">▶ Slide Right</option>
                  </select>
                </div>

                {b.transition && b.transition !== "none" && (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 11, width: 80, color: "var(--ink-2)" }}>Position</span>
                      <select
                        value={b.transitionPosition ?? "start"}
                        onChange={(e) => update({ ...b, transitionPosition: e.target.value as "start" | "end" })}
                        style={{ flex: 1, background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: 5, color: "var(--ink)", fontSize: 11, padding: "4px 6px", outline: "none", cursor: "pointer" }}
                      >
                        <option value="start">🚀 Beginning of Beat (In)</option>
                        <option value="end">🏁 End of Beat (Out)</option>
                      </select>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 11, width: 80, color: "var(--ink-2)" }}>Duration</span>
                      <select
                        value={b.transitionSec ?? 0.5}
                        onChange={(e) => update({ ...b, transitionSec: Number(e.target.value) })}
                        style={{ flex: 1, background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: 5, color: "var(--ink)", fontSize: 11, padding: "4px 6px", outline: "none", cursor: "pointer" }}
                      >
                        <option value={0.3}>0.3s (Fast)</option>
                        <option value={0.5}>0.5s (Standard)</option>
                        <option value={0.8}>0.8s (Smooth)</option>
                        <option value={1.0}>1.0s (Slow)</option>
                      </select>
                    </div>

                    <button
                      type="button"
                      className="st-btn ghost"
                      style={{ fontSize: 10, padding: "4px 8px", marginTop: 2, alignSelf: "flex-end" }}
                      onClick={applyTransitionToAllBeats}
                      title="Apply this transition effect to all beats in the cut"
                    >
                      Apply to all beats
                    </button>
                  </>
                )}
              </div>
            )}

            {/* Beat Audio Volume Settings */}
            <div className="st-sec" style={{ marginTop: 10 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 12, fontWeight: 600 }}>🔊 Beat Audio Volume</span>
                <span style={{ fontSize: 11, color: "var(--ink-2)" }}>{Math.round((b.volume ?? 1) * 100)}%</span>
              </div>
              <div style={{ marginTop: 6 }}>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={b.volume ?? 1}
                  onChange={(e) => update({ ...b, volume: Number(e.target.value) })}
                  style={sliderTrackStyle(b.volume ?? 1, 0, 1)}
                  title="Adjust the original audio volume of this beat's video clip"
                />
              </div>
            </div>

            {/* Global Cut Color Filter Card */}
            <div className="st-sec" style={{ marginTop: 10 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 12, fontWeight: 600 }}>🎨 Global Look & Feel Filter</span>
                <button
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
                </button>
              </div>

              {activeGlobalFilter && (
                <div style={{ marginTop: 8, padding: 10, background: "var(--panel-2)", borderRadius: 6, border: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 11, color: "var(--ink-2)" }}>Filter Intensity: {Math.round((cut?.globalFilterIntensity ?? 1) * 100)}%</span>
                    <button
                      type="button"
                      style={{ background: "none", border: "none", color: "var(--danger)", fontSize: 11, cursor: "pointer", padding: 0 }}
                      onClick={() => dispatch({ type: "SET_GLOBAL_FILTER", filterId: null })}
                    >
                      Remove Filter
                    </button>
                  </div>
                  <input
                    type="range"
                    min="0.1"
                    max="1"
                    step="0.05"
                    value={cut?.globalFilterIntensity ?? 1}
                    onChange={(e) => dispatch({ type: "SET_GLOBAL_FILTER", filterId: cut?.globalFilterId ?? null, intensity: Number(e.target.value) })}
                    style={sliderTrackStyle(cut?.globalFilterIntensity ?? 1, 0.1, 1)}
                  />

                  <div className="st-color-adjustments" style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--accent)" }}>🎛️ Fine-Tune Filter</div>

                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 11, width: 70, color: "var(--ink-2)" }}>Exposure</span>
                      <input
                        type="range"
                        min="-100"
                        max="100"
                        value={currentGlobalAdj.exposure ?? 0}
                        onChange={(e) => updateGlobalAdj("exposure", Number(e.target.value))}
                        style={sliderTrackStyle(currentGlobalAdj.exposure ?? 0, -100, 100)}
                      />
                      <span style={{ fontSize: 10, width: 32, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
                        {(currentGlobalAdj.exposure ?? 0) > 0 ? `+${currentGlobalAdj.exposure}` : (currentGlobalAdj.exposure ?? 0)}
                      </span>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 11, width: 70, color: "var(--ink-2)" }}>Contrast</span>
                      <input
                        type="range"
                        min="-100"
                        max="100"
                        value={currentGlobalAdj.contrast ?? 0}
                        onChange={(e) => updateGlobalAdj("contrast", Number(e.target.value))}
                        style={sliderTrackStyle(currentGlobalAdj.contrast ?? 0, -100, 100)}
                      />
                      <span style={{ fontSize: 10, width: 32, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
                        {(currentGlobalAdj.contrast ?? 0) > 0 ? `+${currentGlobalAdj.contrast}` : (currentGlobalAdj.contrast ?? 0)}
                      </span>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 11, width: 70, color: "var(--ink-2)" }}>Hue</span>
                      <input
                        type="range"
                        min="-100"
                        max="100"
                        value={currentGlobalAdj.colorTone ?? 0}
                        onChange={(e) => updateGlobalAdj("colorTone", Number(e.target.value))}
                        style={sliderTrackStyle(currentGlobalAdj.colorTone ?? 0, -100, 100)}
                      />
                      <span style={{ fontSize: 10, width: 32, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
                        {(currentGlobalAdj.colorTone ?? 0) > 0 ? `+${currentGlobalAdj.colorTone}` : (currentGlobalAdj.colorTone ?? 0)}
                      </span>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 11, width: 70, color: "var(--ink-2)" }}>Warmth</span>
                      <input
                        type="range"
                        min="-100"
                        max="100"
                        value={currentGlobalAdj.warmth ?? 0}
                        onChange={(e) => updateGlobalAdj("warmth", Number(e.target.value))}
                        style={sliderTrackStyle(currentGlobalAdj.warmth ?? 0, -100, 100)}
                      />
                      <span style={{ fontSize: 10, width: 32, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
                        {(currentGlobalAdj.warmth ?? 0) > 0 ? `+${currentGlobalAdj.warmth}` : (currentGlobalAdj.warmth ?? 0)}
                      </span>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 11, width: 70, color: "var(--ink-2)" }}>Saturation</span>
                      <input
                        type="range"
                        min="-100"
                        max="100"
                        value={currentGlobalAdj.saturation ?? 0}
                        onChange={(e) => updateGlobalAdj("saturation", Number(e.target.value))}
                        style={sliderTrackStyle(currentGlobalAdj.saturation ?? 0, -100, 100)}
                      />
                      <span style={{ fontSize: 10, width: 32, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
                        {(currentGlobalAdj.saturation ?? 0) > 0 ? `+${currentGlobalAdj.saturation}` : (currentGlobalAdj.saturation ?? 0)}
                      </span>
                    </div>
                    {splitToneRows(currentGlobalAdj, updateGlobalAdj)}
                  </div>
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

            {/* Overlay Clip Inspector Card */}
            {selectedOverlay && (
              <div className="st-sec" style={{ marginTop: 10, background: "var(--panel-2)", padding: 12, borderRadius: 8, border: "1px solid var(--accent)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--accent)" }}>🎞️ Overlay Clip Settings</span>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
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
                    </button>
                    <button
                      type="button"
                      className="st-btn danger"
                      style={{ padding: "2px 8px", fontSize: 11 }}
                      onClick={() => { dispatch({ type: "REMOVE_OVERLAY", id: selectedOverlay.id }); onSelectOverlay?.(null); }}
                    >
                      Remove
                    </button>
                  </div>
                </div>

                {/* Clip Selector */}
                <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
                  <label style={{ fontSize: 11, color: "var(--ink-2)" }}>Overlay Footage Clip</label>
                  <select
                    value={selectedOverlay.clipId}
                    onChange={(e) => dispatch({ type: "UPDATE_OVERLAY", overlay: { ...selectedOverlay, clipId: e.target.value } })}
                    style={{ background: "var(--panel-3)", border: "1px solid var(--line)", borderRadius: 6, color: "var(--ink)", padding: "4px 8px", fontSize: 12 }}
                  >
                    {clips.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>

                {/* Blend Mode Selector */}
                <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
                  <label style={{ fontSize: 11, color: "var(--ink-2)" }}>Visual Blend Mode</label>
                  <select
                    value={selectedOverlay.blendMode}
                    onChange={(e) => dispatch({ type: "UPDATE_OVERLAY", overlay: { ...selectedOverlay, blendMode: e.target.value as any } })}
                    style={{ background: "var(--panel-3)", border: "1px solid var(--line)", borderRadius: 6, color: "var(--accent)", fontWeight: 600, padding: "4px 8px", fontSize: 12 }}
                  >
                    <option value="normal">Normal / Overwrite Opacity</option>
                    <option value="screen">Screen (Lighten Blend)</option>
                    <option value="multiply">Multiply (Darken Blend)</option>
                    <option value="overlay">Overlay (Contrast Blend)</option>
                  </select>
                </div>

                {/* Opacity Slider */}
                <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                    <span>Opacity</span>
                    <span>{Math.round(selectedOverlay.opacity * 100)}%</span>
                  </div>
                  <input
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
                  <input
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
                    <input
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
                    <input
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
                    <button
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
                    </button>
                  )}
                  {beat && cut && (
                    <button
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
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="st-beat-actions" style={{ marginTop: "auto", display: "flex", gap: 8 }}>
          <button
            className="st-btn ghost"
            style={{ flex: 1, justifyContent: "center", padding: "9px 14px" }}
            onClick={() => onDuplicateBeat(b.id)}
            title="Duplicate this beat"
          >
            Duplicate beat
          </button>
          <button
            className="st-btn danger"
            style={{ flex: 1, justifyContent: "center", padding: "9px 14px" }}
            onClick={() => setConfirmRemoveOpen(true)}
            title="Remove beat from cut"
          >
            Remove beat
          </button>
        </div>
      </div>

      {confirmRemoveOpen && (
        <div className="st-modal-scrim" onClick={() => setConfirmRemoveOpen(false)}>
          <div className="st-modal-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Confirm beat removal">
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(229, 105, 95, 0.15)", color: "var(--danger)", display: "grid", placeItems: "center", flexShrink: 0 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>Remove Beat {String(index + 1).padStart(2, "0")}?</h3>
                <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>This beat will be removed from your cut.</div>
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
              <button
                className="st-btn ghost"
                style={{ flex: 1, justifyContent: "center", padding: "8px 12px" }}
                onClick={() => setConfirmRemoveOpen(false)}
              >
                Cancel
              </button>
              <button
                className="st-btn danger"
                style={{ flex: 1, justifyContent: "center", padding: "8px 12px" }}
                onClick={() => {
                  setConfirmRemoveOpen(false);
                  dispatch({ type: "REMOVE_BEAT", id: b.id });
                }}
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </aside>
  );
}
