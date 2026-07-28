import { useEffect, useState } from "react";
import Modal from "./Modal";

export interface ClipSwapItem {
  id: string;
  name: string;
  duration: string;
  thumbnail?: string;
  tone?: "warm" | "signal" | "dark" | "positive" | "neutral";
}

interface ClipSwapModalProps {
  open: boolean;
  title: string;
  items: ClipSwapItem[];
  selectedId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}

export default function ClipSwapModal({
  open,
  title,
  items,
  selectedId,
  onSelect,
  onClose,
}: ClipSwapModalProps) {
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  if (!open) return null;

  const query = search.trim().toLowerCase();
  const filteredItems = items.filter((item) => item.name.toLowerCase().includes(query));

  return (
    <Modal
      open
      title={title}
      onClose={onClose}
      maxWidth={660}
      emphasis="signal"
      headerMeta={<span className="ds-clip-swap-count">{items.length} project clips</span>}
    >
        <div className="ds-clip-swap-search">
          <label htmlFor="clip-swap-search">Find a clip</label>
          <input
            id="clip-swap-search"
            type="search"
            value={search}
            placeholder="Search project clips"
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <div className="ds-clip-swap-grid">
          {filteredItems.map((item) => {
            const selected = item.id === selectedId;
            return (
              <button
                type="button"
                key={item.id}
                className={`ds-clip-option${selected ? " selected" : ""}`}
                aria-pressed={selected}
                onClick={() => {
                  onSelect(item.id);
                  onClose();
                }}
              >
                <div className={`ds-clip-option-media ${item.tone ?? "neutral"}`}>
                  {item.thumbnail && <img src={item.thumbnail} alt="" />}
                  {selected && (
                    <span className="ds-clip-option-check" aria-hidden="true">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                        <path d="m5 12 4 4L19 6" />
                      </svg>
                    </span>
                  )}
                  <span className="ds-clip-option-duration">{item.duration}</span>
                </div>
                <span className="ds-clip-option-info">
                  <strong>{item.name}</strong>
                  <small>{item.duration}</small>
                </span>
              </button>
            );
          })}
          {filteredItems.length === 0 && (
            <div className="ds-clip-swap-empty">
              <strong>No matching clips</strong>
              <span>Try another file name.</span>
            </div>
          )}
        </div>
    </Modal>
  );
}
