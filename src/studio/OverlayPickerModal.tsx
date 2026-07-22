import { useEffect, useState } from "react";
import type { Clip, Cut, OverlayBlendMode } from "../domain/types";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  cut: Cut;
  clips: Clip[];
  onSelectClip: (clip: Clip, blendMode: OverlayBlendMode) => void;
  onImportStockOverlay: (category: string, fileName: string, blendMode: OverlayBlendMode) => Promise<void>;
}

interface StockFile {
  category: string;
  fileName: string;
  suggestedBlend: OverlayBlendMode;
}

export default function OverlayPickerModal({
  isOpen,
  onClose,
  cut,
  clips,
  onSelectClip,
  onImportStockOverlay,
}: Props) {
  const [activeTab, setActiveTab] = useState<string>("all");
  const [loading, setLoading] = useState(false);
  const [stockItems, setStockItems] = useState<StockFile[]>([]);
  const [importingFile, setImportingFile] = useState<string | null>(null);

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
            items.push({
              category: cat.category,
              fileName: f,
              suggestedBlend,
            });
          }
        }
        setStockItems(items);
      })
      .catch(() => setStockItems([]))
      .finally(() => setLoading(false));
  }, [isOpen]);

  if (!isOpen) return null;

  const categories = Array.from(new Set(stockItems.map((i) => i.category)));
  const filteredStock = activeTab === "all"
    ? stockItems
    : activeTab === "project"
    ? []
    : stockItems.filter((i) => i.category === activeTab);

  const showProjectClips = activeTab === "all" || activeTab === "project";

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
          background: "var(--panel-1, #18191c)",
          boxShadow: "0 20px 50px rgba(0,0,0,0.5)",
          border: "1px solid var(--line, #333)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid var(--line, #2a2b30)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "var(--panel-2, #202125)",
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--accent, #ffb339)", display: "flex", alignItems: "center", gap: 8 }}>
              <span>✨ Stock Overlays & B-Roll Library</span>
            </h3>
            <p style={{ margin: "2px 0 0 0", fontSize: 11, color: "var(--ink-2, #888)" }}>
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
            background: "var(--panel-3, #151619)",
            borderBottom: "1px solid var(--line, #2a2b30)",
            display: "flex",
            gap: 6,
            overflowX: "auto",
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            onClick={() => setActiveTab("all")}
            className={"st-btn " + (activeTab === "all" ? "primary" : "ghost")}
            style={{ fontSize: 11, padding: "4px 12px", borderRadius: 16 }}
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
                style={{ fontSize: 11, padding: "4px 12px", borderRadius: 16, textTransform: "capitalize" }}
              >
                {icon} {cat.replace(/-/g, " ")} ({count})
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => setActiveTab("project")}
            className={"st-btn " + (activeTab === "project" ? "primary" : "ghost")}
            style={{ fontSize: 11, padding: "4px 12px", borderRadius: 16 }}
          >
            📁 Project Footage ({clips.length})
          </button>
        </div>

        {/* Modal Body / Grid */}
        <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
          {loading ? (
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
                        .finally(() => {
                          setImportingFile(null);
                          onClose();
                        });
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
                    onSelect={() => {
                      onSelectClip(c, suggestedBlend);
                      onClose();
                    }}
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

interface OverlayCardProps {
  title: string;
  category: string;
  videoUrl?: string;
  blendMode: OverlayBlendMode;
  isProjectClip?: boolean;
  isImporting?: boolean;
  onSelect: () => void;
}

function OverlayCard({
  title,
  category,
  videoUrl,
  blendMode,
  isProjectClip,
  isImporting,
  onSelect,
}: OverlayCardProps) {
  const [hovered, setHovered] = useState(false);

  const blendBadgeColor = blendMode === "screen"
    ? { bg: "rgba(255, 179, 57, 0.2)", border: "#ffb339", text: "#ffb339" }
    : blendMode === "multiply"
    ? { bg: "rgba(180, 100, 255, 0.2)", border: "#b464ff", text: "#b464ff" }
    : { bg: "rgba(57, 180, 255, 0.2)", border: "#39b4ff", text: "#39b4ff" };

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onSelect}
      style={{
        background: "var(--panel-2, #202125)",
        borderRadius: 10,
        border: "1px solid var(--line, #333)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        cursor: "pointer",
        transition: "transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease",
        transform: hovered ? "translateY(-3px)" : "none",
        borderColor: hovered ? "var(--accent, #ffb339)" : "var(--line, #333)",
        boxShadow: hovered ? "0 8px 24px rgba(0,0,0,0.4)" : "none",
      }}
    >
      {/* Thumbnail / Video Container */}
      <div
        style={{
          height: 120,
          position: "relative",
          background: "#000",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        {videoUrl && hovered ? (
          <video
            src={videoUrl}
            autoPlay
            loop
            muted
            playsInline
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              background: isProjectClip
                ? "linear-gradient(135deg, #1e293b 0%, #0f172a 100%)"
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
            <span style={{ fontSize: 10, color: "var(--ink-2, #aaa)", textTransform: "uppercase", letterSpacing: 0.5 }}>
              Hover to preview
            </span>
          </div>
        )}

        {/* Blend Mode Badge */}
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

      {/* Card Info & Action */}
      <div style={{ padding: 12, flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
        <div>
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "var(--ink, #fff)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              marginBottom: 4,
            }}
            title={title}
          >
            {title}
          </div>
          <div style={{ fontSize: 10, color: "var(--ink-2, #888)", textTransform: "capitalize" }}>
            {category}
          </div>
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
            background: hovered ? "var(--accent, #ffb339)" : "var(--panel-3, #2a2b30)",
            color: hovered ? "#111" : "var(--ink, #fff)",
            border: "none",
          }}
        >
          {isImporting ? "Importing..." : "+ Add to Timeline"}
        </button>
      </div>
    </div>
  );
}
