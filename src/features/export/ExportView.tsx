import { useEffect, useRef, useState } from "react";
import { useProject } from "../../state/ProjectContext";
import { useExportSettings, type TitleLayerSettings } from "../../state/ExportSettingsContext";
import { cutDuration } from "../assemble/assemble";
import { exportCut, emptyTemplateSlotExportError, buildScriptText, buildSrt, type TitleOverlay, type TitleLayer } from "./export";
import { loadVoiceModel, VOICES, type Voice } from "../../lib/kokoroTts";
import { ELEVEN_VOICES, ELEVEN_MODELS, fetchElevenVoices, type ElevenVoice } from "../../lib/elevenLabs";
import type { TtsEngine } from "../../lib/tts";
import FinalPreview, { type PreviewTitle, type PreviewTitleLayer } from "./FinalPreview";
import { musicTrackGain } from "../music-track/musicTrack";
import { ensureFontLoadedById, findFontById } from "../../lib/googleFonts";
import { getTitleFontBytes } from "./titleFonts";
import TitleTreatmentEditor from "./TitleTreatmentEditor";
import { USER_VOICE_EFFECT_OPTIONS, USER_VOICE_EQ_MAX_DB, USER_VOICE_EQ_MIN_DB } from "../../studio/userVoiceEq";
import FontPicker from "../../studio/FontPicker";
import { BUILT_IN_PRESETS, loadSavedPresets, savePreset, type TitlePreset } from "../../lib/titlePresets";
import {
  loadVoPresets, saveVoPreset, updateVoPreset, deleteVoPreset, getDefaultPresetId, setDefaultPresetId,
  type VoPreset, type VoSettings,
} from "../../lib/voPresets";

import { EDITOR_DEFAULTS } from "../../config/editorDefaults";
import ChevronDownIcon from "../../design-system/icons/ChevronDownIcon";
import PauseIcon from "../../design-system/icons/PauseIcon";
import PlayIcon from "../../design-system/icons/PlayIcon";
import SaveIcon from "../../design-system/icons/SaveIcon";
import { publishReadiness, type PublishTarget } from "./publishReadiness";

