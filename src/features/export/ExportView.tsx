import { useEffect, useRef, useState } from "react";
import { useProject } from "../../state/ProjectContext";
import { useExportSettings } from "../../state/ExportSettingsContext";
import { cutDuration } from "../assemble/assemble";
import { exportCut, buildScriptText, buildSrt, type TitleOverlay } from "./export";
import { loadVoiceModel, VOICES, type Voice } from "../../lib/kokoroTts";
import { ELEVEN_VOICES } from "../../lib/elevenLabs";
import type { TtsEngine } from "../../lib/tts";
import FinalPreview, { type PreviewTitle } from "./FinalPreview";

// Bundled title fonts (add more by dropping OFL/Apache TTFs in /public/fonts and
// listing them here; users can also upload their own font per export).
const TITLE_FONTS = [
  { id: "sans", label: "Sans-serif", url: "/fonts/title-sans.ttf" },
  { id: "serif", label: "Serif", url: "/fonts/title-serif.ttf" },
];
const TITLE_SWATCHES = [
  { label: "White", value: "#ffffff" },
  { label: "Black", value: "#000000" },
  { label: "Yellow", value: "#ffd400" },
];
type TitlePosition = TitleOverlay["position"];
type TitleScope = TitleOverlay["scope"];

function download(name: string, blobOrText: Blob | string, type = "text/plain") {
  const blob = typeof blobOrText === "string" ? new Blob([blobOrText], { type }) : blobOrText;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function loadFont(): Promise<Uint8Array> {
  const res = await fetch("/caption-font.ttf");
  if (!res.ok) throw new Error("caption font not found at /caption-font.ttf");
  return new Uint8Array(await res.arrayBuffer());
}

function sliderTrackStyle(val: number, min: number, max: number): React.CSSProperties {
  const pct = Math.min(100, Math.max(0, ((val - min) / (max - min)) * 100));
  return {
    flex: 1,
    width: "100%",
    background: `linear-gradient(to right, rgba(255, 179, 57, 0.35) 0%, rgba(255, 179, 57, 0.35) ${pct}%, var(--panel-3, #22262e) ${pct}%, var(--panel-3, #22262e) 100%)`,
  };
}

export default function ExportView() {
  const { state, dispatch } = useProject();
  const { cut, clips } = state;
  // Persisted across tab navigation (see ExportSettingsContext).
  const { settings: es, update } = useExportSettings();
  const {
    music, musicVolume, voiceover, ttsEngine, voice, elevenVoiceId, voiceoverSpeed, voiceoverLeadSec, voiceoverGapSec, captionScale, captionOpacity, captionLineHeight,
    titleText, titleFontId, titleFontFile, titleSize, titleColor, titlePos, titleScope,
  } = es;
  // Transient per-render state (fine to reset on navigation).
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [modelMsg, setModelMsg] = useState("");
  const [musicLib, setMusicLib] = useState<string[]>([]);
  const [playingName, setPlayingName] = useState("");
  const audioRef = useRef<HTMLAudioElement>(null);

  // Load the music-bed folder (MUSIC_DIR) listing from the dev server.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    let cancelled = false;
    fetch("/api/music/list")
      .then((r) => (r.ok ? r.json() : { files: [] }))
      .then((d: { files?: string[] }) => { if (!cancelled) setMusicLib(d.files ?? []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  if (!cut) return <p style={{ color: "var(--ink-3)" }}>Build a cut first.</p>;

  async function loadTitleFont(): Promise<Uint8Array> {
    if (titleFontId === "custom") {
      if (!titleFontFile) throw new Error("choose a title font file, or pick the bundled font");
      return new Uint8Array(await titleFontFile.arrayBuffer());
    }
    const url = TITLE_FONTS.find((f) => f.id === titleFontId)?.url ?? "/caption-font.ttf";
    const res = await fetch(url);
    if (!res.ok) throw new Error("title font not found");
    return new Uint8Array(await res.arrayBuffer());
  }

  // Kick off the (one-time, ~80MB) Kokoro model download, so the first export
  // beat isn't stuck waiting on it silently. ElevenLabs runs server-side via the
  // /api/tts proxy, so it needs no local model.
  function preloadKokoro() {
    setModelMsg("Preparing voice model…");
    loadVoiceModel((p) => {
      if (p.status === "progress" && typeof p.progress === "number") {
        setModelMsg(`Downloading voice model… ${Math.round(p.progress)}%`);
      }
    })
      .then(() => setModelMsg("Voice model ready ✓"))
      .catch((e) => setModelMsg(`Voice model failed: ${e instanceof Error ? e.message : String(e)}`));
  }

  function toggleVoiceover(checked: boolean) {
    update({ voiceover: checked });
    if (!checked) return setModelMsg("");
    if (ttsEngine === "kokoro") preloadKokoro();
    else setModelMsg("");
  }

  function changeEngine(engine: TtsEngine) {
    update({ ttsEngine: engine });
    if (engine === "kokoro") preloadKokoro();
    else setModelMsg("");
  }

  function togglePreview(name: string) {
    const a = audioRef.current;
    if (!a) return;
    if (playingName === name && !a.paused) { a.pause(); setPlayingName(""); return; }
    a.src = `/api/music/file?name=${encodeURIComponent(name)}`;
    a.play().then(() => setPlayingName(name)).catch(() => {});
  }

  async function selectLibraryMusic(name: string) {
    if (music?.name === name) { update({ music: null }); return; } // toggle off
    try {
      const res = await fetch(`/api/music/file?name=${encodeURIComponent(name)}`);
      if (!res.ok) return;
      const blob = await res.blob();
      update({ music: new File([blob], name, { type: blob.type || "audio/mpeg" }) });
    } catch { /* drive not mounted / file gone */ }
  }

  async function runExport() {
    setError("");
    setVideoUrl("");
    setProgress(0);
    try {
      const fontBytes = await loadFont();
      const title: TitleOverlay | null = titleText.trim()
        ? { text: titleText, fontBytes: await loadTitleFont(), sizePx: titleSize, color: titleColor, position: titlePos, scope: titleScope }
        : null;
      const { blob, timings } = await exportCut(
        cut!,
        clips,
        { fontBytes, music, musicVolume, voiceover, ttsEngine, voice, elevenVoiceId, voiceoverSpeed, voiceoverLeadSec, voiceoverGapSec, title, captionScale, captionBgOpacity: captionOpacity, captionLineHeight },
        setProgress,
      );
      setVideoUrl(URL.createObjectURL(blob));
      // Voiceover sets each beat's real length — write it back so the Script/SRT
      // exports and the preview reflect what the rendered video actually does.
      if (voiceover) {
        const byId = new Map(cut!.beats.map((b) => [b.id, b]));
        for (const t of timings) {
          const beat = byId.get(t.id);
          if (beat) dispatch({ type: "UPDATE_BEAT", beat: { ...beat, inSec: t.inSec, outSec: t.outSec, durationSec: t.durationSec } });
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
    }
  }

  const busy = progress !== null;
  // Name the downloads after the project title (falls back to "highlight").
  const fileBase = (state.title || "highlight").trim().replace(/[^\w\- ]+/g, "").replace(/\s+/g, "-") || "highlight";
  const previewTitle: PreviewTitle | null = titleText.trim()
    ? { text: titleText, sizePx: titleSize, color: titleColor, position: titlePos, scope: titleScope, serif: titleFontId === "serif" }
    : null;

  return (
    <section style={{ maxWidth: 560, display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <span className="st-chip">{cut.beats.length} beat{cut.beats.length === 1 ? "" : "s"}</span>
        <span className="st-chip st-num">{cutDuration(cut).toFixed(1)}s</span>
        <span className="st-chip">{cut.aspect}</span>
        <span className="st-chip">1080p</span>
        <span className="st-chip">Burned-in captions</span>
      </div>

      {/* Captions Styling Card */}
      <div className="st-field">
        <label>Captions Styling</label>
        <div className="st-color-adjustments" style={{ display: "flex", flexDirection: "column", gap: 10, background: "var(--panel-2)", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11, width: 110, color: "var(--ink-2)" }}>Caption size</span>
            <input type="range" min={0.5} max={2} step={0.1} value={captionScale} onChange={(e) => update({ captionScale: Number(e.target.value) })} style={sliderTrackStyle(captionScale, 0.5, 2)} />
            <span style={{ fontSize: 10, width: 34, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>{captionScale.toFixed(1)}×</span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11, width: 110, color: "var(--ink-2)" }}>Underlay opacity</span>
            <input type="range" min={0} max={1} step={0.05} value={captionOpacity} onChange={(e) => update({ captionOpacity: Number(e.target.value) })} style={sliderTrackStyle(captionOpacity, 0, 1)} />
            <span style={{ fontSize: 10, width: 34, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>{Math.round(captionOpacity * 100)}%</span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }} title="Spacing between wrapped caption lines. ~1.6 keeps line backgrounds flush.">
            <span style={{ fontSize: 11, width: 110, color: "var(--ink-2)" }}>Line height</span>
            <input type="range" min={1.0} max={2.2} step={0.05} value={captionLineHeight} onChange={(e) => update({ captionLineHeight: Number(e.target.value) })} style={sliderTrackStyle(captionLineHeight, 1.0, 2.2)} />
            <span style={{ fontSize: 10, width: 34, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>{captionLineHeight.toFixed(2)}</span>
          </div>
        </div>
      </div>

      {/* AI Voiceover Card */}
      <div className="st-field">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <label style={{ margin: 0, display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--ink-3)", fontWeight: 600 }}>
            <input type="checkbox" checked={voiceover} onChange={(e) => toggleVoiceover(e.target.checked)} style={{ accentColor: "var(--accent)", cursor: "pointer" }} />
            Voiceover (AI Narration)
          </label>
          {voiceover && (
            <select value={ttsEngine} onChange={(e) => changeEngine(e.target.value as TtsEngine)} style={{ background: "var(--panel-3)", border: "1px solid var(--line)", borderRadius: 6, color: "var(--ink)", fontSize: 11, padding: "3px 7px", outline: "none" }}>
              <option value="kokoro">Kokoro (in-browser, free)</option>
              <option value="elevenlabs">ElevenLabs (higher quality)</option>
            </select>
          )}
        </div>

        {voiceover && (
          <div className="st-color-adjustments" style={{ display: "flex", flexDirection: "column", gap: 10, background: "var(--panel-2)", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, width: 110, color: "var(--ink-2)" }}>Voice</span>
              {ttsEngine === "kokoro" ? (
                <select value={voice} onChange={(e) => update({ voice: e.target.value as Voice })} style={{ flex: 1, background: "var(--panel-3)", border: "1px solid var(--line)", borderRadius: 6, color: "var(--ink)", fontSize: 12, padding: "4px 8px", outline: "none" }}>
                  {[...new Set(VOICES.map((v) => v.group))].map((g) => (
                    <optgroup key={g} label={g}>
                      {VOICES.filter((v) => v.group === g).map((v) => (
                        <option key={v.id} value={v.id}>{v.name}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              ) : (
                <select value={elevenVoiceId} onChange={(e) => update({ elevenVoiceId: e.target.value })} style={{ flex: 1, background: "var(--panel-3)", border: "1px solid var(--line)", borderRadius: 6, color: "var(--ink)", fontSize: 12, padding: "4px 8px", outline: "none" }}>
                  {ELEVEN_VOICES.map((v) => (
                    <option key={v.id} value={v.id}>{v.label}</option>
                  ))}
                </select>
              )}
            </div>

            {modelMsg && <span style={{ fontSize: 11, color: "var(--accent)" }}>{modelMsg}</span>}

            <div style={{ display: "flex", alignItems: "center", gap: 8 }} title="Slows or speeds the narration read.">
              <span style={{ fontSize: 11, width: 110, color: "var(--ink-2)" }}>Voice speed</span>
              <input type="range" min={0.7} max={1.2} step={0.05} value={voiceoverSpeed} onChange={(e) => update({ voiceoverSpeed: Number(e.target.value) })} style={sliderTrackStyle(voiceoverSpeed, 0.7, 1.2)} />
              <span style={{ fontSize: 10, width: 34, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>{voiceoverSpeed.toFixed(2)}×</span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8 }} title="Silence before the voice starts in each beat.">
              <span style={{ fontSize: 11, width: 110, color: "var(--ink-2)" }}>Lead-in before voice</span>
              <input type="range" min={0} max={2} step={0.1} value={voiceoverLeadSec} onChange={(e) => update({ voiceoverLeadSec: Number(e.target.value) })} style={sliderTrackStyle(voiceoverLeadSec, 0, 2)} />
              <span style={{ fontSize: 10, width: 34, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>{voiceoverLeadSec.toFixed(1)}s</span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8 }} title="Silence after the voice ends in each beat.">
              <span style={{ fontSize: 11, width: 110, color: "var(--ink-2)" }}>Tail gap after voice</span>
              <input type="range" min={0} max={2} step={0.1} value={voiceoverGapSec} onChange={(e) => update({ voiceoverGapSec: Number(e.target.value) })} style={sliderTrackStyle(voiceoverGapSec, 0, 2)} />
              <span style={{ fontSize: 10, width: 34, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>{voiceoverGapSec.toFixed(1)}s</span>
            </div>
          </div>
        )}
      </div>

      {/* Music Bed Card */}
      <div className="st-field">
        <label>Music Bed (Optional)</label>
        <div className="st-color-adjustments" style={{ display: "flex", flexDirection: "column", gap: 10, background: "var(--panel-2)", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)" }}>
          {musicLib.length > 0 && (
            <div style={{ border: "1px solid var(--line)", borderRadius: 7, overflow: "hidden", maxHeight: 150, overflowY: "auto", background: "var(--panel-3)" }}>
              {musicLib.map((name, i) => {
                const selected = music?.name === name;
                const isPlaying = playingName === name;
                return (
                  <div
                    key={name}
                    style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "6px 10px",
                      borderTop: i === 0 ? "none" : "1px solid var(--line)",
                      background: selected ? "rgba(255,179,57,0.14)" : "transparent",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => togglePreview(name)}
                      title={isPlaying ? "Pause" : "Preview"}
                      style={{ width: 24, height: 24, flexShrink: 0, display: "grid", placeItems: "center", borderRadius: 5, border: "1px solid var(--line)", background: "transparent", color: "var(--ink-2)", cursor: "pointer" }}
                    >
                      {isPlaying
                        ? <svg width="10" height="11" viewBox="0 0 12 13" fill="currentColor"><rect x="1" width="3.4" height="13" rx="1" /><rect x="7.6" width="3.4" height="13" rx="1" /></svg>
                        : <svg width="10" height="11" viewBox="0 0 12 13" fill="currentColor"><path d="M0 0l12 6.5L0 13z" /></svg>}
                    </button>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0, fontSize: 12, cursor: "pointer", color: "var(--ink-2)" }}>
                      <input type="checkbox" checked={selected} onChange={() => selectLibraryMusic(name)} style={{ cursor: "pointer", accentColor: "var(--accent)" }} />
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
                    </label>
                  </div>
                );
              })}
            </div>
          )}

          <label style={{ fontSize: 11, color: "var(--ink-2)", display: "flex", alignItems: "center", gap: 8 }}>
            Or choose your own audio:
            <input type="file" accept="audio/*" onChange={(e) => update({ music: e.target.files?.[0] ?? null })} style={{ fontSize: 11, color: "var(--ink-3)" }} />
          </label>
          {music && <div style={{ fontSize: 11, color: "var(--accent)" }}>Loaded: {music.name}</div>}
          <audio ref={audioRef} onEnded={() => setPlayingName("")} hidden />

          {music && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, width: 110, color: "var(--ink-2)" }}>Music volume</span>
              <input type="range" min={0} max={1} step={0.05} value={musicVolume} onChange={(e) => update({ musicVolume: Number(e.target.value) })} style={sliderTrackStyle(musicVolume, 0, 1)} />
              <span style={{ fontSize: 10, width: 34, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>{Math.round(musicVolume * 100)}%</span>
            </div>
          )}
        </div>
      </div>

      {/* Title Overlay Card */}
      <div className="st-field">
        <label>Title Overlay (Optional)</label>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, background: "var(--panel-2)", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)" }}>
          <input
            value={titleText}
            onChange={(e) => update({ titleText: e.target.value })}
            placeholder="e.g. Season Highlights"
            style={{ width: "100%", padding: "7px 10px", fontSize: 12, background: "var(--panel-3)", border: "1px solid var(--line)", borderRadius: 7, color: "var(--ink)", outline: "none" }}
          />

          {titleText.trim() && (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", fontSize: 12 }}>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                Font
                <select value={titleFontId} onChange={(e) => update({ titleFontId: e.target.value })} style={{ background: "var(--panel-3)", border: "1px solid var(--line)", borderRadius: 6, color: "var(--ink)", fontSize: 12, padding: "4px 8px", outline: "none" }}>
                  {TITLE_FONTS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                  <option value="custom">Custom upload…</option>
                </select>
              </label>
              {titleFontId === "custom" && (
                <input type="file" accept=".ttf,.otf,font/ttf,font/otf" onChange={(e) => update({ titleFontFile: e.target.files?.[0] ?? null })} style={{ fontSize: 11 }} />
              )}
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                Size
                <input type="number" min={16} max={300} step={2} value={titleSize} onChange={(e) => update({ titleSize: Number(e.target.value) })} style={{ width: 56, background: "var(--panel-3)", border: "1px solid var(--line)", borderRadius: 6, color: "var(--ink)", padding: "4px 6px", fontSize: 12, textAlign: "right", outline: "none" }} /> px
              </label>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                Color
                {TITLE_SWATCHES.map((s) => (
                  <button
                    key={s.value}
                    onClick={() => update({ titleColor: s.value })}
                    title={s.label}
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 4,
                      background: s.value,
                      border: titleColor.toLowerCase() === s.value ? "2px solid var(--accent)" : "1px solid var(--line)",
                      cursor: "pointer",
                      padding: 0,
                    }}
                  />
                ))}
                <input type="color" value={titleColor} onChange={(e) => update({ titleColor: e.target.value })} title="Custom color" style={{ width: 24, height: 22, border: "none", background: "none", cursor: "pointer" }} />
              </span>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                Position
                <select value={titlePos} onChange={(e) => update({ titlePos: e.target.value as TitlePosition })} style={{ background: "var(--panel-3)", border: "1px solid var(--line)", borderRadius: 6, color: "var(--ink)", fontSize: 12, padding: "4px 8px", outline: "none" }}>
                  <option value="top">Top</option>
                  <option value="center">Center</option>
                  <option value="bottom">Bottom</option>
                </select>
              </label>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                Show
                <select value={titleScope} onChange={(e) => update({ titleScope: e.target.value as TitleScope })} style={{ background: "var(--panel-3)", border: "1px solid var(--line)", borderRadius: 6, color: "var(--ink)", fontSize: 12, padding: "4px 8px", outline: "none" }}>
                  <option value="intro">First 3s</option>
                  <option value="entire">Entire video</option>
                </select>
              </label>
            </div>
          )}
        </div>
      </div>

      {/* Preview Section */}
      <div className="st-field">
        <label>Preview (approx. of final output)</label>
        <div style={{ background: "var(--panel-2)", padding: "10px", borderRadius: 8, border: "1px solid var(--line)" }}>
          <FinalPreview
            cut={cut}
            clips={clips}
            captionScale={captionScale}
            captionOpacity={captionOpacity}
            captionLineHeight={captionLineHeight}
            title={previewTitle}
            music={music}
            musicVolume={musicVolume}
            voiceover={voiceover}
            ttsEngine={ttsEngine}
            voice={voice}
            elevenVoiceId={elevenVoiceId}
            voiceoverSpeed={voiceoverSpeed}
            voiceoverLeadSec={voiceoverLeadSec}
          />
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <button className="st-btn primary" style={{ flex: 1, justifyContent: "center", padding: "9px 14px" }} onClick={runExport} disabled={busy}>
          {busy ? "Exporting…" : "Export video"}
        </button>
        <button className="st-btn ghost" style={{ padding: "9px 12px" }} onClick={() => download(`${fileBase}-script.txt`, buildScriptText(cut))}>
          Script (.txt)
        </button>
        <button className="st-btn ghost" style={{ padding: "9px 12px" }} onClick={() => download(`${fileBase}.srt`, buildSrt(cut))}>
          Captions (.srt)
        </button>
      </div>

      {busy && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
          <progress max={100} value={(progress ?? 0) * 100} style={{ flex: 1, accentColor: "var(--accent)" }} />
          <span style={{ fontSize: 12, width: 44, color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>{Math.round((progress ?? 0) * 100)}%</span>
        </div>
      )}

      {error && <p style={{ color: "var(--danger)", background: "rgba(229,105,95,0.1)", border: "1px solid rgba(229,105,95,0.25)", borderRadius: 7, padding: "8px 12px", fontSize: 12 }}>{error}</p>}

      {videoUrl && (
        <div style={{ marginTop: 12 }}>
          <video src={videoUrl} controls style={{ width: "100%", borderRadius: 8, background: "#000", border: "1px solid var(--line)" }} />
          <div style={{ marginTop: 8 }}>
            <a className="st-btn primary" style={{ display: "inline-flex", textDecoration: "none" }} href={videoUrl} download={`${fileBase}.mp4`}>Download video ⬇</a>
          </div>
        </div>
      )}
    </section>
  );
}
