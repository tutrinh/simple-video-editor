import { useEffect, useState } from "react";
import { useProject } from "../state/ProjectContext";
import { useSettings, toneHint, MODEL_OPTIONS, TONE_OPTIONS } from "../state/SettingsContext";
import type { Beat, Clip, ColorAdjustments, VideoTransitionType } from "../domain/types";
import { suggestCaptionAlternatives } from "../features/refine/refine";
import BeatTrimmer from "../features/refine/BeatTrimmer";
import { estimateSpokenSeconds, captionSchedule, scheduleDuration } from "../lib/pacing";
import { fmtSecs, cssFilterFor } from "./util";

/** Short label for a model id, e.g. "claude-opus-4-8" → "opus-4-8". */
const modelLabel = (m: string) => m.replace(/^claude-/, "");

interface Props {
  beat: Beat | null;
  clip: Clip | undefined;
  clips: Clip[];
  logline: string;
  index: number;
  total: number;
  onDuplicateBeat: (beatId: string) => void;
}

function sliderTrackStyle(val: number, min = -100, max = 100): React.CSSProperties {
  const pct = ((val - min) / (max - min)) * 100;
  return {
    flex: 1,
    width: "100%",
    background: `linear-gradient(to right, rgba(255, 179, 57, 0.35) 0%, rgba(255, 179, 57, 0.35) ${pct}%, var(--panel-3, #22262e) ${pct}%, var(--panel-3, #22262e) 100%)`,
  };
}

export default function Inspector({ beat, clip, clips: _clips, logline, index, total, onDuplicateBeat }: Props) {
  const { state, dispatch } = useProject();
  const { settings } = useSettings();
  const cut = state.cut;
  const [trimOpen, setTrimOpen] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  // Per-line caption alternatives: model + mood chosen here (seeded from settings),
  // results aligned to caption rows (row i → its suggestions).
  const [altModel, setAltModel] = useState<string>(settings.authorModel);
  const [altMood, setAltMood] = useState<string>(settings.tone);
  const [altBusy, setAltBusy] = useState(false);
  const [altErr, setAltErr] = useState<string | null>(null);
  const [alts, setAlts] = useState<string[][]>([]);
  const [transitionOpen, setTransitionOpen] = useState(false);

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

  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);

  // Suggestions & modals belong to one beat — clear them when a different beat is selected.
  useEffect(() => { setAlts([]); setAltErr(null); setConfirmRemoveOpen(false); }, [beat?.id]);

  if (!beat) {
    return (
      <aside className="st-col insp">
        <div className="st-colhead">Inspector</div>
        <div className="st-insp-empty">Select a beat in the timeline to edit its caption, trim, and clip.</div>
      </aside>
    );
  }
  const b = beat;
  const update = (next: Beat) => dispatch({ type: "UPDATE_BEAT", beat: next });

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
  // The beat's on-screen duration: the trim window, extended only if a timed
  // caption sequence runs longer than it. Never shrinks below the manual trim.
  function durationFor(inSec: number, outSec: number, captionText: string, durs?: number[]): number {
    const footageLen = footageLenOf(inSec, outSec);
    const total = scheduleDuration(captionSchedule(captionText, durs));
    return Math.max(footageLen, total);
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
  function setTrim(inSec: number, outSec: number) {
    const maxOut = clip?.durationSec ?? outSec;
    const nextIn = Math.max(0, Math.min(inSec, maxOut - 0.1));
    const nextOut = Math.max(nextIn + 0.1, Math.min(outSec, maxOut));
    // Duration follows the new trim, still honoring any timed caption sequence.
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
    if (!adj) return false;
    return !!(adj.exposure || adj.contrast || adj.colorTone || adj.warmth || adj.saturation);
  }

  const posterAspect = clip?.width && clip?.height ? `${clip.width} / ${clip.height}` : "16 / 9";

  return (
    <aside className="st-col insp">
      <div className="st-colhead">Beat {String(index + 1).padStart(2, "0")} <span className="cnt">of {total}</span></div>
      <div className="st-insp-body">
        <div
          className="st-ip-poster"
          style={{
            aspectRatio: posterAspect,
            background: clip?.poster ? `#0a0b0d url(${JSON.stringify(clip.poster)}) center/cover no-repeat` : undefined,
            filter: cssFilterFor(b.colorAdjustments),
          }}
        >
          <div className="cap">{b.captionText}</div>
        </div>

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
                  <input
                    className="st-caption-line"
                    value={line}
                    placeholder="Caption line…"
                    onChange={(e) => editText(i, e.target.value)}
                  />
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

        <div className="st-field">
          <label>Trim · in / out of source · {fmtSecs(b.durationSec)}</label>
          {clip
            ? <BeatTrimmer beat={b} clip={clip} compact={!trimOpen} onChange={setTrim} />
            : <div style={{ color: "var(--ink-3)", fontSize: 12 }}>Clip missing.</div>}
          {clip && (
            <button className="st-btn ghost" style={{ marginTop: 8, fontSize: 12, padding: "5px 10px" }} onClick={() => setTrimOpen((v) => !v)}>
              {trimOpen ? "Hide video scrubber" : "Open video scrubber"}
            </button>
          )}
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
                  <span style={{ fontSize: 11, width: 70, color: "var(--ink-2)" }}>Tone</span>
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
              </div>
            </div>
          </div>
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
    </aside>
  );
}
