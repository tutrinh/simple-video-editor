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

  if (!cut) return <p style={{ color: "#999" }}>Build a cut first.</p>;

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
    <section style={{ maxWidth: 560 }}>
      <p style={{ color: "#666" }}>
        {cut.beats.length} beats · {cutDuration(cut).toFixed(1)}s · {cut.aspect} · 1080p · burned-in captions
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, margin: "12px 0" }}>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center", fontSize: 13 }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            Caption size
            <input type="range" min={0.5} max={2} step={0.1} value={captionScale} onChange={(e) => update({ captionScale: Number(e.target.value) })} />
            <span style={{ width: 30, color: "#888" }}>{captionScale.toFixed(1)}×</span>
          </label>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            Underlay opacity
            <input type="range" min={0} max={1} step={0.05} value={captionOpacity} onChange={(e) => update({ captionOpacity: Number(e.target.value) })} />
            <span style={{ width: 34, color: "#888" }}>{Math.round(captionOpacity * 100)}%</span>
          </label>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }} title="Spacing between wrapped caption lines. ~1.6 keeps the line backgrounds flush; lower overlaps them, higher opens a gap.">
            Line height
            <input type="range" min={1.0} max={2.2} step={0.05} value={captionLineHeight} onChange={(e) => update({ captionLineHeight: Number(e.target.value) })} />
            <span style={{ width: 30, color: "#888" }}>{captionLineHeight.toFixed(2)}</span>
          </label>
        </div>

        <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <input type="checkbox" checked={voiceover} onChange={(e) => toggleVoiceover(e.target.checked)} />
          Voiceover — narrate each beat&apos;s script line
          {voiceover && (
            <>
              <select value={ttsEngine} onChange={(e) => changeEngine(e.target.value as TtsEngine)} style={{ fontSize: 13 }}>
                <option value="kokoro">Kokoro (in-browser, free)</option>
                <option value="elevenlabs">ElevenLabs (higher quality, needs key)</option>
              </select>
              {ttsEngine === "kokoro" ? (
                <select value={voice} onChange={(e) => update({ voice: e.target.value as Voice })} style={{ fontSize: 13 }}>
                  {[...new Set(VOICES.map((v) => v.group))].map((g) => (
                    <optgroup key={g} label={g}>
                      {VOICES.filter((v) => v.group === g).map((v) => (
                        <option key={v.id} value={v.id}>{v.name}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              ) : (
                <select value={elevenVoiceId} onChange={(e) => update({ elevenVoiceId: e.target.value })} style={{ fontSize: 13 }}>
                  {ELEVEN_VOICES.map((v) => (
                    <option key={v.id} value={v.id}>{v.label}</option>
                  ))}
                </select>
              )}
            </>
          )}
        </label>
        {voiceover && modelMsg && <span style={{ fontSize: 12, color: "#888" }}>{modelMsg}</span>}
        {voiceover && (
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center", fontSize: 13 }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }} title="Slows or speeds the narration read. 1.00× is natural.">
              Voice speed
              <input type="range" min={0.7} max={1.2} step={0.05} value={voiceoverSpeed} onChange={(e) => update({ voiceoverSpeed: Number(e.target.value) })} />
              <span style={{ width: 38, color: "#888" }}>{voiceoverSpeed.toFixed(2)}×</span>
            </label>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }} title="Silence before the voice starts in each beat, so it doesn't begin on the first frame.">
              Lead-in before voice
              <input type="range" min={0} max={2} step={0.1} value={voiceoverLeadSec} onChange={(e) => update({ voiceoverLeadSec: Number(e.target.value) })} />
              <span style={{ width: 34, color: "#888" }}>{voiceoverLeadSec.toFixed(1)}s</span>
            </label>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }} title="Silence after the voice ends in each beat, so beats don't run wall-to-wall.">
              Tail after voice
              <input type="range" min={0} max={2} step={0.1} value={voiceoverGapSec} onChange={(e) => update({ voiceoverGapSec: Number(e.target.value) })} />
              <span style={{ width: 34, color: "#888" }}>{voiceoverGapSec.toFixed(1)}s</span>
            </label>
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 13 }}>
            Music bed (optional — looped &amp; trimmed to length; {voiceover ? "ducked under the voiceover" : "leave empty for silent"}):
          </div>

          {musicLib.length > 0 && (
            <div style={{ border: "1px solid var(--line, #333)", borderRadius: 8, overflow: "hidden", maxHeight: 172, overflowY: "auto" }}>
              {musicLib.map((name, i) => {
                const selected = music?.name === name;
                const isPlaying = playingName === name;
                return (
                  <div
                    key={name}
                    style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "6px 10px",
                      borderTop: i === 0 ? "none" : "1px solid var(--line, #2a2a2a)",
                      background: selected ? "rgba(255,179,57,0.12)" : "transparent",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => togglePreview(name)}
                      title={isPlaying ? "Pause" : "Preview"}
                      style={{ width: 26, height: 26, flexShrink: 0, display: "grid", placeItems: "center", borderRadius: 6, border: "1px solid var(--line, #444)", background: "transparent", color: "inherit", cursor: "pointer" }}
                    >
                      {isPlaying
                        ? <svg width="10" height="11" viewBox="0 0 12 13" fill="currentColor"><rect x="1" width="3.4" height="13" rx="1" /><rect x="7.6" width="3.4" height="13" rx="1" /></svg>
                        : <svg width="10" height="11" viewBox="0 0 12 13" fill="currentColor"><path d="M0 0l12 6.5L0 13z" /></svg>}
                    </button>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0, fontSize: 13, cursor: "pointer" }}>
                      <input type="checkbox" checked={selected} onChange={() => selectLibraryMusic(name)} style={{ cursor: "pointer", flexShrink: 0 }} />
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
                    </label>
                  </div>
                );
              })}
            </div>
          )}

          <label style={{ fontSize: 13 }}>
            Or choose your own:{" "}
            <input type="file" accept="audio/*" onChange={(e) => update({ music: e.target.files?.[0] ?? null })} />
          </label>
          {music && <div style={{ fontSize: 12, color: "#888" }}>Loaded: {music.name}</div>}
          <audio ref={audioRef} onEnded={() => setPlayingName("")} hidden />
        </div>
        {music && (
          <label style={{ fontSize: 13, display: "inline-flex", alignItems: "center", gap: 6 }}>
            Music volume
            <input type="range" min={0} max={1} step={0.05} value={musicVolume} onChange={(e) => update({ musicVolume: Number(e.target.value) })} />
            <span style={{ width: 34, color: "#888" }}>{Math.round(musicVolume * 100)}%</span>
          </label>
        )}

        <div style={{ border: "1px solid #e2e2e2", borderRadius: 8, padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          <label style={{ fontSize: 13 }}>
            Title overlay (optional):{" "}
            <input
              value={titleText}
              onChange={(e) => update({ titleText: e.target.value })}
              placeholder="e.g. Season Highlights"
              style={{ width: 260, padding: "3px 6px", fontSize: 14 }}
            />
          </label>
          {titleText.trim() && (
            <>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", fontSize: 13 }}>
                <label>
                  Font{" "}
                  <select value={titleFontId} onChange={(e) => update({ titleFontId: e.target.value })}>
                    {TITLE_FONTS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                    <option value="custom">Custom upload…</option>
                  </select>
                </label>
                {titleFontId === "custom" && (
                  <input type="file" accept=".ttf,.otf,font/ttf,font/otf" onChange={(e) => update({ titleFontFile: e.target.files?.[0] ?? null })} />
                )}
                <label>
                  Size{" "}
                  <input type="number" min={16} max={300} step={2} value={titleSize} onChange={(e) => update({ titleSize: Number(e.target.value) })} style={{ width: 64 }} /> px
                </label>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  Color
                  {TITLE_SWATCHES.map((s) => (
                    <button
                      key={s.value}
                      onClick={() => update({ titleColor: s.value })}
                      title={s.label}
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: 4,
                        background: s.value,
                        border: titleColor.toLowerCase() === s.value ? "2px solid #4a90d9" : "1px solid #bbb",
                        cursor: "pointer",
                        padding: 0,
                      }}
                    />
                  ))}
                  <input type="color" value={titleColor} onChange={(e) => update({ titleColor: e.target.value })} title="Custom color" />
                </span>
                <label>
                  Position{" "}
                  <select value={titlePos} onChange={(e) => update({ titlePos: e.target.value as TitlePosition })}>
                    <option value="top">Top</option>
                    <option value="center">Center</option>
                    <option value="bottom">Bottom</option>
                  </select>
                </label>
                <label>
                  Show{" "}
                  <select value={titleScope} onChange={(e) => update({ titleScope: e.target.value as TitleScope })}>
                    <option value="intro">First 3s</option>
                    <option value="entire">Entire video</option>
                  </select>
                </label>
              </div>
              {/* Approximate preview (position/size/color; the exported font is the one chosen). */}
              <div style={{ position: "relative", width: 240, aspectRatio: String(16 / 9), background: "#111", borderRadius: 4, overflow: "hidden" }}>
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    padding: "0 6px",
                    textAlign: "center",
                    color: titleColor,
                    fontWeight: 700,
                    lineHeight: 1.1,
                    textShadow: "1px 1px 2px rgba(0,0,0,0.6)",
                    fontSize: Math.max(8, (titleSize / 1080) * 135),
                    top: titlePos === "top" ? "6%" : titlePos === "center" ? "50%" : undefined,
                    bottom: titlePos === "bottom" ? "6%" : undefined,
                    transform: titlePos === "center" ? "translateY(-50%)" : undefined,
                  }}
                >
                  {titleText}
                </div>
              </div>
            </>
          )}
        </div>
        <div style={{ borderTop: "1px solid #eee", paddingTop: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Preview (approx. of the final output)</div>
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
            voiceoverLeadSec={voiceoverLeadSec}
          />
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button onClick={runExport} disabled={busy}>{busy ? "Exporting…" : "Export video"}</button>
          <button onClick={() => download(`${fileBase}-script.txt`, buildScriptText(cut))}>Script (.txt)</button>
          <button onClick={() => download(`${fileBase}.srt`, buildSrt(cut))}>Captions (.srt)</button>
        </div>
      </div>

      {busy && (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <progress max={100} value={(progress ?? 0) * 100} style={{ flex: 1 }} />
          <span style={{ fontSize: 13, width: 44 }}>{Math.round((progress ?? 0) * 100)}%</span>
        </div>
      )}

      {error && <p style={{ color: "#b00" }}>{error}</p>}

      {videoUrl && (
        <div style={{ marginTop: 16 }}>
          <video src={videoUrl} controls style={{ width: "100%", borderRadius: 8, background: "#000" }} />
          <div style={{ marginTop: 8 }}>
            <a href={videoUrl} download={`${fileBase}.mp4`}>Download video ⬇</a>
          </div>
        </div>
      )}
    </section>
  );
}
