import { useEffect, useRef, useState } from "react";
import { useProject } from "../../state/ProjectContext";
import { useExportSettings, type TitleLayerSettings } from "../../state/ExportSettingsContext";
import { cutDuration } from "../assemble/assemble";
import { exportCut, buildScriptText, buildSrt, type TitleOverlay, type TitleLayer } from "./export";
import { loadVoiceModel, VOICES, type Voice } from "../../lib/kokoroTts";
import { ELEVEN_VOICES } from "../../lib/elevenLabs";
import type { TtsEngine } from "../../lib/tts";
import FinalPreview, { type PreviewTitle, type PreviewTitleLayer } from "./FinalPreview";
import { GOOGLE_TITLE_FONTS, SYSTEM_TITLE_FONTS, ensureGoogleFontLoaded, findFontById, fetchGoogleFontBytes } from "../../lib/googleFonts";
import { BUILT_IN_PRESETS, loadSavedPresets, savePreset, type TitlePreset } from "../../lib/titlePresets";

const TITLE_SWATCHES = [
  { label: "White", value: "#ffffff" },
  { label: "Black", value: "#000000" },
  { label: "Yellow", value: "#ffd400" },
];

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
  const res = await fetch("/fonts/Inter-Bold.ttf");
  if (!res.ok) throw new Error("caption font missing");
  return new Uint8Array(await res.arrayBuffer());
}

function sliderTrackStyle(val: number, min: number, max: number) {
  const pct = Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100));
  return {
    flex: 1,
    accentColor: "var(--accent)",
    background: `linear-gradient(to right, var(--accent) ${pct}%, var(--panel-3) ${pct}%)`,
    height: 4,
    borderRadius: 2,
  };
}

