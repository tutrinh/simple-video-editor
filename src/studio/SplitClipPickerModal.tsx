import { useState } from "react";
import type { Clip } from "../domain/types";
import { getClipBlobUrl } from "../lib/blobUrlCache";
import { fmtSecs } from "./util";

interface Props {
  slotIndex: number;
  activeClipId: string;
  clips: Clip[];
  onSelectClip: (clipId: string) => void;
  onClose: () => void;
}

export default function SplitClipPickerModal({ slotIndex, activeClipId, clips, onSelectClip, onClose }: Props) {
  const [search, setSearch] = useState("");

  const filteredClips = clips.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        background: "rgba(0, 0, 0, 0.75)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 580,
          maxHeight: "80vh",
          background: "var(--panel-2)",
          border: "1px solid #8b7cff",
          borderRadius: 12,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 16px 48px rgba(0,0,0,0.6)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: "14px 18px",
            borderBottom: "1px solid var(--line)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "var(--panel)",
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 700, color: "#8b7cff", display: "flex", alignItems: "center", gap: 8 }}>
            <span>🎬 Pick Clip for Slot {slotIndex + 1}</span>
            <span style={{ fontSize: 11, fontWeight: 500, color: "var(--ink-3)", background: "var(--panel-2)", padding: "2px 8px", borderRadius: 10 }}>
              {clips.length} project {clips.length === 1 ? "clip" : "clips"}
            </span>
          </div>
          <button
            type="button"
            className="st-btn ghost"
            onClick={onClose}
            style={{ padding: "2px 8px", fontSize: 16, lineHeight: 1 }}
            title="Close"
          >
            ×
          </button>
        </div>

        {/* Search filter bar */}
        {clips.length > 5 && (
          <div style={{ padding: "10px 18px 0 18px" }}>
            <input
              type="text"
              placeholder="Search clips by name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                width: "100%",
                background: "var(--panel)",
                color: "var(--ink)",
                border: "1px solid var(--line)",
                borderRadius: 6,
                padding: "6px 10px",
                fontSize: 12,
                outline: "none",
              }}
            />
          </div>
        )}

        {/* Visual Clip Grid */}
        <div
          style={{
            padding: 18,
            overflowY: "auto",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))",
            gap: 12,
          }}
        >
          {filteredClips.map((c) => {
            const isSelected = c.id === activeClipId;
            const blobUrl = getClipBlobUrl(c.file);

            return (
              <div
                key={c.id}
                onClick={() => {
                  onSelectClip(c.id);
                  onClose();
                }}
                style={{
                  position: "relative",
                  background: "var(--panel)",
                  border: isSelected ? "2px solid #8b7cff" : "1px solid var(--line)",
                  borderRadius: 8,
                  overflow: "hidden",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  boxShadow: isSelected ? "0 0 12px rgba(139, 124, 255, 0.4)" : "none",
                  display: "flex",
                  flexDirection: "column",
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) e.currentTarget.style.borderColor = "var(--ink-2)";
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) e.currentTarget.style.borderColor = "var(--line)";
                }}
              >
                {/* Thumbnail Preview */}
                <div style={{ width: "100%", height: 85, background: "#000", position: "relative", overflow: "hidden" }}>
                  {c.kind === "still" ? (
                    <img src={blobUrl} alt={c.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    <video src={blobUrl} style={{ width: "100%", height: "100%", objectFit: "cover" }} muted playsInline />
                  )}
                  {isSelected && (
                    <div
                      style={{
                        position: "absolute",
                        top: 6,
                        right: 6,
                        background: "#8b7cff",
                        color: "#fff",
                        width: 20,
                        height: 20,
                        borderRadius: "50%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 12,
                        fontWeight: 700,
                        boxShadow: "0 2px 6px rgba(0,0,0,0.5)",
                      }}
                    >
                      ✓
                    </div>
                  )}
                  <span
                    style={{
                      position: "absolute",
                      bottom: 4,
                      right: 4,
                      background: "rgba(0,0,0,0.75)",
                      color: "var(--ink)",
                      fontSize: 9,
                      fontFamily: "var(--mono)",
                      padding: "1px 5px",
                      borderRadius: 3,
                    }}
                  >
                    {fmtSecs(c.durationSec)}
                  </span>
                </div>

                {/* Clip Info */}
                <div style={{ padding: 8, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: isSelected ? "#8b7cff" : "var(--ink)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                    title={c.name}
                  >
                    {c.name}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
