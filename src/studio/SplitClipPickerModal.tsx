import { useState } from "react";
import type { Clip } from "../domain/types";
import { getClipBlobUrl } from "../lib/blobUrlCache";
import { fmtSecs } from "./util";
import { getTagStyle } from "../lib/tagPresets";
import Modal from "../design-system/Modal";
import { InputControl } from "../design-system/ControlPrimitives";

interface Props {
  slotIndex?: number;
  title?: string;
  activeClipId: string;
  clips: Clip[];
  onSelectClip: (clipId: string) => void;
  onClose: () => void;
}

export default function SplitClipPickerModal({ slotIndex, title, activeClipId, clips, onSelectClip, onClose }: Props) {
  const [search, setSearch] = useState("");

  const searchLower = search.toLowerCase().trim();
  const filteredClips = clips.filter((c) =>
    c.name.toLowerCase().includes(searchLower) ||
    (c.tags && c.tags.some((t) => t.toLowerCase().includes(searchLower)))
  );

  const displayTitle = title ?? (slotIndex !== undefined ? `Pick Clip for Slot ${slotIndex + 1}` : "Select Source Clip");

  return (
    <Modal
      open
      title={displayTitle}
      onClose={onClose}
      maxWidth={580}
      emphasis="signal"
      headerMeta={(
        <span style={{ fontSize: 11, fontWeight: 500, color: "var(--ink-3)", background: "var(--panel-2)", padding: "2px 8px", borderRadius: 10 }}>
          {clips.length} project {clips.length === 1 ? "clip" : "clips"}
        </span>
      )}
    >
      {clips.length > 5 && (
          <div style={{ paddingBottom: 10 }}>
            <InputControl
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

      <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))",
            gap: 12,
          }}
        >
          {filteredClips.length === 0 && (
            <div style={{ gridColumn: "1 / -1", padding: "28px 18px", textAlign: "center", color: "var(--ink-3)", fontSize: 12 }}>
              No available clips. Add new footage in the Clips panel, then return to this slot.
            </div>
          )}
          {filteredClips.map((c) => (
            <ClipCardItem
              key={c.id}
              clip={c}
              isSelected={c.id === activeClipId}
              onSelect={() => {
                onSelectClip(c.id);
                onClose();
              }}
            />
          ))}
      </div>
    </Modal>
  );
}

function ClipCardItem({
  clip,
  isSelected,
  onSelect,
}: {
  clip: Clip;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const blobUrl = getClipBlobUrl(clip.file);

  return (
    <div
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative",
        background: "var(--panel)",
        border: isSelected ? "2px solid var(--accent)" : `1px solid ${hovered ? "var(--ink-2)" : "var(--line)"}`,
        borderRadius: 8,
        overflow: "hidden",
        cursor: "pointer",
        transition: "transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease",
        transform: hovered ? "translateY(-2px)" : "none",
        boxShadow: isSelected
          ? "0 0 12px color-mix(in srgb, var(--accent) 40%, transparent)"
          : hovered
          ? "0 6px 16px rgba(0,0,0,0.4)"
          : "none",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Thumbnail / Video Preview */}
      <div style={{ width: "100%", height: 85, background: "#000", position: "relative", overflow: "hidden" }}>
        {clip.kind === "still" ? (
          <img src={blobUrl} alt={clip.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : hovered ? (
          <video
            src={blobUrl}
            autoPlay
            loop
            muted
            playsInline
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : clip.poster ? (
          <img src={clip.poster} alt={clip.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <video src={blobUrl} style={{ width: "100%", height: "100%", objectFit: "cover" }} muted playsInline />
        )}

        {isSelected && (
          <div
            style={{
              position: "absolute",
              top: 6,
              right: 6,
              background: "var(--accent)",
              color: "var(--accent-ink)",
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
            background: "rgba(0, 0, 0, 0.85)",
            backdropFilter: "blur(2px)",
            color: "#fff",
            fontSize: 10,
            fontWeight: 600,
            fontVariantNumeric: "tabular-nums",
            padding: "2px 6px",
            borderRadius: 4,
            border: "1px solid rgba(255, 255, 255, 0.15)",
          }}
        >
          {fmtSecs(clip.durationSec)}
        </span>
      </div>

      {/* Clip Info */}
      <div style={{ padding: "6px 8px 8px 8px", minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: isSelected ? "var(--accent)" : "var(--ink)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          title={clip.name}
        >
          {clip.name}
        </div>
        <div style={{ fontSize: 10, color: "var(--ink-3)", fontVariantNumeric: "tabular-nums", fontWeight: 500 }}>
          ⏱ {fmtSecs(clip.durationSec)}
        </div>
        {clip.tags && clip.tags.length > 0 && (
          <div style={{ display: "flex", gap: 3, flexWrap: "wrap", marginTop: 2 }}>
            {clip.tags.slice(0, 3).map((tag) => {
              const style = getTagStyle(tag);
              return (
                <span
                  key={tag}
                  style={{
                    fontSize: 8.5,
                    fontWeight: 600,
                    padding: "0px 4px",
                    borderRadius: 3,
                    background: style.bg,
                    color: style.text,
                    border: `1px solid ${style.border}`,
                    lineHeight: 1.2,
                  }}
                >
                  {tag}
                </span>
              );
            })}
            {clip.tags.length > 3 && (
              <span style={{ fontSize: 8.5, color: "var(--ink-3)" }}>+{clip.tags.length - 3}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