function download(name: string, blobOrText: Blob | string, type = "text/plain") {
  const blob = typeof blobOrText === "string" ? new Blob([blobOrText], { type }) : blobOrText;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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

function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function ExportView({ active = true, onClose }: { active?: boolean; onClose?: () => void }) {
  const { state, dispatch } = useProject();
  const cut = state.cut;
  const clips = state.clips;
  const { settings: es, update } = useExportSettings();
  const [voPresets, setVoPresets] = useState<VoPreset[]>(() => loadVoPresets());
  const [selectedVoPresetId, setSelectedVoPresetId] = useState<string>(() => getDefaultPresetId() ?? "");
  const [defaultVoPresetId, setDefaultVoPresetId] = useState<string>(() => getDefaultPresetId() ?? "");
  // Snapshot of the VO settings "before modification" — updated whenever a clean
  // state is established (preset applied/saved). "Revert changes" restores it.
  const [voBaseline, setVoBaseline] = useState<VoSettings>(() => ({
    voiceover: es.voiceover, ttsEngine: es.ttsEngine, voice: es.voice, elevenVoiceId: es.elevenVoiceId,
    elevenModel: es.elevenModel, elevenStability: es.elevenStability, elevenStyle: es.elevenStyle,
    voiceoverVolume: es.voiceoverVolume, voiceoverSpeed: es.voiceoverSpeed, voiceoverLeadSec: es.voiceoverLeadSec, voiceoverGapSec: es.voiceoverGapSec,
  }));
  // Two-step confirm before overwriting the selected preset with the current settings.
  const [confirmSaveMod, setConfirmSaveMod] = useState(false);
  const {
    exportQuality, exportResolution, exportFps, exportFormat, music, musicVolume, voiceover, ttsEngine, voice, elevenVoiceId, elevenModel, elevenStability, elevenStyle, voiceoverVolume, voiceoverSpeed, voiceoverBassDb, voiceoverTrebleDb, voiceoverEffect, voiceoverLeadSec, voiceoverGapSec, captionScale, captionOpacity, captionLineHeight, captionFontId,
  } = es;
  const activeMusic = state.musicTrack?.file ?? music;
  const activeMusicVolume = state.musicTrack ? musicTrackGain(state.musicTrack) : musicVolume;

  // Transient per-render state (fine to reset on navigation).
  const [progress, setProgress] = useState<number | null>(null);
  const [statusText, setStatusText] = useState<string>("");
  const [elapsedSec, setElapsedSec] = useState<number>(0);
  const [lastExportSec, setLastExportSec] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  const [renderedDelivery, setRenderedDelivery] = useState<{ resolution: "720p" | "1080p"; fps: 24 | 30 | 60; format: "mp4" | "webm" } | null>(null);
  const [publishTarget, setPublishTarget] = useState<PublishTarget>("Instagram Reels");
  const exportAbortRef = useRef<AbortController | null>(null);
  const [modelMsg, setModelMsg] = useState("");
  const [musicLib, setMusicLib] = useState<string[]>([]);
  const [elevenVoices, setElevenVoices] = useState<ElevenVoice[]>(ELEVEN_VOICES);
  const [captionsOpen, setCaptionsOpen] = useState(true);
  const [voiceOpen, setVoiceOpen] = useState(true);
  const [musicOpen, setMusicOpen] = useState(true);
  const [titleOpen, setTitleOpen] = useState(true);
  const [playingName, setPlayingName] = useState("");
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (progress === null) {
      setElapsedSec(0);
      return;
    }
    const startTime = Date.now();
    setElapsedSec(0);
    const timer = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [progress !== null]);

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

  // Load the full ElevenLabs voice library from the account (falls back to the
  // built-in list on error). Runs once; the proxy keeps the API key server-side.
  useEffect(() => {
    let cancelled = false;
    fetchElevenVoices().then((vs) => { if (!cancelled) setElevenVoices(vs); });
    return () => { cancelled = true; };
  }, []);

  const titleLayers = es.titleLayers ?? [
    { id: "layer-1", enabled: true, text: es.titleText || "", fontId: es.titleFontId || "outfit", fontFile: es.titleFontFile, weight: es.titleWeight || 700, sizePx: es.titleSize || 140, color: es.titleColor || "#ffffff", posX: 0, posY: -12, scope: es.titleScope || "intro", introSec: es.titleIntroSec || 3 },
    { id: "layer-2", enabled: false, text: "", fontId: "inter", fontFile: null, weight: 400, sizePx: 70, color: "#ffd400", posX: 0, posY: 5, scope: "intro", introSec: 3 },
    { id: "layer-3", enabled: false, text: "", fontId: "space-grotesk", fontFile: null, weight: 600, sizePx: 45, color: "#ffffff", posX: 0, posY: 20, scope: "intro", introSec: 3 },
  ];
  const projectKey = state.title || "default_project";
  const [customPresets, setCustomPresets] = useState<TitlePreset[]>(() => loadSavedPresets(projectKey));
  const [selectedPresetId, setSelectedPresetId] = useState("");

  // Persist the edited layer stack and mirror layer 0 into the legacy single-title
  // fields (kept for backward-compatible export fallback).
  function handleLayersChange(next: TitleLayerSettings[]) {
    const l0 = next[0];
    update({
      titleLayers: next,
      ...(l0
        ? {
            titleText: l0.text,
            titleFontId: l0.fontId,
            titleFontFile: l0.fontFile,
            titleWeight: l0.weight,
            titleSize: l0.sizePx,
            titleColor: l0.color,
            titleScope: l0.scope,
            titleIntroSec: l0.introSec,
          }
        : {}),
    });
  }

  function applyPreset(presetId: string) {
    setSelectedPresetId(presetId);
    const allPresets = [...BUILT_IN_PRESETS, ...customPresets];
    const target = allPresets.find((p) => p.id === presetId);
    if (!target) return;

    const newLayers = titleLayers.map((l, idx) => {
      const pl = target.layers[idx];
      if (!pl) return l;

      ensureFontLoadedById(pl.fontId);

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
        startSec: pl.startSec,
        durationSec: pl.durationSec,
        fadeOut: pl.fadeOut,
        maskMode: pl.maskMode,
        maskColor: pl.maskColor,
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

  // ── Voiceover presets ──────────────────────────────────────────────
  /** The current VO fields as a saveable preset payload. */
  function currentVoSettings(): VoSettings {
    return {
      voiceover: es.voiceover, ttsEngine: es.ttsEngine, voice: es.voice, elevenVoiceId: es.elevenVoiceId,
      elevenModel: es.elevenModel, elevenStability: es.elevenStability, elevenStyle: es.elevenStyle,
      voiceoverVolume: es.voiceoverVolume, voiceoverSpeed: es.voiceoverSpeed, voiceoverLeadSec: es.voiceoverLeadSec, voiceoverGapSec: es.voiceoverGapSec,
    };
  }


  function applyVoPreset(id: string) {
    const preset = voPresets.find((p) => p.id === id);
    if (!preset) return;
    update(preset.settings);
    setVoBaseline(preset.settings); // fresh clean baseline
    setSelectedVoPresetId(preset.id);
    setConfirmSaveMod(false);
  }

  /** Discard modifications — restore the VO settings to before you started tweaking. */
  function revertVoChanges() {
    update(voBaseline);
    setConfirmSaveMod(false);
  }

  /** Overwrite the selected preset with the current settings (after Confirm). */
  function saveModifiedPreset() {
    if (!selectedVoPreset) return;
    const snapshot = currentVoSettings();
    updateVoPreset(selectedVoPreset.id, snapshot);
    setVoBaseline(snapshot);
    setVoPresets(loadVoPresets());
    setConfirmSaveMod(false);
  }

  /** Toggle whether the selected preset auto-loads in new sessions / after Start over. */
  function toggleVoDefault() {
    if (!selectedVoPresetId) return;
    const next = defaultVoPresetId === selectedVoPresetId ? null : selectedVoPresetId;
    setDefaultPresetId(next);
    setDefaultVoPresetId(next ?? "");
  }

  function handleSaveVoPreset() {
    const name = prompt("Name this voiceover preset:", "My VO preset");
    if (!name?.trim()) return;
    const snapshot = currentVoSettings();
    const preset = saveVoPreset(name, snapshot);
    setVoBaseline(snapshot); // saving establishes a clean baseline
    setVoPresets(loadVoPresets());
    setSelectedVoPresetId(preset.id);
    setConfirmSaveMod(false);
  }

  function handleDeleteVoPreset() {
    if (!selectedVoPresetId) return;
    deleteVoPreset(selectedVoPresetId);
    setVoPresets(loadVoPresets());
    if (defaultVoPresetId === selectedVoPresetId) setDefaultVoPresetId("");
    setSelectedVoPresetId(getDefaultPresetId() ?? "");
    setConfirmSaveMod(false);
  }

  // Selected preset + whether the current VO settings have drifted from the baseline.
  const selectedVoPreset = voPresets.find((p) => p.id === selectedVoPresetId);
  const voModified = JSON.stringify(currentVoSettings()) !== JSON.stringify(voBaseline);

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

    const preflightError = cut ? emptyTemplateSlotExportError(cut, clips) : "Add clips to the timeline before exporting.";
    if (preflightError) {
      setError(preflightError);
      return;
    }

    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoUrl("");
    setVideoBlob(null);
    setRenderedDelivery(null);
    setProgress(0);
    setStatusText("Initializing export…");
    setLastExportSec(null);
    const exportStart = Date.now();
    const controller = new AbortController();
    exportAbortRef.current = controller;
    try {
      // Convert a UI title layer into an export-ready layer, loading the SAME
      // cached font bytes the preview uses (identical registered FontFace → pixel
      // parity). Shared by the cut-level title and every beat's own title.
      const toExportLayer = async (l: TitleLayerSettings): Promise<TitleLayer> => {
        const fBytes = (l.enabled && l.text.trim())
          ? await getTitleFontBytes(l.fontId, l.weight, l.fontFile)
          : undefined;
        const fontObj = findFontById(l.fontId);
        return {
          id: l.id,
          enabled: l.enabled,
          text: l.text,
          fontBytes: fBytes,
          fontCssFamily: fontObj?.cssFamily,
          weight: l.weight,
          sizePx: l.sizePx,
          letterSpacing: l.letterSpacing,
          arcDeg: l.arcDeg,
          shadow: l.shadow,
          color: l.color,
          posX: l.posX,
          posY: l.posY,
          scope: l.scope,
          introSec: l.introSec,
          startSec: l.startSec,
          durationSec: l.durationSec,
          fadeOut: l.fadeOut,
          animation: l.animation,
          animDurationSec: l.animDurationSec,
          boxWidthPct: l.boxWidthPct,
          lineHeight: l.lineHeight,
          typewriterCursor: l.typewriterCursor,
          maskMode: l.maskMode,
          maskColor: l.maskColor,
        };

      };

      const exportLayers: TitleLayer[] = await Promise.all(titleLayers.map(toExportLayer));

      const title: TitleOverlay | null = exportLayers.some((l) => l.enabled && l.text.trim())
        ? { layers: exportLayers }
        : null;

      // Per-beat titles: only beats that actually have enabled, non-empty layers.
      const beatTitles: Record<string, TitleLayer[]> = {};
      for (const bt of cut!.beats) {
        const active = (bt.titleLayers ?? []).filter((l) => l.enabled && l.text.trim());
        if (active.length) beatTitles[bt.id] = await Promise.all(active.map(toExportLayer));
      }

      const { blob, timings } = await exportCut(
        cut!,
        clips,
        { exportQuality, exportResolution, exportFps, exportFormat, signal: controller.signal, music: activeMusic, musicVolume: activeMusicVolume, voiceover, ttsEngine, voice, elevenVoiceId, elevenModel, elevenStability, elevenStyle, voiceoverVolume, voiceoverSpeed, voiceoverBassDb, voiceoverTrebleDb, voiceoverEffect, voiceoverLeadSec, voiceoverGapSec, title, beatTitles, captionScale, captionBgOpacity: captionOpacity, captionLineHeight, captionFontId },

        (p, status) => {
          setProgress(p);
          if (status) setStatusText(status);
        },
      );
      const totalSec = Math.max(1, Math.round((Date.now() - exportStart) / 1000));
      setLastExportSec(totalSec);
      setVideoBlob(blob);
      setRenderedDelivery({ resolution: exportResolution, fps: exportFps, format: exportFormat });
      setVideoUrl(URL.createObjectURL(blob));


      if (voiceover) {
        const byId = new Map(cut!.beats.map((b) => [b.id, b]));
        for (const t of timings) {
          const beat = byId.get(t.id);
          if (beat) dispatch({ type: "UPDATE_BEAT", beat: { ...beat, inSec: t.inSec, outSec: t.outSec, durationSec: t.durationSec } });
        }
      }
    } catch (e) {
      if (controller.signal.aborted) setStatusText("Export cancelled");
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      exportAbortRef.current = null;
      setProgress(null);
    }
  }

  async function shareExport() {
    if (!videoBlob) return;
    const format = renderedDelivery?.format ?? exportFormat;
    const mime = format === "webm" ? "video/webm" : "video/mp4";
    const file = new File([videoBlob], `${fileBase}.${format}`, { type: mime });
    if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
      await navigator.share({ title: state.title || "My video", files: [file] });
      return;
    }
    download(file.name, videoBlob);
  }

  const busy = progress !== null;
  const fileBase = (state.title || "highlight").trim().replace(/[^\w\- ]+/g, "").replace(/\s+/g, "-") || "highlight";
  const publishChecks = publishReadiness({
    target: publishTarget,
    aspect: cut.aspect,
    durationSec: cutDuration(cut),
    hasCaptions: (cut.voSegments ?? []).some((segment) => segment.captionVisible !== false && segment.text.trim())
      || (cut.userVoiceSegments ?? []).some((segment) => segment.captionVisible !== false && segment.transcript?.trim()),
    hasAudio: Boolean(activeMusic || voiceover || (cut.userVoiceSegments ?? []).length),
  });

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
      startSec: l.startSec,
      durationSec: l.durationSec,
      fadeOut: l.fadeOut,
      fontFamily: fontObj?.cssFamily,
      fontWeight: l.weight,
      fontId: l.fontId,
      fontFile: l.fontFile,
      animation: l.animation,
      animDurationSec: l.animDurationSec,
      boxWidthPct: l.boxWidthPct,
      lineHeight: l.lineHeight,
      typewriterCursor: l.typewriterCursor,
      maskMode: l.maskMode,
      maskColor: l.maskColor,
    };

  });

  const previewTitle: PreviewTitle | null = previewLayers.some((l) => l.enabled && l.text.trim())
    ? { layers: previewLayers }
    : null;

  return (
    <section className="st-export-view" style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "var(--panel)", overflow: "hidden" }}>
      {/* Top Action Bar */}
      <div className="st-export-toolbar" style={{ padding: "12px 24px", borderBottom: "1px solid var(--line)", background: "var(--panel-2)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span className="st-chip">{cut.beats.length} beat{cut.beats.length === 1 ? "" : "s"}</span>
          <span className="st-chip st-num">{cutDuration(cut).toFixed(1)}s</span>
          <span className="st-chip">{cut.aspect}</span>
          <span className="st-chip">{exportResolution} · {exportFps} fps · {exportFormat.toUpperCase()}</span>
          <span className="st-chip">Burned-in captions</span>

          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--ink-2)", marginLeft: 6 }}>
            <span>Quality:</span>
            <select
              value={exportQuality}
              onChange={(e) => update({ exportQuality: e.target.value as any })}
              style={{
                background: "var(--panel-3)",
                border: "1px solid var(--line)",
                borderRadius: 6,
                color: "var(--accent)",
                fontWeight: 600,
                fontSize: 12,
                padding: "3px 8px",
                outline: "none",
                cursor: "pointer",
              }}
              title="Lower CRF = Higher Visual Quality (CRF 15 is Maximum Quality)"
            >
              {(Object.entries(EDITOR_DEFAULTS.EXPORT_QUALITY_PROFILES) as [keyof typeof EDITOR_DEFAULTS.EXPORT_QUALITY_PROFILES, any][]).map(([key, profile]) => (
                <option key={key} value={key}>
                  {profile.label}
                </option>
              ))}
            </select>
            <span
              style={{ fontSize: 11, color: "var(--ink-3)", opacity: 0.9, letterSpacing: "-0.01em" }}
              title="Lower CRF values yield higher visual quality. CRF 15 (Maximum) produces near-lossless detail."
            >
              (Lower CRF = Higher Quality)
            </span>
          </label>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--ink-2)" }}>
            Size
            <select value={exportResolution} onChange={(event) => update({ exportResolution: event.target.value as "720p" | "1080p" })}>
              <option value="720p">720p (faster)</option><option value="1080p">1080p</option>
            </select>
          </label>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--ink-2)" }}>
            Format
            <select value={exportFormat} onChange={(event) => update({ exportFormat: event.target.value as "mp4" | "webm" })}>
              <option value="mp4">MP4 (recommended)</option><option value="webm">WebM</option>
            </select>
          </label>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--ink-2)" }}>
            FPS
            <select value={exportFps} onChange={(event) => update({ exportFps: Number(event.target.value) as 24 | 30 | 60 })}>
              <option value={24}>24</option><option value={30}>30</option><option value={60}>60</option>
            </select>
          </label>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="st-btn ghost" style={{ padding: "8px 14px", fontSize: 12 }} onClick={() => download(`${fileBase}-script.txt`, buildScriptText(cut))}>
            Script (.txt)
          </button>
          <button className="st-btn ghost" style={{ padding: "8px 14px", fontSize: 12 }} onClick={() => download(`${fileBase}.srt`, buildSrt(cut))}>
            Captions (.srt)
          </button>
          {videoUrl && (
            <button className="st-btn ghost" style={{ padding: "8px 14px", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6 }} onClick={runExport} disabled={busy} title="Re-run video export pipeline from scratch">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
              Re-export
            </button>
          )}
          <button className="st-btn primary" style={{ padding: "8px 20px", fontSize: 13, minWidth: 140, justifyContent: "center" }} onClick={runExport} disabled={busy}>
            {busy ? "Exporting…" : videoUrl ? "Re-export video" : "Export video"}
          </button>
          {busy && <button className="st-btn danger" type="button" onClick={() => exportAbortRef.current?.abort()}>Cancel export</button>}
        </div>
      </div>

      {busy && (
        <div
          style={{
            padding: "10px 24px",
            background: "var(--panel-3)",
            borderBottom: "1px solid var(--line)",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12 }}>
            <span style={{ color: "var(--ink)", fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  display: "inline-block",
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "var(--accent)",
                  boxShadow: "0 0 8px var(--accent)",
                }}
              />
              {statusText || "Processing video export…"}
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 14, color: "var(--ink-2)", fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                {formatElapsed(elapsedSec)}
              </span>
              <span style={{ fontWeight: 700, color: "var(--accent)", minWidth: 38, textAlign: "right" }}>
                {Math.round((progress ?? 0) * 100)}%
              </span>
            </div>
          </div>
          <progress
            max={100}
            value={(progress ?? 0) * 100}
            style={{
              width: "100%",
              height: 6,
              accentColor: "var(--accent)",
              borderRadius: 3,
            }}
          />
        </div>
      )}

      {error && (
        <div style={{ color: "var(--danger)", background: "rgba(229,105,95,0.1)", borderBottom: "1px solid rgba(229,105,95,0.25)", padding: "8px 24px", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span>{error}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                style={{ padding: 0, border: 0, background: "transparent", color: "inherit", font: "inherit", textDecoration: "underline", cursor: "pointer" }}
              >
                Close export
              </button>
            )}
            <button className="st-btn danger" style={{ padding: "4px 12px", fontSize: 11, display: "inline-flex", alignItems: "center", gap: 6 }} onClick={runExport} disabled={busy || Boolean(error)}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
              Retry Export
            </button>
          </div>
        </div>
      )}

      {/* Main 3-Column Split Area */}
      <div className="st-export-grid" style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "1fr 420px 400px", gap: 0 }}>
        {/* LEFT COLUMN: Large Video Preview Theater */}
        <div className="st-export-preview" style={{ display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", background: "#08090b", padding: 24, borderRight: "1px solid var(--line)", position: "relative" }}>
          <div style={{ width: "100%", maxWidth: 840, height: "100%", maxHeight: "calc(100vh - 180px)", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center" }}>
            <FinalPreview
              active={active}
              cut={cut}
              clips={clips}
              captionScale={captionScale}
              captionFontId={captionFontId}
              voiceoverBassDb={voiceoverBassDb}
              voiceoverTrebleDb={voiceoverTrebleDb}
              voiceoverEffect={voiceoverEffect}
              captionOpacity={captionOpacity}
              captionLineHeight={captionLineHeight}
              title={previewTitle}
              music={activeMusic}
              musicVolume={activeMusicVolume}
              voiceover={voiceover}
              ttsEngine={ttsEngine}
              voice={voice}
              elevenVoiceId={elevenVoiceId}
              elevenModel={elevenModel}
              elevenStability={elevenStability}
              elevenStyle={elevenStyle}
              voiceoverSpeed={voiceoverSpeed}
              voiceoverLeadSec={voiceoverLeadSec}
            />
          </div>

          {videoUrl && (
            <div style={{ position: "absolute", bottom: 16, left: 24, right: 24, padding: "10px 16px", background: "var(--panel-2)", borderRadius: 10, border: "1px solid var(--line)", display: "flex", gap: 16, alignItems: "center", boxShadow: "0 12px 32px rgba(0,0,0,0.4)" }}>
              <video
                src={videoUrl}
                controls
                controlsList="nodownload noremoteplayback noplaybackrate"
                disablePictureInPicture
                style={{ height: 64, width: 110, borderRadius: 6, background: "#000", border: "1px solid var(--line)", objectFit: "contain", flexShrink: 0 }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--good)", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span>Export Ready</span>
                  <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: "rgba(107, 203, 119, 0.15)", color: "var(--good)" }}>{renderedDelivery?.resolution} · {renderedDelivery?.fps} fps · {renderedDelivery?.format.toUpperCase()}</span>
                  {lastExportSec !== null && (
                    <span style={{ fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 4, background: "var(--panel-3)", color: "var(--ink-2)", display: "inline-flex", alignItems: "center", gap: 3 }}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                      Took {formatElapsed(lastExportSec)}
                    </span>
                  )}
                </div>

                <div style={{ fontSize: 11, color: "var(--ink-2)", marginTop: 2 }}>{fileBase}.{renderedDelivery?.format}</div>
                <div style={{ display: "flex", gap: 6, marginTop: 5, flexWrap: "wrap" }}>
                  <select aria-label="Publishing destination" value={publishTarget} onChange={(event) => setPublishTarget(event.target.value as PublishTarget)}>
                    <option>TikTok</option><option>Instagram Reels</option><option>YouTube Shorts</option><option>Instagram Feed</option>
                  </select>
                  {publishChecks.map((check) => <span key={check.label} title={check.detail} style={{ fontSize: 10, color: check.ready ? "var(--good)" : "var(--warning)" }}>{check.ready ? "✓" : "!"} {check.label}</span>)}
                </div>
              </div>
              <button className="st-btn ghost" style={{ padding: "8px 14px", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6 }} onClick={runExport} disabled={busy} title="Re-run video export pipeline">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                Re-export
              </button>
              <a className="st-btn primary" style={{ textDecoration: "none", padding: "10px 20px", fontSize: 13, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 8 }} href={videoUrl} download={`${fileBase}.${renderedDelivery?.format}`}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Download {renderedDelivery?.format.toUpperCase()}
              </a>
              <button className="st-btn ghost" type="button" onClick={() => void shareExport()} title="Open your device share sheet, or download when sharing is unavailable">Share / publish</button>
            </div>
          )}
        </div>

        {/* MIDDLE COLUMN: Text & Captions Panel (Side-by-Side Panel 1) */}
        <div className="st-export-column" style={{ overflowY: "auto", padding: 18, display: "flex", flexDirection: "column", gap: 14, background: "var(--panel)", borderRight: "1px solid var(--line)" }}>
          <div className="st-export-column-title" style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--accent)", borderBottom: "1px solid var(--line)", paddingBottom: 8, flexShrink: 0 }}>
            Text &amp; captions
          </div>

          {/* Title Overlay Card (3 Stacked Layers) */}
          <div className="st-field">
            <div
              onClick={() => setTitleOpen(!titleOpen)}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", userSelect: "none", marginBottom: 6 }}
            >
              <label style={{ cursor: "pointer", margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
                Title overlay
              </label>
              <ChevronDownIcon
                size={14}
                style={{
                  transform: titleOpen ? "rotate(180deg)" : "rotate(0deg)",
                  transition: "transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
                  color: "var(--ink-3)",
                }}
              />
            </div>

            <div className={`st-color-collapsible ${titleOpen ? "open" : ""}`}>
              <div className="st-color-collapsible-inner">
                <div className="st-title-card">
                  {/* Preset Selector Toolbar */}
                  <div className="st-title-preset">
                    <span className="st-title-preset-label">Preset</span>
                    <select
                      className="st-title-preset-select"
                      value={selectedPresetId}
                      onChange={(e) => applyPreset(e.target.value)}
                    >
                      <option value="">Choose a preset</option>
                      <optgroup label="Built-in Presets">
                        {BUILT_IN_PRESETS.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </optgroup>
                      {customPresets.length > 0 && (
                        <optgroup label="Project Saved Presets">
                          {customPresets.map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </optgroup>
                      )}
                    </select>

                    <button
                      type="button"
                      className="st-title-preset-save"
                      onClick={handleSavePreset}
                      title="Save current title layout into this project's preset list"
                    >
                      <SaveIcon size={13} /> <span>Save</span>
                    </button>
                  </div>

                  <TitleTreatmentEditor layers={titleLayers} onChange={handleLayersChange} />
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
              <label style={{ cursor: "pointer", margin: 0 }}>Caption styling</label>
              <ChevronDownIcon
                size={14}
                style={{
                  transform: captionsOpen ? "rotate(180deg)" : "rotate(0deg)",
                  transition: "transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
                  color: "var(--ink-3)",
                }}
              />
            </div>

            <div className={`st-color-collapsible ${captionsOpen ? "open" : ""}`}>
              <div className="st-color-collapsible-inner">
                <div className="st-color-adjustments" style={{ display: "flex", flexDirection: "column", gap: 10, background: "var(--panel-2)", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 11, width: 110, color: "var(--ink-2)", flexShrink: 0 }}>Caption font</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <FontPicker value={captionFontId} onChange={(id) => update({ captionFontId: id })} />
                    </div>
                  </div>

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

                  <div style={{ display: "flex", alignItems: "center", gap: 8 }} title="Spacing between wrapped caption lines. Allows negative values for tight text overlap.">
                    <span style={{ fontSize: 11, width: 110, color: "var(--ink-2)" }}>Line height</span>
                    <input
                      type="range"
                      min={-1.0}
                      max={2.5}
                      step={0.05}
                      value={captionLineHeight}
                      onChange={(e) => update({ captionLineHeight: Number(e.target.value) })}
                      onDoubleClick={() => update({ captionLineHeight: 1.0 })}
                      style={sliderTrackStyle(captionLineHeight, -1.0, 2.5)}
                    />
                    <span style={{ fontSize: 10, width: 34, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>{captionLineHeight.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Audio & Narration Panel (Side-by-Side Panel 2) */}
        <div className="st-export-column" style={{ overflowY: "auto", padding: 18, display: "flex", flexDirection: "column", gap: 14, background: "var(--panel)" }}>
          <div className="st-export-column-title" style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--accent)", borderBottom: "1px solid var(--line)", paddingBottom: 8, flexShrink: 0 }}>
            Audio &amp; narration
          </div>

          {/* Music Bed Card */}
          <div className="st-field">
            <div
              onClick={() => setMusicOpen(!musicOpen)}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", userSelect: "none", marginBottom: 6 }}
            >
              <label style={{ cursor: "pointer", margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
                Music bed {activeMusic ? <span className="st-chip" style={{ fontSize: 10, padding: "2px 6px" }}>Loaded</span> : <span style={{ opacity: 0.6, fontSize: 11, fontWeight: 400 }}>(Optional)</span>}
              </label>
              <ChevronDownIcon
                size={14}
                style={{
                  transform: musicOpen ? "rotate(180deg)" : "rotate(0deg)",
                  transition: "transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
                  color: "var(--ink-3)",
                }}
              />
            </div>

            <div className={`st-color-collapsible ${musicOpen ? "open" : ""}`}>
              <div className="st-color-collapsible-inner">
                <div className="st-color-adjustments" style={{ display: "flex", flexDirection: "column", gap: 10, background: "var(--panel-2)", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)" }}>
                  {state.musicTrack ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 11, color: "var(--ink-2)" }}>
                      <strong style={{ color: "var(--accent)" }}>{state.musicTrack.name}</strong>
                      <span>{state.musicTrack.muted ? "Muted in preview and export." : `Playing at ${Math.round(state.musicTrack.volume * 100)}% volume.`} Replace, remove, mute, or level it directly on the timeline.</span>
                    </div>
                  ) : (
                    <>
                  {musicLib.length > 0 && (
                    <div className="no-scrollbar" style={{ border: "1px solid var(--line)", borderRadius: 7, overflow: "hidden", maxHeight: 150, overflowY: "auto", background: "var(--panel-3)" }}>
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
                              {isPlaying ? <PauseIcon size={10} /> : <PlayIcon size={10} />}
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
                    </>
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
                Voiceover
              </label>
              <ChevronDownIcon
                size={14}
                style={{
                  transform: voiceOpen ? "rotate(180deg)" : "rotate(0deg)",
                  transition: "transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
                  color: "var(--ink-3)",
                }}
              />
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
                          {elevenVoices.map((v) => (
                            <option key={v.id} value={v.id}>{v.label}</option>
                          ))}
                        </select>
                      )}
                    </div>

                    {ttsEngine === "elevenlabs" && (
                      <>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }} title="Model: Flash is fast & cheap for previews; v3 understands inline audio tags like [excited].">
                          <span style={{ fontSize: 11, width: 110, color: "var(--ink-2)" }}>Model</span>
                          <select value={elevenModel} onChange={(e) => update({ elevenModel: e.target.value })} style={{ flex: 1, background: "var(--panel-3)", border: "1px solid var(--line)", borderRadius: 6, color: "var(--ink)", fontSize: 12, padding: "4px 8px", outline: "none" }}>
                            {ELEVEN_MODELS.map((m) => (
                              <option key={m.id} value={m.id}>{m.label}</option>
                            ))}
                          </select>
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: 8 }} title="Lower = more expressive/variable read; higher = steadier/more monotone.">
                          <span style={{ fontSize: 11, width: 110, color: "var(--ink-2)" }}>Stability</span>
                          <input type="range" min={0} max={1} step={0.05} value={elevenStability} onChange={(e) => update({ elevenStability: Number(e.target.value) })} style={sliderTrackStyle(elevenStability, 0, 1)} />
                          <span style={{ fontSize: 10, width: 34, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>{Math.round(elevenStability * 100)}%</span>
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: 8 }} title="Style exaggeration — 0 is neutral/faster; higher pushes the voice's characteristic style.">
                          <span style={{ fontSize: 11, width: 110, color: "var(--ink-2)" }}>Style</span>
                          <input type="range" min={0} max={1} step={0.05} value={elevenStyle} onChange={(e) => update({ elevenStyle: Number(e.target.value) })} style={sliderTrackStyle(elevenStyle, 0, 1)} />
                          <span style={{ fontSize: 10, width: 34, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>{Math.round(elevenStyle * 100)}%</span>
                        </div>

                        {elevenModel === "eleven_v3" && (
                          <span style={{ fontSize: 10, color: "var(--ink-3)", lineHeight: 1.4 }}>
                            💡 v3 reads inline audio tags in your VO text — e.g. <code>[excited]</code>, <code>[whispers]</code>, <code>[laughs]</code>, <code>[sighs]</code>.
                          </span>
                        )}
                      </>
                    )}

                    {modelMsg && <span style={{ fontSize: 11, color: "var(--accent)" }}>{modelMsg}</span>}

                    <div style={{ display: "flex", alignItems: "center", gap: 8 }} title="Volume multiplier for narration audio.">
                      <span style={{ fontSize: 11, width: 110, color: "var(--ink-2)" }}>Voiceover volume</span>
                      <input type="range" min={0} max={2} step={0.05} value={voiceoverVolume} onChange={(e) => update({ voiceoverVolume: Number(e.target.value) })} style={sliderTrackStyle(voiceoverVolume, 0, 2)} />
                      <span style={{ fontSize: 10, width: 34, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>{Math.round(voiceoverVolume * 100)}%</span>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 8 }} title="Slows or speeds the narration read.">
                      <span style={{ fontSize: 11, width: 110, color: "var(--ink-2)" }}>Voice speed</span>
                      <input type="range" min={0.7} max={1.2} step={0.05} value={voiceoverSpeed} onChange={(e) => update({ voiceoverSpeed: Number(e.target.value) })} style={sliderTrackStyle(voiceoverSpeed, 0.7, 1.2)} />
                      <span style={{ fontSize: 10, width: 34, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>{voiceoverSpeed.toFixed(2)}×</span>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 8 }} title="Band-limiting character applied to all narration, before the tone shelves.">
                      <span style={{ fontSize: 11, width: 110, color: "var(--ink-2)" }}>Voice character</span>
                      <select
                        value={voiceoverEffect}
                        onChange={(e) => update({ voiceoverEffect: e.target.value as typeof voiceoverEffect })}
                        style={{ flex: 1, minWidth: 0 }}
                      >
                        {USER_VOICE_EFFECT_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </div>

                    {/* Tone for the whole narration bed. Same shelves and ±12 dB range as
                        the recorded User VO track, so both voices shape identically. */}
                    {([
                      { key: "voiceoverBassDb", label: "Voice bass", value: voiceoverBassDb, hint: "Low-frequency tone for all narration; double-click to reset" },
                      { key: "voiceoverTrebleDb", label: "Voice treble", value: voiceoverTrebleDb, hint: "High-frequency tone for all narration; double-click to reset" },
                    ] as const).map(({ key, label, value, hint }) => (
                      <div key={key} style={{ display: "flex", alignItems: "center", gap: 8 }} title={hint}>
                        <span style={{ fontSize: 11, width: 110, color: "var(--ink-2)" }}>{label}</span>
                        <input
                          type="range"
                          min={USER_VOICE_EQ_MIN_DB}
                          max={USER_VOICE_EQ_MAX_DB}
                          step={1}
                          value={value}
                          onChange={(e) => update({ [key]: Number(e.target.value) })}
                          onDoubleClick={() => update({ [key]: 0 })}
                          style={sliderTrackStyle(value, USER_VOICE_EQ_MIN_DB, USER_VOICE_EQ_MAX_DB)}
                        />
                        <span style={{ fontSize: 10, width: 34, textAlign: "right", color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
                          {value > 0 ? "+" : ""}{value} dB
                        </span>
                      </div>
                    ))}


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

                    {/* Voiceover presets — save the current settings by name, apply any saved one. */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2, paddingTop: 8, borderTop: "1px solid var(--line)" }}>
                      <span style={{ fontSize: 11, width: 110, color: "var(--ink-2)" }}>
                        Preset{voModified && <span style={{ color: "var(--accent)", fontStyle: "italic" }}> · modified</span>}
                      </span>
                      <select
                        value={selectedVoPresetId}
                        onChange={(e) => { if (e.target.value) applyVoPreset(e.target.value); else setSelectedVoPresetId(""); }}
                        style={{ flex: 1, background: "var(--panel-3)", border: "1px solid var(--line)", borderRadius: 6, color: "var(--ink)", fontSize: 11, padding: "3px 7px", outline: "none" }}
                        title="Apply a saved voiceover preset"
                      >
                        <option value="">{voPresets.length ? "Select a preset…" : "No presets yet"}</option>
                        {voPresets.map((p) => <option key={p.id} value={p.id}>{p.id === defaultVoPresetId ? `★ ${p.name}` : p.name}</option>)}
                      </select>
                      {selectedVoPresetId && (
                        <>
                          <button
                            type="button"
                            className="st-btn ghost"
                            style={{ fontSize: 12, padding: "3px 8px", color: defaultVoPresetId === selectedVoPresetId ? "var(--accent)" : "var(--ink-3)" }}
                            onClick={toggleVoDefault}
                            title={defaultVoPresetId === selectedVoPresetId ? "This is your default — auto-applied to new projects. Click to unset." : "Make this the default (auto-applied to new projects and after Start over)"}
                          >
                            {defaultVoPresetId === selectedVoPresetId ? "★" : "☆"}
                          </button>
                          <button
                            type="button"
                            className="st-btn ghost"
                            style={{ fontSize: 11, padding: "3px 8px", color: "var(--danger)" }}
                            onClick={handleDeleteVoPreset}
                            title="Delete the selected preset"
                          >
                            ✕
                          </button>
                        </>
                      )}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      {/* Save modifications back into the selected preset — explicit, with confirm. */}
                      {voModified && selectedVoPreset && !confirmSaveMod && (
                        <button
                          type="button"
                          className="st-btn ghost"
                          style={{ fontSize: 11, padding: "4px 10px" }}
                          onClick={() => setConfirmSaveMod(true)}
                          title={`Overwrite “${selectedVoPreset.name}” with the current settings`}
                        >
                          <SaveIcon size={12} /> Save modified preset
                        </button>
                      )}
                      {voModified && selectedVoPreset && confirmSaveMod && (
                        <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                          <span style={{ color: "var(--ink-2)" }}>Overwrite “{selectedVoPreset.name}”?</span>
                          <button
                            type="button"
                            className="st-btn ghost"
                            style={{ fontSize: 11, padding: "3px 9px", color: "var(--good)" }}
                            onClick={saveModifiedPreset}
                          >
                            ✓ Confirm
                          </button>
                          <button
                            type="button"
                            className="st-btn ghost"
                            style={{ fontSize: 11, padding: "3px 9px", color: "var(--ink-3)" }}
                            onClick={() => setConfirmSaveMod(false)}
                          >
                            ✕ Cancel
                          </button>
                        </span>
                      )}
                      {voModified && (
                        <button
                          type="button"
                          className="st-btn ghost"
                          style={{ fontSize: 11, padding: "4px 10px", color: "var(--accent)" }}
                          onClick={revertVoChanges}
                          title={selectedVoPreset ? `Discard changes and go back to “${selectedVoPreset.name}”` : "Discard changes and go back to before you modified"}
                        >
                          ↺ Revert changes
                        </button>
                      )}
                      <button
                        type="button"
                        className="st-btn ghost"
                        style={{ fontSize: 11, padding: "4px 10px" }}
                        onClick={handleSaveVoPreset}
                        title="Save these voiceover settings as a NEW named preset (available in every project)"
                      >
                        <SaveIcon size={12} /> Save as new preset…
                      </button>
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
