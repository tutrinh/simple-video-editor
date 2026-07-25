import { useEffect, useRef, useState } from "react";
import { fetchSfxList, sfxFileUrl, uploadSfx } from "../lib/sfxLibrary";

/**
 * Popover for the SFX track's "＋ Sound FX" button: lists the sounds in the audio/
 * directory (each with a ▶ audition), plus an Upload that copies a new sound into
 * the folder. Picking a sound calls onPick(fileName); the popover stays open so you
 * can add several in a row.
 */
export default function SfxPicker({ onPick, onClose }: { onPick: (fileName: string) => void; onClose: () => void }) {
  const [files, setFiles] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [playing, setPlaying] = useState("");
  const audioRef = useRef<HTMLAudioElement>(null);

  const refresh = () => fetchSfxList().then(setFiles).catch(() => setFiles([]));
  useEffect(() => { refresh(); }, []);

  function preview(name: string) {
    const a = audioRef.current;
    if (!a) return;
    if (playing === name) { a.pause(); setPlaying(""); return; }
    a.src = sfxFileUrl(name);
    a.play().catch(() => {});
    setPlaying(name);
  }

  async function onUpload(file?: File) {
    if (!file) return;
    setBusy(true); setErr(null);
    try {
      const name = await uploadSfx(file);
      await refresh();
      onPick(name); // place the just-uploaded sound immediately
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="st-sfx-picker">
      <div className="st-sfx-picker-head">
        <span>🔊 Sound FX</span>
        <button type="button" className="x" onClick={onClose} title="Close">×</button>
      </div>

      <label className="st-sfx-upload" title="Copy a sound into the project's audio/ folder">
        {busy ? "Uploading…" : "⬆ Upload sound"}
        <input type="file" accept="audio/*" disabled={busy} style={{ display: "none" }}
          onChange={(e) => { onUpload(e.target.files?.[0]); e.currentTarget.value = ""; }} />
      </label>

      {err && <div className="st-sfx-err">⚠ {err}</div>}

      <div className="st-sfx-list no-scrollbar">
        {files.length === 0 ? (
          <div className="st-sfx-empty">No sounds yet — upload one, or drop files in the <code>audio/</code> folder.</div>
        ) : (
          files.map((name) => (
            <div className="st-sfx-row" key={name}>
              <button type="button" className="st-sfx-play" onClick={() => preview(name)} title="Preview">
                {playing === name ? "⏸" : "▶"}
              </button>
              <span className="st-sfx-name" title={name}>{name}</span>
              <button type="button" className="st-sfx-add" onClick={() => onPick(name)} title="Add to the SFX track at the selected beat">
                ＋ Add
              </button>
            </div>
          ))
        )}
      </div>

      <audio ref={audioRef} onEnded={() => setPlaying("")} />
    </div>
  );
}
