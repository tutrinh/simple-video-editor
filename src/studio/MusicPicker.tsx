import { useEffect, useRef, useState } from "react";
import { deleteMusic, fetchMusicList, musicFileUrl } from "../lib/musicLibrary";
import CloseButton from "../design-system/CloseButton";
import { ControlButton, InputControl } from "../design-system/ControlPrimitives";
import AddIcon from "../design-system/icons/AddIcon";
import PauseIcon from "../design-system/icons/PauseIcon";
import PlayIcon from "../design-system/icons/PlayIcon";
import DeleteIcon from "../design-system/icons/DeleteIcon";

interface Props {
  onPick: (fileName: string) => void;
  onImport: (file: File) => void;
  onClose: () => void;
  onDelete?: (fileName: string) => void;
  busy?: boolean;
}

/** App-wide Music library picker. Projects select assets; this module owns discovery/audition. */
export default function MusicPicker({ onPick, onImport, onClose, onDelete, busy = false }: Props) {
  const [files, setFiles] = useState<string[]>([]);
  const [playing, setPlaying] = useState("");
  const [deleting, setDeleting] = useState("");
  const [error, setError] = useState("");
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => { void fetchMusicList().then(setFiles); }, []);

  function preview(name: string) {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing === name) { audio.pause(); setPlaying(""); return; }
    audio.src = musicFileUrl(name);
    void audio.play().catch(() => setPlaying(""));
    setPlaying(name);
  }

  async function removeFromLibrary(name: string) {
    if (!confirm(`Permanently delete “${name}” from the shared Music library?`)) return;
    setDeleting(name);
    setError("");
    try {
      if (playing === name) {
        audioRef.current?.pause();
        setPlaying("");
      }
      await deleteMusic(name);
      setFiles((current) => current.filter((fileName) => fileName !== name));
      onDelete?.(name);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setDeleting("");
    }
  }

  return (
    <div className="st-sfx-picker st-music-picker">
      <div className="st-sfx-picker-head">
        <div><strong>Music library</strong><span>Shared across every project</span></div>
        <CloseButton onClick={onClose} />
      </div>
      <label className="st-sfx-upload" title="Extract audio if needed and save it in the app Music library">
        <AddIcon size={13} />
        {busy ? "Preparing…" : "Import audio or video"}
        <InputControl
          type="file"
          accept="audio/*,video/*,.aac,.avi,.flac,.m4a,.m4v,.mkv,.mov,.mp3,.mp4,.oga,.ogg,.opus,.wav,.webm"
          disabled={busy}
          style={{ display: "none" }}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) onImport(file);
          }}
        />
      </label>
      {error && <div className="st-product-review-alert" role="alert">{error}</div>}
      <div className="st-sfx-list no-scrollbar">
        {files.length === 0 ? (
          <div className="st-sfx-empty">No shared music yet — import an audio track or a video.</div>
        ) : files.map((name) => (
          <div className="st-sfx-row" key={name}>
            <ControlButton type="button" className="st-sfx-play" onClick={() => preview(name)} title={`Preview ${name}`}>
              {playing === name ? <PauseIcon size={10} /> : <PlayIcon size={10} />}
            </ControlButton>
            <span className="st-sfx-name" title={name}>{name}</span>
            <ControlButton type="button" className="st-sfx-add" onClick={() => onPick(name)} title={`Use ${name} in this project`} aria-label={`Use ${name}`}>
              <AddIcon size={12} />
            </ControlButton>
            <ControlButton
              type="button"
              className="st-music-library-delete"
              disabled={busy || deleting === name}
              onClick={() => { void removeFromLibrary(name); }}
              title={`Permanently delete ${name} from the Music library`}
              aria-label={`Delete ${name} from Music library`}
            >
              <DeleteIcon size={11} />
            </ControlButton>
          </div>
        ))}
      </div>
      <audio ref={audioRef} onEnded={() => setPlaying("")} />
    </div>
  );
}
