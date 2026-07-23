import { useEffect, useRef, useState } from "react";
import type { Clip, Cut, OverlayBlendMode } from "../domain/types";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  cut: Cut;
  clips: Clip[];
  onSelectClip: (clip: Clip, blendMode: OverlayBlendMode) => void;
  onImportStockOverlay: (category: string, fileName: string, blendMode: OverlayBlendMode) => Promise<void>;
  onImportFiles: (files: File[], category: string) => Promise<void>;
}

interface StockFile {
  category: string;
  fileName: string;
  suggestedBlend: OverlayBlendMode;
}

type Tab = "all" | "project" | "upload" | string;

export default function OverlayPickerModal({
  isOpen,
  onClose,
  cut,
  clips,
  onSelectClip,
  onImportStockOverlay,
  onImportFiles,
}: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("all");
  const [loading, setLoading] = useState(false);
  const [stockItems, setStockItems] = useState<StockFile[]>([]);
  const [importingFile, setImportingFile] = useState<string | null>(null);

  // Upload tab state
  const [draggingOver, setDraggingOver] = useState(false);
  const [uploadQueue, setUploadQueue] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadCategory, setUploadCategory] = useState("uploads");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    fetch("/api/overlays/list")
      .then((res) => res.json())
      .then((data) => {
        const items: StockFile[] = [];
        const categories = data.categories ?? [];
        for (const cat of categories) {
          for (const f of cat.files) {
            const catLower = cat.category.toLowerCase();
            const nameLower = f.toLowerCase();
            let suggestedBlend: OverlayBlendMode = "normal";
            if (catLower.includes("leak") || catLower.includes("light") || nameLower.includes("leak") || nameLower.includes("flare")) {
              suggestedBlend = "screen";
            } else if (catLower.includes("grain") || nameLower.includes("grain") || nameLower.includes("dust")) {
              suggestedBlend = "multiply";
            } else if (catLower.includes("glitch") || nameLower.includes("glitch")) {
              suggestedBlend = "screen";
            }
            items.push({ category: cat.category, fileName: f, suggestedBlend });
          }
        }
        setStockItems(items);
      })
      .catch(() => setStockItems([]))
      .finally(() => setLoading(false));
  }, [isOpen]);

  // Reset upload queue when modal closes
  useEffect(() => {
    if (!isOpen) setUploadQueue([]);
  }, [isOpen]);

  if (!isOpen) return null;

  const categories = Array.from(new Set(stockItems.map((i) => i.category)));
  const filteredStock =
    activeTab === "all"
      ? stockItems
      : activeTab === "project" || activeTab === "upload"
      ? []
      : stockItems.filter((i) => i.category === activeTab);

  const showProjectClips = activeTab === "all" || activeTab === "project";

  // ── Upload helpers ──────────────────────────────────────────────
  const ACCEPTED = /\.(mp4|mov|webm|m4v|avi)$/i;

  function pickFiles(files: FileList | null) {
    if (!files) return;
    const valid = Array.from(files).filter((f) => ACCEPTED.test(f.name));
    if (valid.length) setUploadQueue((q) => [...q, ...valid.filter((f) => !q.some((x) => x.name === f.name && x.size === f.size))]);
  }

  function removeFromQueue(idx: number) {
    setUploadQueue((q) => q.filter((_, i) => i !== idx));
  }

  async function handleAddToTimeline() {
    if (!uploadQueue.length) return;
    setUploading(true);
    try {
      await onImportFiles(uploadQueue, uploadCategory);
      setUploadQueue([]);
      onClose();
    } finally {
      setUploading(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────
  return (
    <div className="st-modal-scrim" onClick={onClose} style={{ zIndex: 1000 }}>
      <div
        className="st-modal-card"
        style={{
          maxWidth: 820,
          width: "92%",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          padding: 0,
          borderRadius: 12,
          overflow: "hidden",
          background: "var(--panel)",
          boxShadow: "0 24px 60px rgba(0,0,0,0.7)",
          border: "1px solid var(--line)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid var(--line)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "var(--panel-2)",
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--accent)", display: "flex", alignItems: "center", gap: 8 }}>
              <span>✨ Stock Overlays &amp; B-Roll Library</span>
            </h3>
            <p style={{ margin: "2px 0 0 0", fontSize: 11, color: "var(--ink-2)" }}>
              Hover over any overlay card to play a live video preview. Select an effect to layer it over your cut.
            </p>
          </div>
          <button
            className="st-btn ghost"
            onClick={onClose}
            style={{ fontSize: 14, padding: "4px 10px", borderRadius: "50%" }}
            title="Close overlay library"
          >
            ✕
          </button>
        </div>

        {/* Category Tabs */}
        <div
          style={{
            padding: "10px 20px",
            background: "var(--panel-3)",
            borderBottom: "1px solid var(--line)",
            display: "flex",
            gap: 6,
            overflowX: "auto",
            flexShrink: 0,
            alignItems: "center",
          }}
        >
          <button
            type="button"
            onClick={() => setActiveTab("all")}
            className={"st-btn " + (activeTab === "all" ? "primary" : "ghost")}
            style={{ fontSize: 11, padding: "4px 12px", borderRadius: 16, whiteSpace: "nowrap" }}
          >
            🌟 All ({stockItems.length + clips.length})
          </button>

          {categories.map((cat) => {
            const count = stockItems.filter((i) => i.category === cat).length;
            const icon = cat.includes("light") || cat.includes("leak") ? "✨" : cat.includes("grain") ? "🎞️" : "⚡";
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setActiveTab(cat)}
                className={"st-btn " + (activeTab === cat ? "primary" : "ghost")}
                style={{ fontSize: 11, padding: "4px 12px", borderRadius: 16, textTransform: "capitalize", whiteSpace: "nowrap" }}
              >
                {icon} {cat.replace(/-/g, " ")} ({count})
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => setActiveTab("project")}
            className={"st-btn " + (activeTab === "project" ? "primary" : "ghost")}
            style={{ fontSize: 11, padding: "4px 12px", borderRadius: 16, whiteSpace: "nowrap" }}
          >
            📁 Project Footage ({clips.length})
          </button>

          {/* Upload tab */}
          <button
            type="button"
            onClick={() => setActiveTab("upload")}
            className={"st-btn " + (activeTab === "upload" ? "primary" : "ghost")}
            style={{ fontSize: 11, padding: "4px 12px", borderRadius: 16, whiteSpace: "nowrap", marginLeft: "auto", flexShrink: 0 }}
          >
            ⬆ Import Files {uploadQueue.length > 0 ? `(${uploadQueue.length})` : ""}
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
          {activeTab === "upload" ? (
            <UploadTab
              queue={uploadQueue}
              draggingOver={draggingOver}
              uploading={uploading}
              category={uploadCategory}
              categories={categories}
              fileInputRef={fileInputRef}
              onDragOver={(e) => { e.preventDefault(); setDraggingOver(true); }}
              onDragLeave={() => setDraggingOver(false)}
              onDrop={(e) => { e.preventDefault(); setDraggingOver(false); pickFiles(e.dataTransfer.files); }}
              onFileInput={(e) => pickFiles(e.target.files)}
              onRemove={removeFromQueue}
              onAdd={handleAddToTimeline}
              onBrowse={() => fileInputRef.current?.click()}
              onCategoryChange={setUploadCategory}
            />
          ) : loading ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--ink-2)" }}>
              Loading overlays library...
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 16 }}>
              {/* Stock Items */}
              {filteredStock.map((item) => {
                const videoUrl = `/api/overlays/file?category=${encodeURIComponent(item.category)}&name=${encodeURIComponent(item.fileName)}`;
                const isImporting = importingFile === item.fileName;
                return (
                  <OverlayCard
                    key={`${item.category}-${item.fileName}`}
                    title={item.fileName}
                    category={item.category}
                    videoUrl={videoUrl}
                    blendMode={item.suggestedBlend}
                    isImporting={isImporting}
                    onSelect={() => {
                      setImportingFile(item.fileName);
                      onImportStockOverlay(item.category, item.fileName, item.suggestedBlend)
                        .finally(() => { setImportingFile(null); onClose(); });
                    }}
                  />
                );
              })}

              {/* Project Clips */}
              {showProjectClips && clips.map((c) => {
                const usedInBeat = cut.beats.some((b) => b.clipId === c.id);
                const src = c.normalized ?? c.file;
                const blobUrl = src ? URL.createObjectURL(src) : undefined;
                const isBlend = c.name.toLowerCase().includes("overlay") || c.name.toLowerCase().includes("leak");
                const suggestedBlend: OverlayBlendMode = isBlend ? "screen" : "normal";
                return (
                  <OverlayCard
                    key={`project-${c.id}`}
                    title={c.name}
                    category={usedInBeat ? "In Beat Cut" : "Project Footage"}
                    videoUrl={blobUrl}
                    blendMode={suggestedBlend}
                    isProjectClip
                    onSelect={() => { onSelectClip(c, suggestedBlend); onClose(); }}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Upload Tab ──────────────────────────────────────────────────────────────

interface UploadTabProps {
  queue: File[];
  draggingOver: boolean;
  uploading: boolean;
  category: string;
  categories: string[];
  fileInputRef: React.RefObject<HTMLInputElement>;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onFileInput: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemove: (idx: number) => void;
  onAdd: () => void;
  onBrowse: () => void;
  onCategoryChange: (cat: string) => void;
}

function UploadTab({ queue, draggingOver, uploading, category, categories, fileInputRef, onDragOver, onDragLeave, onDrop, onFileInput, onRemove, onAdd, onBrowse, onCategoryChange }: UploadTabProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 560, margin: "0 auto" }}>
      {/* Drop Zone */}
      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={onBrowse}
        style={{
          border: `2px dashed ${draggingOver ? "var(--accent)" : "var(--line)"}`,
          borderRadius: 12,
          padding: "36px 24px",
          textAlign: "center",
          background: draggingOver ? "rgba(255,179,57,0.06)" : "var(--panel-2)",
          cursor: "pointer",
          transition: "border-color 0.15s, background 0.15s",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 10,
        }}
      >
        <span style={{ fontSize: 36, lineHeight: 1 }}>🎬</span>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)", marginBottom: 4 }}>
            {draggingOver ? "Drop to import" : "Drag & drop overlay videos here"}
          </div>
          <div style={{ fontSize: 12, color: "var(--ink-2)" }}>
            or <span style={{ color: "var(--accent)", fontWeight: 600 }}>click to browse</span>
            &nbsp;· MP4, MOV, WebM, M4V
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="video/mp4,video/quicktime,video/webm,video/x-m4v,.mp4,.mov,.webm,.m4v,.avi"
          multiple
          style={{ display: "none" }}
          onChange={onFileInput}
          onClick={(e) => e.stopPropagation()}
        />
      </div>

      {/* Queue */}
      {queue.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--ink-3)" }}>
            Ready to import · {queue.length} file{queue.length !== 1 ? "s" : ""}
          </div>
          {queue.map((f, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 12px",
                background: "var(--panel-2)",
                borderRadius: 8,
                border: "1px solid var(--line)",
              }}
            >
              <span style={{ fontSize: 16 }}>🎞️</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {f.name}
                </div>
                <div style={{ fontSize: 10, color: "var(--ink-3)" }}>
                  {(f.size / (1024 * 1024)).toFixed(1)} MB
                </div>
              </div>
              <button
                type="button"
                className="st-btn ghost"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onRemove(i)}
                style={{ padding: "2px 7px", fontSize: 12, color: "var(--ink-3)", flexShrink: 0 }}
                title="Remove from queue"
              >
                ✕
              </button>
            </div>
          ))}

          {/* Category picker */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "var(--panel-3)", borderRadius: 8, border: "1px solid var(--line)" }}>
            <span style={{ fontSize: 11, color: "var(--ink-2)", whiteSpace: "nowrap" }}>Save to folder:</span>
            <select
              value={category}
              onChange={(e) => onCategoryChange(e.target.value)}
              style={{ flex: 1, background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: 6, color: "var(--ink)", fontSize: 12, padding: "4px 8px", outline: "none" }}
            >
              <option value="uploads">uploads (default)</option>
              {categories.filter((c) => c !== "uploads").map((c) => (
                <option key={c} value={c}>{c.replace(/-/g, " ")}</option>
              ))}
            </select>
          </div>

          <button
            type="button"
            className="st-btn primary"
            onClick={onAdd}
            disabled={uploading}
            style={{ marginTop: 4, padding: "10px 0", fontSize: 13, fontWeight: 600, justifyContent: "center" }}
          >
            {uploading
              ? "Importing…"
              : `⬆ Add ${queue.length} file${queue.length !== 1 ? "s" : ""} to Timeline`}
          </button>
        </div>
      )}

      {queue.length === 0 && (
        <div style={{ textAlign: "center", color: "var(--ink-3)", fontSize: 12, padding: "8px 0" }}>
          Imported overlays are immediately available as overlay clips on the timeline.
        </div>
      )}
    </div>
  );
}

