import { useEffect, useState } from "react";
import {
  fetchStickerList, stickerFileUrl, uploadSticker,
  loadFavorites, toggleFavorite, sortByFavorite,
} from "../lib/stickerLibrary";
import CloseButton from "../design-system/CloseButton";
import { ControlButton, InputControl } from "../design-system/ControlPrimitives";

/**
 * Popover for the Sticker track's "＋ Sticker" button: the images in the stickers/
 * directory as a thumbnail grid, each with a ★ favourite toggle, plus an Upload
 * that copies a new image into the folder. Picking calls onPick(fileName); the
 * popover stays open so you can add several in a row.
 *
 * Mirrors SfxPicker, which does the same for the audio/ folder — same structure,
 * same class naming, favourites replacing the ▶ audition.
 */
export default function StickerPicker({ onPick, onClose }: { onPick: (fileName: string) => void; onClose: () => void }) {
  const [files, setFiles] = useState<string[]>([]);
  const [favorites, setFavorites] = useState<string[]>(() => loadFavorites());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = () => fetchStickerList().then(setFiles).catch(() => setFiles([]));
  useEffect(() => { refresh(); }, []);

  async function onUpload(file?: File) {
    if (!file) return;
    setBusy(true); setErr(null);
    try {
      const name = await uploadSticker(file);
      await refresh();
      onPick(name); // place the just-uploaded sticker immediately
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const ordered = sortByFavorite(files, favorites);

  return (
    <div className="st-sticker-picker">
      <div className="st-sfx-picker-head">
        <span>🩹 Stickers</span>
        <CloseButton onClick={onClose} />
      </div>

      <label className="st-sfx-upload" title="Copy an image into the project's stickers/ folder">
        {busy ? "Uploading…" : "⬆ Upload sticker"}
        <InputControl
          type="file"
          accept=".png,.svg,.webp,image/png,image/svg+xml,image/webp"
          disabled={busy}
          style={{ display: "none" }}
          onChange={(e) => { onUpload(e.target.files?.[0]); e.currentTarget.value = ""; }}
        />
      </label>

      {err && <div className="st-sfx-err">⚠ {err}</div>}

      <div className="st-sticker-grid no-scrollbar">
        {ordered.length === 0 ? (
          <div className="st-sfx-empty">
            No stickers yet — upload one, or drop <code>.png</code> / <code>.svg</code> / <code>.webp</code> files
            in the <code>stickers/</code> folder.
          </div>
        ) : (
          ordered.map((name) => {
            const fav = favorites.includes(name);
            return (
              <div className="st-sticker-cell" key={name}>
                <ControlButton
                  type="button"
                  className="st-sticker-thumb"
                  onClick={() => onPick(name)}
                  title={`Add ${name} to the Sticker track`}
                >
                  <img src={stickerFileUrl(name)} alt={name} loading="lazy" />
                </ControlButton>
                <ControlButton
                  type="button"
                  className={"st-sticker-star" + (fav ? " on" : "")}
                  onClick={(e) => { e.stopPropagation(); setFavorites(toggleFavorite(name)); }}
                  title={fav ? "Remove from favourites" : "Favourite — sorts to the top"}
                >
                  {fav ? "★" : "☆"}
                </ControlButton>
                <span className="st-sticker-name" title={name}>{name}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