export default function ExportView() {
  const { state, dispatch } = useProject();
  const cut = state.cut;
  const clips = state.clips;
  const { settings: es, update } = useExportSettings();
  const {
    music, musicVolume, voiceover, ttsEngine, voice, elevenVoiceId, voiceoverSpeed, voiceoverLeadSec, voiceoverGapSec, captionScale, captionOpacity, captionLineHeight,
  } = es;
  // Transient per-render state (fine to reset on navigation).
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [modelMsg, setModelMsg] = useState("");
  const [musicLib, setMusicLib] = useState<string[]>([]);
  const [captionsOpen, setCaptionsOpen] = useState(true);
  const [voiceOpen, setVoiceOpen] = useState(true);
  const [musicOpen, setMusicOpen] = useState(true);
  const [titleOpen, setTitleOpen] = useState(true);
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

  const titleLayers = es.titleLayers ?? [
    { id: "layer-1", enabled: true, text: es.titleText || "", fontId: es.titleFontId || "outfit", fontFile: es.titleFontFile, weight: es.titleWeight || 700, sizePx: es.titleSize || 140, color: es.titleColor || "#ffffff", posX: 0, posY: -12, scope: es.titleScope || "intro", introSec: es.titleIntroSec || 3 },
    { id: "layer-2", enabled: false, text: "", fontId: "inter", fontFile: null, weight: 400, sizePx: 70, color: "#ffd400", posX: 0, posY: 5, scope: "intro", introSec: 3 },
    { id: "layer-3", enabled: false, text: "", fontId: "space-grotesk", fontFile: null, weight: 600, sizePx: 45, color: "#ffffff", posX: 0, posY: 20, scope: "intro", introSec: 3 },
  ];
  const [activeLayerIndex, setActiveLayerIndex] = useState(0);
  const projectKey = state.title || "default_project";
  const [customPresets, setCustomPresets] = useState<TitlePreset[]>(() => loadSavedPresets(projectKey));
  const [selectedPresetId, setSelectedPresetId] = useState("");

  function updateLayer(index: number, patch: Partial<TitleLayerSettings>) {
    const updated = titleLayers.map((l, i) => (i === index ? { ...l, ...patch } : l));
    update({ titleLayers: updated });
    // Also keep legacy single title fields in sync if updating layer 0
    if (index === 0) {
      if (patch.text !== undefined) update({ titleText: patch.text });
      if (patch.fontId !== undefined) update({ titleFontId: patch.fontId });
      if (patch.fontFile !== undefined) update({ titleFontFile: patch.fontFile });
      if (patch.weight !== undefined) update({ titleWeight: patch.weight });
      if (patch.sizePx !== undefined) update({ titleSize: patch.sizePx });
      if (patch.color !== undefined) update({ titleColor: patch.color });
      if (patch.scope !== undefined) update({ titleScope: patch.scope });
      if (patch.introSec !== undefined) update({ titleIntroSec: patch.introSec });
    }
  }

  function applyPreset(presetId: string) {
    setSelectedPresetId(presetId);
    const allPresets = [...BUILT_IN_PRESETS, ...customPresets];
    const target = allPresets.find((p) => p.id === presetId);
    if (!target) return;

    const newLayers = titleLayers.map((l, idx) => {
      const pl = target.layers[idx];
      if (!pl) return l;

      const gf = GOOGLE_TITLE_FONTS.find((f) => f.id === pl.fontId);
      if (gf) ensureGoogleFontLoaded(gf);

      return {
        ...l,
        enabled: pl.enabled,
        fontId: pl.fontId,
        weight: pl.weight,
        sizePx: pl.sizePx,
        letterSpacing: pl.letterSpacing ?? 0,
        arcDeg: pl.arcDeg ?? 0,
        shadow: pl.shadow !== false,
        color: pl.color,
        posX: pl.posX,
        posY: pl.posY,
        scope: pl.scope,
        introSec: pl.introSec,
        ...(pl.text ? { text: pl.text } : {}),
      };
    });

    update({
      titleLayers: newLayers,
      ...(newLayers[0]
        ? {
            titleText: newLayers[0].text,
            titleFontId: newLayers[0].fontId,
            titleWeight: newLayers[0].weight,
            titleSize: newLayers[0].sizePx,
            titleColor: newLayers[0].color,
            titleScope: newLayers[0].scope,
            titleIntroSec: newLayers[0].introSec,
          }
        : {}),
    });
  }

  function handleSavePreset() {
    const name = prompt("Enter a name for this Title Preset:", "My Title Preset");
    if (!name?.trim()) return;
    const cleanName = name.trim();
    const newP = savePreset(cleanName, titleLayers, projectKey);
    setCustomPresets(loadSavedPresets(projectKey));
    setSelectedPresetId(newP.id);
  }

  useEffect(() => {
    titleLayers.forEach((l) => {
      if (l.enabled && l.text.trim()) {
        const gf = GOOGLE_TITLE_FONTS.find((f) => f.id === l.fontId);
        if (gf) ensureGoogleFontLoaded(gf);
      }
    });
  }, [titleLayers]);

  if (!cut) return <p style={{ color: "var(--ink-3)" }}>Build a cut first.</p>;

  // Kick off the (one-time, ~80MB) Kokoro model download
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
    if (music?.name === name) { update({ music: null }); return; }
    try {
      const res = await fetch(`/api/music/file?name=${encodeURIComponent(name)}`);
      if (!res.ok) return;
      const blob = await res.blob();
      update({ music: new File([blob], name, { type: blob.type || "audio/mpeg" }) });
    } catch { /* drive not mounted */ }
  }

  async function runExport() {
    setError("");
    setVideoUrl("");
    setProgress(0);
    try {
      const fontBytes = await loadFont();
      const exportLayers: TitleLayer[] = await Promise.all(
        titleLayers.map(async (l) => {
          let fBytes: Uint8Array | undefined;
          if (l.enabled && l.text.trim()) {
            if (l.fontId === "custom") {
              if (l.fontFile) fBytes = new Uint8Array(await l.fontFile.arrayBuffer());
            } else {
              const gf = GOOGLE_TITLE_FONTS.find((f) => f.id === l.fontId);
              if (gf) fBytes = await fetchGoogleFontBytes(gf, l.weight);
              else {
                const url = l.fontId === "serif" ? "/fonts/title-serif.ttf" : "/fonts/title-sans.ttf";
                const res = await fetch(url);
                if (res.ok) fBytes = new Uint8Array(await res.arrayBuffer());
              }
            }
          }
          return {
            id: l.id,
            enabled: l.enabled,
            text: l.text,
            fontBytes: fBytes,
            sizePx: l.sizePx,
            letterSpacing: l.letterSpacing,
            arcDeg: l.arcDeg,
            shadow: l.shadow,
            color: l.color,
            posX: l.posX,
            posY: l.posY,
            scope: l.scope,
            introSec: l.introSec,
          };
        })
      );

      const title: TitleOverlay | null = exportLayers.some((l) => l.enabled && l.text.trim())
        ? { layers: exportLayers }
        : null;

      const { blob, timings } = await exportCut(
        cut!,
        clips,
        { fontBytes, music, musicVolume, voiceover, ttsEngine, voice, elevenVoiceId, voiceoverSpeed, voiceoverLeadSec, voiceoverGapSec, title, captionScale, captionBgOpacity: captionOpacity, captionLineHeight },
        setProgress,
      );
      setVideoUrl(URL.createObjectURL(blob));

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
  const fileBase = (state.title || "highlight").trim().replace(/[^\w\- ]+/g, "").replace(/\s+/g, "-") || "highlight";

  const previewLayers: PreviewTitleLayer[] = titleLayers.map((l) => {
    const fontObj = findFontById(l.fontId);
    return {
      id: l.id,
      enabled: l.enabled,
      text: l.text,
      sizePx: l.sizePx,
      letterSpacing: l.letterSpacing,
      arcDeg: l.arcDeg,
      shadow: l.shadow,
      color: l.color,
      posX: l.posX,
      posY: l.posY,
      scope: l.scope,
      introSec: l.introSec,
      fontFamily: fontObj?.cssFamily,
      fontWeight: l.weight,
    };
  });

  const previewTitle: PreviewTitle | null = previewLayers.some((l) => l.enabled && l.text.trim())
    ? { layers: previewLayers }
    : null;

  return (
    <section style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "var(--panel)", overflow: "hidden" }}>
      {/* Top Action Bar */}
      <div style={{ padding: "12px 24px", borderBottom: "1px solid var(--line)", background: "var(--panel-2)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span className="st-chip">{cut.beats.length} beat{cut.beats.length === 1 ? "" : "s"}</span>
          <span className="st-chip st-num">{cutDuration(cut).toFixed(1)}s</span>
          <span className="st-chip">{cut.aspect}</span>
          <span className="st-chip">1080p</span>
          <span className="st-chip">Burned-in captions</span>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="st-btn ghost" style={{ padding: "8px 14px", fontSize: 12 }} onClick={() => download(`${fileBase}-script.txt`, buildScriptText(cut))}>
            Script (.txt)
          </button>
          <button className="st-btn ghost" style={{ padding: "8px 14px", fontSize: 12 }} onClick={() => download(`${fileBase}.srt`, buildSrt(cut))}>
            Captions (.srt)
          </button>
          <button className="st-btn primary" style={{ padding: "8px 20px", fontSize: 13, minWidth: 140, justifyContent: "center" }} onClick={runExport} disabled={busy}>
            {busy ? "Exporting…" : "Export video"}
          </button>
        </div>
      </div>

      {busy && (
        <div style={{ padding: "8px 24px", background: "var(--panel-3)", borderBottom: "1px solid var(--line)", display: "flex", gap: 12, alignItems: "center" }}>
          <progress max={100} value={(progress ?? 0) * 100} style={{ flex: 1, accentColor: "var(--accent)" }} />
          <span style={{ fontSize: 12, width: 44, color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>{Math.round((progress ?? 0) * 100)}%</span>
        </div>
      )}

      {error && <p style={{ color: "var(--danger)", background: "rgba(229,105,95,0.1)", borderBottom: "1px solid rgba(229,105,95,0.25)", padding: "8px 24px", fontSize: 12, margin: 0 }}>{error}</p>}

      {/* Main 3-Column Split Area */}
      <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "1fr 420px 400px", gap: 0 }}>
        {/* LEFT COLUMN: Large Video Preview Theater */}
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", background: "#08090b", padding: 24, borderRight: "1px solid var(--line)", position: "relative" }}>
          <div style={{ width: "100%", maxWidth: 840, height: "100%", maxHeight: "calc(100vh - 180px)", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center" }}>
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

          {videoUrl && (
            <div style={{ position: "absolute", bottom: 16, left: 24, right: 24, padding: 12, background: "var(--panel-2)", borderRadius: 10, border: "1px solid var(--line)", display: "flex", gap: 16, alignItems: "center" }}>
              <video src={videoUrl} controls style={{ height: 60, borderRadius: 6, background: "#000", border: "1px solid var(--line)", objectFit: "contain" }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--good)" }}>Export Ready ✓</div>
                <div style={{ fontSize: 11, color: "var(--ink-2)" }}>{fileBase}.mp4</div>
              </div>
              <a className="st-btn primary" style={{ textDecoration: "none", padding: "8px 16px" }} href={videoUrl} download={`${fileBase}.mp4`}>Download MP4 ⬇</a>
            </div>
          )}
        </div>

        {/* MIDDLE COLUMN: Text & Captions Panel (Side-by-Side Panel 1) */}
        <div style={{ overflowY: "auto", padding: 18, display: "flex", flexDirection: "column", gap: 14, background: "var(--panel)", borderRight: "1px solid var(--line)" }}>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--accent)", borderBottom: "1px solid var(--line)", paddingBottom: 8, flexShrink: 0 }}>
            🔤 Text & Captions Panel
          </div>

          {/* Title Overlay Card (3 Stacked Layers) */}
          <div className="st-field">
            <div
              onClick={() => setTitleOpen(!titleOpen)}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", userSelect: "none", marginBottom: 6 }}
            >
              <label style={{ cursor: "pointer", margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
                Title Overlay (3 Stacked Layers)
              </label>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                style={{
                  transform: titleOpen ? "rotate(180deg)" : "rotate(0deg)",
                  transition: "transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
                  color: "var(--ink-3)",
                }}
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </div>

            <div className={`st-color-collapsible ${titleOpen ? "open" : ""}`}>
              <div className="st-color-collapsible-inner">
                <div style={{ display: "flex", flexDirection: "column", gap: 12, background: "var(--panel-2)", padding: "12px", borderRadius: 8, border: "1px solid var(--line)" }}>
                  {/* Preset Selector Toolbar */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--panel-3)", padding: "7px 10px", borderRadius: 6, border: "1px solid var(--line)" }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-2)", whiteSpace: "nowrap" }}>Preset:</span>
                    <select
                      value={selectedPresetId}
                      onChange={(e) => applyPreset(e.target.value)}
                      style={{ flex: 1, background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: 5, color: "var(--ink)", fontSize: 11, padding: "5px 8px", outline: "none", cursor: "pointer" }}
                    >
                      <option value="">Select a Preset...</option>
                      <optgroup label="Built-in Presets">
                        {BUILT_IN_PRESETS.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </optgroup>
                      {customPresets.length > 0 && (
                        <optgroup label="Project Saved Presets">
                          {customPresets.map((p) => (
                            <option key={p.id} value={p.id}>⭐ {p.name}</option>
                          ))}
                        </optgroup>
                      )}
                    </select>

                    <button
                      type="button"
                      onClick={handleSavePreset}
                      style={{ padding: "5px 10px", fontSize: 11, fontWeight: 600, borderRadius: 5, background: "var(--panel-2)", border: "1px solid var(--line)", color: "var(--ink)", cursor: "pointer", whiteSpace: "nowrap" }}
                      title="Save current title layout into this project's preset list"
                    >
                      💾 Save Preset
                    </button>
                  </div>

                  {/* Layer Tabs */}
                  <div style={{ display: "flex", gap: 6, borderBottom: "1px solid var(--line)", paddingBottom: 8 }}>
                    {titleLayers.map((layer, idx) => (
                      <button
                        key={layer.id}
                        type="button"
                        onClick={() => setActiveLayerIndex(idx)}
                        style={{
                          flex: 1,
                          padding: "6px 10px",
                          borderRadius: 6,
                          fontSize: 11,
                          fontWeight: 600,
                          border: activeLayerIndex === idx ? "1px solid var(--accent)" : "1px solid var(--line)",
                          background: activeLayerIndex === idx ? "rgba(255, 179, 57, 0.15)" : "var(--panel-3)",
                          color: activeLayerIndex === idx ? "var(--accent)" : "var(--ink-2)",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 6,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={layer.enabled}
                          onChange={(e) => updateLayer(idx, { enabled: e.target.checked })}
                          onClick={(e) => e.stopPropagation()}
                          style={{ accentColor: "var(--accent)", cursor: "pointer" }}
                          title="Enable/disable this title layer"
                        />
                        Layer {idx + 1} {idx === 0 ? "(Main)" : idx === 1 ? "(Sub)" : "(Tag)"}
                      </button>
                    ))}
                  </div>

                  {/* Active Layer Editor */}
                  {(() => {
                    const curLayer = titleLayers[activeLayerIndex] ?? titleLayers[0];
                    return (
                      <div style={{ display: "flex", flexDirection: "column", gap: 10, opacity: curLayer.enabled ? 1 : 0.55 }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <input
                            value={curLayer.text}
                            onChange={(e) => updateLayer(activeLayerIndex, { text: e.target.value })}
                            placeholder={activeLayerIndex === 0 ? "e.g. SUMMER VIBES 2026" : activeLayerIndex === 1 ? "e.g. Official Highlight Reel" : "e.g. Presented by VIDSTR"}
                            style={{ flex: 1, padding: "7px 10px", fontSize: 12, background: "var(--panel-3)", border: "1px solid var(--line)", borderRadius: 7, color: "var(--ink)", outline: "none" }}
                          />
                          {!curLayer.enabled && <span style={{ fontSize: 10, color: "var(--danger)", whiteSpace: "nowrap" }}>(Layer Disabled)</span>}
                        </div>

                        {curLayer.text.trim() && (
                          <>
                            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", fontSize: 12 }}>
                              <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                Font
                                <select value={curLayer.fontId} onChange={(e) => updateLayer(activeLayerIndex, { fontId: e.target.value })} style={{ background: "var(--panel-3)", border: "1px solid var(--line)", borderRadius: 6, color: "var(--ink)", fontSize: 12, padding: "4px 8px", outline: "none" }}>
                                  <optgroup label="Google Fonts">
                                    {GOOGLE_TITLE_FONTS.map((f) => (
                                      <option key={f.id} value={f.id}>{f.name}</option>
                                    ))}
                                  </optgroup>
                                  <optgroup label="System Fonts">
                                    {SYSTEM_TITLE_FONTS.map((f) => (
                                      <option key={f.id} value={f.id}>{f.name}</option>
                                    ))}
                                  </optgroup>
                                  <option value="custom">Custom upload…</option>
                                </select>
                              </label>

                              <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                Weight
                                <select
                                  value={curLayer.weight}
                                  onChange={(e) => updateLayer(activeLayerIndex, { weight: Number(e.target.value) })}
                                  style={{ background: "var(--panel-3)", border: "1px solid var(--line)", borderRadius: 6, color: "var(--ink)", fontSize: 12, padding: "4px 8px", outline: "none" }}
                                >
                                  <option value={300}>Light (300)</option>
                                  <option value={400}>Normal (400)</option>
                                  <option value={600}>Semi-Bold (600)</option>
                                  <option value={700}>Bold (700)</option>
                                  <option value={800}>Extra Bold (800)</option>
                                </select>
                              </label>

                              {curLayer.fontId === "custom" && (
                                <input type="file" accept=".ttf,.otf,font/ttf,font/otf" onChange={(e) => updateLayer(activeLayerIndex, { fontFile: e.target.files?.[0] ?? null })} style={{ fontSize: 11 }} />
                              )}

                              <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                Size
                                <input type="number" min={16} max={300} step={2} value={curLayer.sizePx} onChange={(e) => updateLayer(activeLayerIndex, { sizePx: Number(e.target.value) })} style={{ width: 56, background: "var(--panel-3)", border: "1px solid var(--line)", borderRadius: 6, color: "var(--ink)", padding: "4px 6px", fontSize: 12, textAlign: "right", outline: "none" }} /> px
                              </label>

                              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                Color
                                {TITLE_SWATCHES.map((s) => (
                                  <button
                                    key={s.value}
                                    type="button"
                                    onClick={() => updateLayer(activeLayerIndex, { color: s.value })}
                                    title={s.label}
                                    style={{
                                      width: 18,
                                      height: 18,
                                      borderRadius: 4,
                                      background: s.value,
                                      border: curLayer.color.toLowerCase() === s.value ? "2px solid var(--accent)" : "1px solid var(--line)",
                                      cursor: "pointer",
                                      padding: 0,
                                    }}
                                  />
                                ))}
                                <input type="color" value={curLayer.color} onChange={(e) => updateLayer(activeLayerIndex, { color: e.target.value })} title="Custom color" style={{ width: 24, height: 22, border: "none", background: "none", cursor: "pointer" }} />
                              </span>

                              <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                                <input
                                  type="checkbox"
                                  checked={curLayer.shadow !== false}
                                  onChange={(e) => updateLayer(activeLayerIndex, { shadow: e.target.checked })}
                                  style={{ accentColor: "var(--accent)", cursor: "pointer" }}
                                />
                                Drop shadow
                              </label>

                              <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                Show
                                <select value={curLayer.scope} onChange={(e) => updateLayer(activeLayerIndex, { scope: e.target.value as "intro" | "entire" })} style={{ background: "var(--panel-3)", border: "1px solid var(--line)", borderRadius: 6, color: "var(--ink)", fontSize: 12, padding: "4px 8px", outline: "none" }}>
                                  <option value="intro">Intro (fade out)</option>
                                  <option value="entire">Entire video</option>
                                </select>
                              </label>

                              {curLayer.scope === "intro" && (
                                <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                  Duration
                                  <select value={curLayer.introSec} onChange={(e) => updateLayer(activeLayerIndex, { introSec: Number(e.target.value) })} style={{ background: "var(--panel-3)", border: "1px solid var(--line)", borderRadius: 6, color: "var(--ink)", fontSize: 12, padding: "4px 8px", outline: "none" }}>
                                    <option value={2}>2s</option>
                                    <option value={3}>3s</option>
                                    <option value={4}>4s</option>
                                    <option value={5}>5s</option>
                                  </select>
                                </label>
                              )}
                            </div>

                            {/* Position & Spacing Sliders Card (Left/Right, Up/Down, Letter Spacing) */}
                            <div className="st-color-adjustments" style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4, padding: "8px 10px", background: "var(--panel-3)", borderRadius: 6, border: "1px solid var(--line)" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ fontSize: 11, width: 130, color: "var(--ink-2)" }}>Position X (Left / Right)</span>
                                <input
                                  type="range"
                                  min={-50}
                                  max={50}
                                  step={1}
                                  value={curLayer.posX}
                                  onChange={(e) => updateLayer(activeLayerIndex, { posX: Number(e.target.value) })}
                                  onDoubleClick={() => updateLayer(activeLayerIndex, { posX: 0 })}
                                  style={sliderTrackStyle(curLayer.posX, -50, 50)}
                                  title="Double-click to center horizontally"
                                />
                                <span style={{ fontSize: 10, width: 34, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
                                  {curLayer.posX > 0 ? `+${curLayer.posX}%` : `${curLayer.posX}%`}
                                </span>
                              </div>

                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ fontSize: 11, width: 130, color: "var(--ink-2)" }}>Position Y (Up / Down)</span>
                                <input
                                  type="range"
                                  min={-50}
                                  max={50}
                                  step={1}
                                  value={curLayer.posY}
                                  onChange={(e) => updateLayer(activeLayerIndex, { posY: Number(e.target.value) })}
                                  onDoubleClick={() => updateLayer(activeLayerIndex, { posY: 0 })}
                                  style={sliderTrackStyle(curLayer.posY, -50, 50)}
                                  title="Double-click to center vertically"
                                />
                                <span style={{ fontSize: 10, width: 34, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
                                  {curLayer.posY > 0 ? `+${curLayer.posY}%` : `${curLayer.posY}%`}
                                </span>
                              </div>

                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ fontSize: 11, width: 130, color: "var(--ink-2)" }}>Letter Spacing</span>
                                <input
                                  type="range"
                                  min={-10}
                                  max={60}
                                  step={1}
                                  value={curLayer.letterSpacing ?? 0}
                                  onChange={(e) => updateLayer(activeLayerIndex, { letterSpacing: Number(e.target.value) })}
                                  onDoubleClick={() => updateLayer(activeLayerIndex, { letterSpacing: 0 })}
                                  style={sliderTrackStyle(curLayer.letterSpacing ?? 0, -10, 60)}
                                  title="Double-click to reset spacing to 0"
                                />
                                <span style={{ fontSize: 10, width: 34, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
                                  {curLayer.letterSpacing ?? 0}px
                                </span>
                              </div>

                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ fontSize: 11, width: 130, color: "var(--ink-2)" }}>Text Curve / Arc</span>
                                <input
                                  type="range"
                                  min={-180}
                                  max={180}
                                  step={1}
                                  value={curLayer.arcDeg ?? 0}
                                  onChange={(e) => updateLayer(activeLayerIndex, { arcDeg: Number(e.target.value) })}
                                  onDoubleClick={() => updateLayer(activeLayerIndex, { arcDeg: 0 })}
                                  style={sliderTrackStyle(curLayer.arcDeg ?? 0, -180, 180)}
                                  title="Double-click to reset text curve to 0°"
                                />
                                <span style={{ fontSize: 10, width: 34, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
                                  {(curLayer.arcDeg ?? 0) > 0 ? `+${curLayer.arcDeg}°` : `${curLayer.arcDeg ?? 0}°`}
                                </span>
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>
          </div>

          {/* Captions Styling Card */}
          <div className="st-field">
            <div
              onClick={() => setCaptionsOpen(!captionsOpen)}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", userSelect: "none", marginBottom: 6 }}
            >
              <label style={{ cursor: "pointer", margin: 0 }}>Captions Styling</label>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                style={{
                  transform: captionsOpen ? "rotate(180deg)" : "rotate(0deg)",
                  transition: "transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
                  color: "var(--ink-3)",
                }}
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </div>

            <div className={`st-color-collapsible ${captionsOpen ? "open" : ""}`}>
              <div className="st-color-collapsible-inner">
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
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Audio & Narration Panel (Side-by-Side Panel 2) */}
        <div style={{ overflowY: "auto", padding: 18, display: "flex", flexDirection: "column", gap: 14, background: "var(--panel)" }}>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--accent)", borderBottom: "1px solid var(--line)", paddingBottom: 8, flexShrink: 0 }}>
            🎵 Audio & Narration Panel
          </div>

          {/* Music Bed Card */}
          <div className="st-field">
            <div
              onClick={() => setMusicOpen(!musicOpen)}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", userSelect: "none", marginBottom: 6 }}
            >
              <label style={{ cursor: "pointer", margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
                Music Bed {music ? <span className="st-chip" style={{ fontSize: 10, padding: "2px 6px" }}>Loaded</span> : <span style={{ opacity: 0.6, fontSize: 11, fontWeight: 400 }}>(Optional)</span>}
              </label>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                style={{
                  transform: musicOpen ? "rotate(180deg)" : "rotate(0deg)",
                  transition: "transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
                  color: "var(--ink-3)",
                }}
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </div>

            <div className={`st-color-collapsible ${musicOpen ? "open" : ""}`}>
              <div className="st-color-collapsible-inner">
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
            </div>
          </div>

          {/* AI Voiceover Card */}
          <div className="st-field">
            <div
              onClick={() => setVoiceOpen(!voiceOpen)}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", userSelect: "none", marginBottom: 6 }}
            >
              <label style={{ margin: 0, display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--ink-3)", fontWeight: 600 }}>
                <input type="checkbox" checked={voiceover} onChange={(e) => toggleVoiceover(e.target.checked)} onClick={(e) => e.stopPropagation()} style={{ accentColor: "var(--accent)", cursor: "pointer" }} />
                Voiceover (AI Narration)
              </label>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                style={{
                  transform: voiceOpen ? "rotate(180deg)" : "rotate(0deg)",
                  transition: "transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
                  color: "var(--ink-3)",
                }}
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </div>

            <div className={`st-color-collapsible ${voiceOpen ? "open" : ""}`}>
              <div className="st-color-collapsible-inner">
                {voiceover && (
                  <div className="st-color-adjustments" style={{ display: "flex", flexDirection: "column", gap: 10, background: "var(--panel-2)", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 11, width: 110, color: "var(--ink-2)" }}>Engine</span>
                      <select value={ttsEngine} onChange={(e) => changeEngine(e.target.value as TtsEngine)} style={{ flex: 1, background: "var(--panel-3)", border: "1px solid var(--line)", borderRadius: 6, color: "var(--ink)", fontSize: 11, padding: "3px 7px", outline: "none" }}>
                        <option value="kokoro">Kokoro (in-browser, free)</option>
                        <option value="elevenlabs">ElevenLabs (higher quality)</option>
                      </select>
                    </div>

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
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