// ── OverlayCard ────────────────────────────────────────────────────────────

interface OverlayCardProps {
  title: string;
  category: string;
  videoUrl?: string;
  blendMode: OverlayBlendMode;
  isProjectClip?: boolean;
  isImporting?: boolean;
  onSelect: () => void;
}

function OverlayCard({ title, category, videoUrl, blendMode, isProjectClip, isImporting, onSelect }: OverlayCardProps) {
  const [hovered, setHovered] = useState(false);

  const blendBadgeColor =
    blendMode === "screen"
      ? { bg: "rgba(255, 179, 57, 0.2)", border: "var(--accent)", text: "var(--accent)" }
      : blendMode === "multiply"
      ? { bg: "rgba(180, 100, 255, 0.2)", border: "#b464ff", text: "#b464ff" }
      : { bg: "rgba(57, 180, 255, 0.2)", border: "#39b4ff", text: "#39b4ff" };

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onSelect}
      style={{
        background: "var(--panel-2)",
        borderRadius: 10,
        border: `1px solid ${hovered ? "var(--accent)" : "var(--line)"}`,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        cursor: "pointer",
        transition: "transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease",
        transform: hovered ? "translateY(-3px)" : "none",
        boxShadow: hovered ? "0 8px 24px rgba(0,0,0,0.4)" : "none",
      }}
    >
      {/* Thumbnail */}
      <div
        style={{
          height: 120,
          position: "relative",
          background: "var(--bg)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        {videoUrl && hovered ? (
          <video src={videoUrl} autoPlay loop muted playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              background: isProjectClip
                ? "linear-gradient(135deg, var(--panel-3) 0%, var(--panel-2) 100%)"
                : "linear-gradient(135deg, #2a1b3d 0%, #110e24 100%)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
            }}
          >
            <span style={{ fontSize: 24, opacity: 0.8 }}>
              {isProjectClip ? "🎬" : category.includes("light") ? "✨" : category.includes("grain") ? "🎞️" : "⚡"}
            </span>
            <span style={{ fontSize: 10, color: "var(--ink-2)", textTransform: "uppercase", letterSpacing: 0.5 }}>
              Hover to preview
            </span>
          </div>
        )}

        {/* Blend badge */}
        <div
          style={{
            position: "absolute",
            top: 6,
            right: 6,
            background: blendBadgeColor.bg,
            border: `1px solid ${blendBadgeColor.border}`,
            color: blendBadgeColor.text,
            fontSize: 9,
            fontWeight: 700,
            padding: "2px 6px",
            borderRadius: 4,
            textTransform: "uppercase",
            backdropFilter: "blur(4px)",
          }}
        >
          {blendMode}
        </div>
      </div>

      {/* Info */}
      <div style={{ padding: 12, flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
        <div>
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "var(--ink)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              marginBottom: 4,
            }}
            title={title}
          >
            {title}
          </div>
          <div style={{ fontSize: 10, color: "var(--ink-2)", textTransform: "capitalize" }}>{category}</div>
        </div>

        <button
          type="button"
          disabled={isImporting}
          className="st-btn primary"
          style={{
            marginTop: 10,
            width: "100%",
            fontSize: 11,
            padding: "5px 8px",
            justifyContent: "center",
            gap: 4,
            background: hovered ? "var(--accent)" : "var(--panel-3)",
            color: hovered ? "var(--accent-ink)" : "var(--ink)",
            border: "none",
          }}
        >
          {isImporting ? "Importing..." : "+ Add to Timeline"}
        </button>
      </div>
    </div>
  );
}
