import { useRef, useState } from "react";
import { BUILTIN_STICKERS, type BuiltinSticker } from "../lib/builtinStickers";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSelectSticker: (src: string, mimeType: "image/png" | "image/svg+xml", name: string) => void;
}

type Tab = "library" | "upload" | "clipboard";

export default function StickerPickerModal({ isOpen, onClose, onSelectSticker }: Props) {
  const [tab, setTab] = useState<Tab>("library");
  const [clipStatus, setClipStatus] = useState<"idle" | "reading" | "ok" | "err">("idle");
  const fileRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  function pickBuiltin(s: BuiltinSticker) {
    onSelectSticker(s.src, "image/svg+xml", s.name);
    onClose();
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      const mimeType = file.type === "image/svg+xml" ? "image/svg+xml" : "image/png";
      const src = await readFileAsDataUrl(file);
      onSelectSticker(src, mimeType, file.name.replace(/\.[^.]+$/, ""));
    }
    if (fileRef.current) fileRef.current.value = "";
    onClose();
  }

  async function handlePaste() {
    try {
      setClipStatus("reading");
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const pngType = item.types.find((t) => t === "image/png");
        if (pngType) {
          const blob = await item.getType(pngType);
          const src = await blobToDataUrl(blob);
          onSelectSticker(src, "image/png", "Clipboard sticker");
          setClipStatus("ok");
          setTimeout(onClose, 300);
          return;
        }
      }
      setClipStatus("err");
    } catch {
      setClipStatus("err");
    }
  }

  const categories = ["shapes", "nature", "symbols", "fun"] as const;

  return (
    <div
      className="st-sk-picker-backdrop"
      onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="st-sk-picker-modal">
        {/* Header */}
        <div className="st-sk-picker-header">
          <span className="st-sk-picker-title">🪄 Add Sticker</span>
          <button
            className="st-sk-picker-close"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onClose}
            title="Close"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <line x1="2" y1="2" x2="10" y2="10" /><line x1="10" y1="2" x2="2" y2="10" />
            </svg>
          </button>
        </div>

        {/* Tab bar */}
        <div className="st-sk-picker-tabs">
          {(["library", "upload", "clipboard"] as Tab[]).map((t) => (
            <button
              key={t}
              className={"st-sk-picker-tab" + (tab === t ? " active" : "")}
              onClick={() => setTab(t)}
            >
              {t === "library" ? "Library" : t === "upload" ? "Upload" : "Clipboard"}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="st-sk-picker-body">
          {tab === "library" && (
            <div className="st-sk-picker-library">
              {categories.map((cat) => {
                const items = BUILTIN_STICKERS.filter((s) => s.category === cat);
                if (!items.length) return null;
                return (
                  <div key={cat} className="st-sk-picker-cat">
                    <div className="st-sk-picker-cat-label">{cat.charAt(0).toUpperCase() + cat.slice(1)}</div>
                    <div className="st-sk-picker-grid">
                      {items.map((s) => (
                        <button
                          key={s.id}
                          className="st-sk-picker-item"
                          onClick={() => pickBuiltin(s)}
                          title={s.name}
                        >
                          <img src={s.src} alt={s.name} width={40} height={40} />
                          <span className="st-sk-picker-item-name">{s.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {tab === "upload" && (
            <div className="st-sk-picker-upload">
              <div className="st-sk-picker-upload-drop" onClick={() => fileRef.current?.click()}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="17 8 12 3 7 8"/>
                  <line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
                <p className="st-sk-picker-upload-hint">Click to choose PNG or SVG files</p>
                <p className="st-sk-picker-upload-sub">Transparent PNGs and SVGs work best</p>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/svg+xml"
                multiple
                style={{ display: "none" }}
                onChange={handleFileChange}
              />
            </div>
          )}

          {tab === "clipboard" && (
            <div className="st-sk-picker-clipboard">
              <div className="st-sk-picker-clip-icon">📋</div>
              <p className="st-sk-picker-clip-desc">
                Copy a transparent PNG to your clipboard (e.g. from Figma, Photoshop, or any image editor), then click below.
              </p>
              <button
                className={"st-btn" + (clipStatus === "ok" ? " accent" : " ghost")}
                onClick={handlePaste}
                disabled={clipStatus === "reading"}
                style={{ marginTop: 12 }}
              >
                {clipStatus === "reading" ? "Reading…" : clipStatus === "ok" ? "✓ Pasted!" : "Paste from clipboard"}
              </button>
              {clipStatus === "err" && (
                <p className="st-sk-picker-clip-err">
                  No PNG image found in clipboard. Copy an image first and try again.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
