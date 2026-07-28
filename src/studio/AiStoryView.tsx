import { useState } from "react";
import { useProject } from "../state/ProjectContext";
import {
  useSettings,
  TONE_OPTIONS,
  SCRIPT_TYPE_OPTIONS,
  AI_PROVIDER_OPTIONS,
  MODEL_OPTIONS,
  type AiProvider,
} from "../state/SettingsContext";
import { useRegenerate } from "./useRegenerate";
import { beatClips, isIncluded, posterBg } from "./util";
import { makeBeat } from "../features/assemble/assemble";
import { ControlButton, InputControl, SelectControl, TextareaControl } from "../design-system/ControlPrimitives";

/** Short label for a model id, e.g. "claude-opus-4-8" → "opus-4-8". */
const modelLabel = (m: string) => m.replace(/^claude-/, "");

/**
 * The single home for AI Story Gen: steering controls + clip analysis + authoring,
 * then (once a cut exists) a thumbnail grid of the authored beats — each with the
 * clip's factual description and an editable, AI-refinable script line.
 */
export default function AiStoryView() {
  const { state, dispatch } = useProject();
  const { settings, update } = useSettings();
  const regen = useRegenerate();

  const cut = state.cut;
  // "What's in the cut" — the arranged beats are the story we analyze & write for.
  const inCut = beatClips(state.clips, cut);
  const analyzedCount = inCut.filter((c) => c.description).length;
  const clipById = new Map(state.clips.map((c) => [c.id, c]));
  const includedClips = state.clips.filter(isIncluded);

  // Transient "✓ Added" feedback per beat after sending its line to the VO track.
  const [addedVo, setAddedVo] = useState<Set<string>>(new Set());
  const genId = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));

  // Beat start times along the timeline (running sum of beat durations).
  const beatStarts: number[] = [];
  if (cut) {
    let acc = 0;
    for (const b of cut.beats) { beatStarts.push(acc); acc += b.durationSec || Math.max(0.1, b.outSec - b.inSec); }
  }

  /** Add one beat's script line to the VO track as a narration segment placed at
   *  the beat's start (mirrors Timeline.seedVoFromBeats). Text is read by TTS. */
  function addBeatToVo(beatIndex: number) {
    if (!cut) return;
    const beat = cut.beats[beatIndex];
    const text = beat.scriptText.trim();
    if (!text) return;
    const dur = beat.durationSec || Math.max(0.1, beat.outSec - beat.inSec);
    dispatch({
      type: "ADD_VO",
      segment: {
        id: `vo-${genId()}`,
        text,
        startTimeSec: Math.round(beatStarts[beatIndex] * 10) / 10,
        durationSec: Math.round(dur * 10) / 10,
        captionVisible: true,
      },
    });
    setAddedVo((prev) => new Set(prev).add(beat.id));
    setTimeout(() => setAddedVo((prev) => { const n = new Set(prev); n.delete(beat.id); return n; }), 1600);
  }

  /** Send every beat that has a script line to the VO track. */
  function addAllToVo() {
    if (!cut) return;
    cut.beats.forEach((b, i) => { if (b.scriptText.trim()) addBeatToVo(i); });
  }

  /** Lay every included clip out as a straight cut (original order) so there's a
   *  cut to author from. The AI never invents the arrangement — the editor owns it. */
  function buildStraightCut() {
    if (includedClips.length === 0) return;
    dispatch({ type: "SET_CUT", cut: { beats: includedClips.map((c) => makeBeat(c, "")), aspect: cut?.aspect ?? "16:9" } });
  }

  return (
    <div className="st-ai no-scrollbar">
      {/* ── Steering header ─────────────────────────────────────────── */}
      <div className="st-ai-steer">
        <InputControl
          className="st-dir-input"
          value={state.direction}
          onChange={(e) => dispatch({ type: "SET_DIRECTION", direction: e.target.value })}
          placeholder="Direction (optional) — e.g. build the tension, save the best for last"
        />

        <div className="st-ai-steer-row">
          <label className="st-ai-field">
            <span>Script type</span>
            <SelectControl value={settings.scriptType} onChange={(e) => update({ scriptType: e.target.value })} title="Genre/format — steers the story structure">
              {SCRIPT_TYPE_OPTIONS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </SelectControl>
          </label>

          <label className="st-ai-field">
            <span>Tone</span>
            <SelectControl value={settings.tone} onChange={(e) => update({ tone: e.target.value })} title="Voice — steers how the script reads">
              {TONE_OPTIONS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </SelectControl>
          </label>

          {settings.aiProvider === "claude" ? (
            <label className="st-ai-field">
              <span>Model</span>
              <SelectControl value={settings.authorModel} onChange={(e) => update({ authorModel: e.target.value })} title="Claude model used to author & refine">
                {MODEL_OPTIONS.map((m) => <option key={m} value={m}>{modelLabel(m)}</option>)}
              </SelectControl>
            </label>
          ) : (
            <label className="st-ai-field">
              <span>Model</span>
              <span title="Codex uses the default model from your Codex CLI configuration">CLI default</span>
            </label>
          )}

          <label className="st-ai-field">
            <span>Engine</span>
            <SelectControl value={settings.aiProvider} onChange={(e) => update({ aiProvider: e.target.value as AiProvider })} title="AI CLI engine">
              {AI_PROVIDER_OPTIONS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </SelectControl>
          </label>
        </div>

        <div className="st-ai-actions">
          <ControlButton
            type="button"
            className="st-btn primary"
            onClick={regen.authorScript}
            disabled={regen.busy || !cut?.beats.length}
            title="Describe any un-analyzed beat clips, then write one script line per beat — your beats and their order are kept exactly as arranged"
          >
            {state.story ? "↻ Re-write script for the cut" : "✨ Write script for the cut"}
          </ControlButton>
          {inCut.length > 0 && (
            <ControlButton
              type="button"
              className="st-btn ghost"
              onClick={() => regen.analyzeClips()}
              disabled={regen.busy}
              title="Describe every beat clip in the cut with the selected AI engine (without writing the script)"
            >
              Analyze beats
            </ControlButton>
          )}
          {cut && cut.beats.some((b) => b.scriptText.trim()) && (
            <ControlButton
              type="button"
              className="st-btn ghost"
              onClick={addAllToVo}
              disabled={regen.busy}
              title="Add every beat's script line to the VO track as narration"
            >
              🎙️ Send all to VO
            </ControlButton>
          )}
          {cut && <span className="st-ai-count st-num">{analyzedCount} of {inCut.length} beats analyzed</span>}
        </div>

        {regen.busy && (
          <div className="st-ai-progress" role="status" aria-live="polite" aria-busy="true">
            <div className="st-ai-progress-head">
              <span className="st-ai-spinner" aria-hidden="true" />
              <div>
                <strong>{settings.aiProvider === "codex" ? "Codex" : "Claude"} is working</strong>
                <span>{regen.label || "Preparing your story…"}</span>
              </div>
            </div>
            <div
              className="st-ai-progress-track"
              role="progressbar"
              aria-label="AI Story progress"
              aria-valuetext={regen.label || "Working"}
            >
              <span />
            </div>
          </div>
        )}
        {regen.error && (
          <div className="st-ai-status err" onClick={regen.clearError} title="Dismiss" style={{ cursor: "pointer" }}>
            ⚠ {regen.error} · (click to dismiss)
          </div>
        )}
      </div>

      {/* ── Body: pre-cut guidance vs post-cut beat grid ────────────── */}
      {!cut ? (
        <div className="st-ai-pre">
          {includedClips.length === 0 ? (
            <div className="st-ai-empty">Drop clips into the bin first, then arrange them into a cut — the AI writes the script for the cut you build.</div>
          ) : (
            <div className="st-ai-empty">
              <p style={{ margin: "0 0 14px" }}>
                Arrange your clips into a cut first — the order you choose is the story.
                The AI then analyzes those beats and writes a script line for each, without changing your arrangement.
              </p>
              <ControlButton type="button" className="st-btn ghost" onClick={buildStraightCut} disabled={regen.busy}>
                Build a cut from your {includedClips.length} clip{includedClips.length === 1 ? "" : "s"} →
              </ControlButton>
            </div>
          )}
        </div>
      ) : (
        <div className="st-ai-post">
          {cut.templateName && (
            <div style={{ marginBottom: 10, padding: "8px 10px", border: "1px solid color-mix(in srgb, var(--accent) 35%, var(--line))", borderRadius: 8, background: "color-mix(in srgb, var(--accent) 7%, transparent)", color: "var(--ink-2)", fontSize: 11 }}>
              <strong style={{ color: "var(--accent)" }}>Template:</strong> {cut.templateName}
              {cut.templateToneHint ? ` · ${cut.templateToneHint}` : ""}
              <span style={{ display: "block", marginTop: 3, color: "var(--ink-3)" }}>AI Story will preserve its beat order and use each slot description as editorial guidance.</span>
            </div>
          )}
          {state.story?.logline && <div className="st-ai-logline">"{state.story.logline}"</div>}
          <div className="st-ai-sec">Beats ({cut.beats.length})</div>
          <div className="st-ai-grid">
            {cut.beats.map((beat, i) => {
              const clip = clipById.get(beat.clipId);
              const d = clip?.description;
              return (
                <div className="st-ai-card" key={beat.id}>
                  <div className="st-ai-poster" style={{ background: posterBg(clip) }}>
                    <span className="st-ai-badge">{i + 1}</span>
                    {d?.usability ? <span className="st-ai-use" title="Usability 1–5">★ {d.usability}</span> : null}
                  </div>

                  <div className="st-ai-desc">
                    {beat.templateSlotDescription && (
                      <span style={{ display: "block", marginBottom: 4, color: "var(--accent)", fontSize: 10, fontWeight: 700 }}>
                        Template role: {beat.templateSlotDescription}
                      </span>
                    )}
                    {d ? (
                      <>
                        <span className="st-ai-subject">{d.subjectAction}</span>
                        {d.settingMood && <span className="st-ai-setting"> · {d.settingMood}</span>}
                      </>
                    ) : clip?.isTemplatePlaceholder ? (
                      <span className="muted">Empty slot — assign footage when ready</span>
                    ) : (
                      <span className="muted">{clip?.name ?? "clip"} — not analyzed</span>
                    )}
                  </div>

                  <TextareaControl
                    className="st-ai-script"
                    value={beat.scriptText}
                    rows={2}
                    placeholder="Script line for this beat…"
                    onChange={(e) => dispatch({ type: "UPDATE_BEAT", beat: { ...beat, scriptText: e.target.value } })}
                  />

                  <div className="st-ai-cardactions">
                    <ControlButton
                      type="button"
                      className="st-btn ghost"
                      style={{ fontSize: 11, padding: "3px 9px" }}
                      onClick={() => addBeatToVo(i)}
                      disabled={!beat.scriptText.trim()}
                      title="Add this beat's script line to the VO track as narration (placed at the beat's start)"
                    >
                      {addedVo.has(beat.id) ? "✓ Added to VO" : "🎙️ Add to VO"}
                    </ControlButton>
                    <ControlButton
                      type="button"
                      className="st-btn ghost"
                      style={{ fontSize: 11, padding: "3px 9px" }}
                      onClick={() => regen.refineBeat(beat.id)}
                      disabled={regen.busy || !beat.scriptText.trim() || clip?.isTemplatePlaceholder}
                      title={clip?.isTemplatePlaceholder ? "Assign footage before refining this individual beat." : "Rewrite this line with Claude in the chosen tone"}
                    >
                      ✨ Refine
                    </ControlButton>
                    {clip && !clip.isTemplatePlaceholder && (
                      <ControlButton
                        type="button"
                        className="st-btn ghost"
                        style={{ fontSize: 11, padding: "3px 9px" }}
                        onClick={() => regen.analyzeClips(clip.id)}
                        disabled={regen.busy}
                        title="Re-describe this clip with Claude"
                      >
                        Re-analyze
                      </ControlButton>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
