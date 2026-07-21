import { useEffect, useState } from "react";
import { useProject } from "../state/ProjectContext";
import { useSettings, toneHint, MODEL_OPTIONS, TONE_OPTIONS } from "../state/SettingsContext";
import type { Beat, Clip } from "../domain/types";
import { computeWindow } from "../features/assemble/assemble";
import { rewriteCaption, suggestCaptionAlternatives } from "../features/refine/refine";
import BeatTrimmer from "../features/refine/BeatTrimmer";
import { estimateSpokenSeconds, captionSchedule, scheduleDuration } from "../lib/pacing";
import { fmtSecs } from "./util";

/** Short label for a model id, e.g. "claude-opus-4-8" → "opus-4-8". */
const modelLabel = (m: string) => m.replace(/^claude-/, "");

interface Props {
  beat: Beat | null;
  clip: Clip | undefined;
  clips: Clip[];
  logline: string;
  index: number;
  total: number;
}

export default function Inspector({ beat, clip, clips, logline, index, total }: Props) {
  const { dispatch } = useProject();
  const { settings } = useSettings();
  const [aiBusy, setAiBusy] = useState(false);
  const [trimOpen, setTrimOpen] = useState(false);
  // Per-line caption alternatives: model + mood chosen here (seeded from settings),
  // results aligned to caption rows (row i → its suggestions).
  const [altModel, setAltModel] = useState<string>(settings.authorModel);
  const [altMood, setAltMood] = useState<string>(settings.tone);
  const [altBusy, setAltBusy] = useState(false);
  const [alts, setAlts] = useState<string[][]>([]);

  // Suggestions belong to one beat — clear them when a different beat is selected.
  useEffect(() => { setAlts([]); }, [beat?.id]);

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
    try {
      const result = await suggestCaptionAlternatives(clip, captionLines, logline, { model: altModel, tone: toneHint(altMood) }, 3);
      setAlts(result);
    } catch { /* keep any prior suggestions on failure */ } finally { setAltBusy(false); }
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
  function swapClip(id: string) {
    const c = clips.find((x) => x.id === id);
    if (c) update({ ...b, clipId: c.id, ...computeWindow(c.durationSec, b.captionText) });
  }
  async function aiRewrite() {
    if (!clip) return;
    setAiBusy(true);
    try {
      const line = await rewriteCaption(clip, b.captionText, logline, { model: settings.authorModel, tone: toneHint(settings.tone) });
      if (line) applyLines([line], timed ? [durations[0] ?? r1(estimateSpokenSeconds(line))] : undefined);
    } catch { /* leave caption unchanged on failure */ } finally { setAiBusy(false); }
  }

  const d = clip?.description;

  return (
    <aside className="st-col insp">
      <div className="st-colhead">Beat {String(index + 1).padStart(2, "0")} <span className="cnt">of {total}</span></div>
      <div className="st-insp-body">
        <div className="st-ip-poster" style={{ background: clip?.poster ? `#0a0b0d url(${JSON.stringify(clip.poster)}) center/cover no-repeat` : undefined }}>
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
              {altBusy ? "Generating…" : "Generate alternatives"}
            </button>
            <select value={altModel} onChange={(e) => setAltModel(e.target.value)} title="AI model">
              {MODEL_OPTIONS.map((m) => <option key={m} value={m}>{modelLabel(m)}</option>)}
            </select>
            <select value={altMood} onChange={(e) => setAltMood(e.target.value)} title="Mood / voice">
              {TONE_OPTIONS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </div>
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
          <label>AI nudges · this beat only</label>
          <div className="st-nudges">
            <button className="st-nudge" onClick={aiRewrite} disabled={aiBusy}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 20l4-1L20 7l-3-3L5 16z"/></svg>
              <span><b>{aiBusy ? "Rewriting…" : "Rewrite caption"}</b><small>Same beat, fresher line</small></span>
            </button>
            <div className="st-swap">
              <select value={b.clipId} onChange={(e) => swapClip(e.target.value)} title="Swap this beat's clip">
                {clips.map((c) => <option key={c.id} value={c.id}>Clip: {c.name}</option>)}
              </select>
            </div>
            <button className="st-nudge" onClick={() => dispatch({ type: "REMOVE_BEAT", id: b.id })}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13"/></svg>
              <span><b>Remove beat</b><small>Drop it from the cut</small></span>
            </button>
          </div>
        </div>

        <div className="st-divider" />

        <div className="st-desc">
          <div className="st-aiflag"><span className="dot" />Clip Description · Claude</div>
          {d ? (
            <dl>
              <dt>Subject / action</dt><dd>{d.subjectAction}</dd>
              <dt>Setting / mood</dt><dd>{d.settingMood}</dd>
              <dt>Usability</dt><dd className="st-num">{d.usability} / 5 · {d.model}</dd>
            </dl>
          ) : (
            <p style={{ color: "var(--ink-3)", fontSize: 13 }}>Not described yet — Regenerate to have Claude read this clip.</p>
          )}
        </div>
      </div>
    </aside>
  );
}
