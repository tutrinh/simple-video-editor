import { useState } from "react";
import type { Clip } from "../domain/types";
import { PRESET_TAGS, getTagStyle } from "../lib/tagPresets";
import { useProject } from "../state/ProjectContext";

interface Props {
  clip: Clip;
  compact?: boolean;
}

export default function ClipTagEditor({ clip, compact = false }: Props) {
  const { dispatch } = useProject();
  const [inputVal, setInputVal] = useState("");
  const currentTags = clip.tags ?? [];

  const addTag = (tag: string) => {
    const trimmed = tag.trim();
    if (!trimmed) return;
    if (currentTags.some((t) => t.toLowerCase() === trimmed.toLowerCase())) return;
    dispatch({ type: "SET_CLIP_TAGS", id: clip.id, tags: [...currentTags, trimmed] });
    setInputVal("");
  };

  const removeTag = (tag: string) => {
    dispatch({
      type: "SET_CLIP_TAGS",
      id: clip.id,
      tags: currentTags.filter((t) => t.toLowerCase() !== tag.toLowerCase()),
    });
  };

  const togglePreset = (presetLabel: string) => {
    const exists = currentTags.some((t) => t.toLowerCase() === presetLabel.toLowerCase());
    if (exists) {
      removeTag(presetLabel);
    } else {
      addTag(presetLabel);
    }
  };

  if (compact) {
    return (
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
        {currentTags.map((tag) => {
          const style = getTagStyle(tag);
          return (
            <span
              key={tag}
              style={{
                fontSize: 9.5,
                fontWeight: 600,
                padding: "1px 6px",
                borderRadius: 4,
                background: style.bg,
                color: style.text,
                border: `1px solid ${style.border}`,
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              {tag}
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  removeTag(tag);
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: "inherit",
                  cursor: "pointer",
                  padding: 0,
                  fontSize: 10,
                  lineHeight: 1,
                  opacity: 0.7,
                }}
                title={`Remove ${tag} tag`}
              >
                ✕
              </button>
            </span>
          );
        })}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Current Active Tags */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {currentTags.map((tag) => {
          const style = getTagStyle(tag);
          return (
            <span
              key={tag}
              style={{
                fontSize: 10.5,
                fontWeight: 600,
                padding: "2px 8px",
                borderRadius: 5,
                background: style.bg,
                color: style.text,
                border: `1px solid ${style.border}`,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              🏷️ {tag}
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  removeTag(tag);
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: "inherit",
                  cursor: "pointer",
                  padding: 0,
                  fontSize: 11,
                  lineHeight: 1,
                  opacity: 0.8,
                }}
                title={`Remove ${tag} tag`}
              >
                ✕
              </button>
            </span>
          );
        })}
        {currentTags.length === 0 && (
          <span style={{ fontSize: 11, color: "var(--ink-3)", fontStyle: "italic" }}>No tags assigned</span>
        )}
      </div>

      {/* Preset Tag Buttons */}
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
        {PRESET_TAGS.map((preset) => {
          const active = currentTags.some((t) => t.toLowerCase() === preset.label.toLowerCase());
          return (
            <button
              key={preset.id}
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                togglePreset(preset.label);
              }}
              style={{
                fontSize: 10,
                fontWeight: 600,
                padding: "2px 7px",
                borderRadius: 4,
                cursor: "pointer",
                background: active ? preset.color.bg : "var(--panel)",
                color: active ? preset.color.text : "var(--ink-2)",
                border: `1px solid ${active ? preset.color.border : "var(--line)"}`,
                transition: "all 0.15s ease",
              }}
              title={active ? `Remove ${preset.label} tag` : `Add ${preset.label} tag`}
            >
              {active ? `✓ ${preset.label}` : `+ ${preset.label}`}
            </button>
          );
        })}
      </div>

      {/* Custom Tag Input */}
      <div style={{ display: "flex", gap: 6 }}>
        <input
          type="text"
          value={inputVal}
          placeholder="Add custom tag…"
          onChange={(e) => setInputVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addTag(inputVal);
            }
          }}
          style={{
            flex: 1,
            background: "var(--panel)",
            color: "var(--ink)",
            border: "1px solid var(--line)",
            borderRadius: 6,
            padding: "4px 8px",
            fontSize: 11,
            outline: "none",
          }}
        />
        <button
          type="button"
          className="st-btn ghost"
          style={{ fontSize: 11, padding: "4px 10px" }}
          onClick={() => addTag(inputVal)}
          disabled={!inputVal.trim()}
        >
          + Add
        </button>
      </div>
    </div>
  );
}
