import { useState, useEffect } from "react";
import { useProject } from "../state/ProjectContext";
import {
  listSavedProjects,
  loadProjectFromStorage,
  deleteProjectFromStorage,
  type SavedProjectMeta,
} from "../lib/projectStorage";
import { exportProjectFile, importProjectFile } from "../lib/projectPackager";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export default function ProjectManagerModal({ isOpen, onClose }: Props) {
  const { state, dispatch } = useProject();
  const [projects, setProjects] = useState<SavedProjectMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SavedProjectMeta | null>(null);

  useEffect(() => {
    if (isOpen) {
      refreshProjects();
    }
  }, [isOpen]);

  const refreshProjects = async () => {
    setLoading(true);
    try {
      const list = await listSavedProjects();
      setProjects(list);
    } catch (err) {
      console.error("Failed to list saved projects:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleLoad = async (id: string) => {
    setLoading(true);
    try {
      const loaded = await loadProjectFromStorage(id);
      if (loaded) {
        dispatch({ type: "LOAD_PROJECT", state: loaded });
        onClose();
      }
    } catch (err) {
      console.error("Failed to load project:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    try {
      const activeId = typeof localStorage !== "undefined" ? localStorage.getItem("simple_editor_active_project_id") : null;
      const isDeletingActive = activeId === deleteTarget.id;

      await deleteProjectFromStorage(deleteTarget.id);
      setDeleteTarget(null);

      if (isDeletingActive) {
        dispatch({ type: "RESET" });
        onClose();
      } else {
        await refreshProjects();
      }
    } catch (err) {
      console.error("Failed to delete project:", err);
    }
  };

  const handleNewProject = () => {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem("simple_editor_active_project_id");
    }
    dispatch({ type: "RESET" });
    onClose();
  };

  const handleExportCurrent = async () => {
    if (!state.clips || state.clips.length === 0) return;
    setExporting(true);
    try {
      await exportProjectFile(state);
    } catch (err) {
      console.error("Failed to export project package:", err);
    } finally {
      setExporting(false);
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    try {
      const importedState = await importProjectFile(file);
      dispatch({ type: "LOAD_PROJECT", state: importedState });
      onClose();
    } catch (err) {
      console.error("Failed to import project file:", err);
      alert("Could not import project. Please ensure it is a valid .vidstr project package file.");
    } finally {
      setImporting(false);
      e.target.value = "";
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="st-modal-scrim"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.65)",
        backdropFilter: "blur(4px)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        className="st-modal-card"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--panel-2)",
          border: "1px solid var(--line)",
          borderRadius: 14,
          width: "100%",
          maxWidth: 680,
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 24px 60px rgba(0,0,0,0.7)",
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid var(--line)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--ink)" }}>💾 My Saved Projects</h3>
            <p style={{ margin: "2px 0 0 0", fontSize: 12, color: "var(--ink-2)" }}>
              Auto-saved browser drafts and standalone .vidstr project files.
            </p>
          </div>
          <button className="st-btn ghost" style={{ padding: "4px 8px", fontSize: 12 }} onClick={onClose}>
            ✕ Close
          </button>
        </div>

        {/* Action Toolbar */}
        <div
          style={{
            padding: "12px 20px",
            background: "var(--panel-3)",
            borderBottom: "1px solid var(--line)",
            display: "flex",
            gap: 10,
            alignItems: "center",
          }}
        >
          <button
            className="st-btn primary"
            style={{ fontSize: 11, padding: "5px 12px" }}
            onClick={handleNewProject}
            title="Start a fresh, new video project"
          >
            ✨ + New Project
          </button>

          <button
            className="st-btn ghost"
            style={{ fontSize: 11, padding: "5px 12px" }}
            onClick={handleExportCurrent}
            disabled={exporting || state.clips.length === 0}
            title="Download current editing session as a portable .vidstr project file"
          >
            {exporting ? "Packaging..." : "📦 Export Package"}
          </button>

          <label
            className="st-btn ghost"
            style={{ fontSize: 11, padding: "5px 12px", cursor: "pointer", display: "inline-flex", alignItems: "center" }}
            title="Import a previously saved .vidstr project file"
          >
            {importing ? "Importing..." : "📂 Import .vidstr File"}
            <input type="file" accept=".vidstr,.json" onChange={handleImportFile} style={{ display: "none" }} />
          </label>
        </div>

        {/* Saved Projects List */}
        <div style={{ padding: 20, overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
          {loading && projects.length === 0 ? (
            <div style={{ textAlign: "center", padding: 30, color: "var(--ink-3)", fontSize: 12 }}>
              Loading saved projects...
            </div>
          ) : projects.length === 0 ? (
            <div style={{ textAlign: "center", padding: 40, color: "var(--ink-3)", fontSize: 13 }}>
              No saved project drafts found in browser storage.
              <br />
              <span style={{ fontSize: 11, marginTop: 4, display: "block" }}>
                As you edit, projects automatically save here.
              </span>
            </div>
          ) : (
            projects.map((p) => {
              const activeId = typeof localStorage !== "undefined" ? localStorage.getItem("simple_editor_active_project_id") : null;
              const isActive = activeId === p.id && state.clips.length > 0;
              const formattedDate = new Date(p.updatedAt).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              });

              return (
                <div
                  key={p.id}
                  style={{
                    background: isActive ? "var(--panel-2)" : "var(--panel)",
                    border: isActive ? "1.5px solid var(--accent)" : "1px solid var(--line)",
                    borderRadius: 10,
                    padding: "12px 16px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    boxShadow: isActive ? "0 4px 14px rgba(0,0,0,0.25)" : "none",
                  }}
                >
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)" }}>{p.title}</span>
                      {isActive && (
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            color: "var(--accent)",
                            background: "var(--panel-3)",
                            padding: "2px 8px",
                            borderRadius: 999,
                            border: "1px solid var(--accent)",
                            letterSpacing: "0.02em",
                          }}
                        >
                          ✓ CURRENTLY EDITING
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--ink-3)",
                        marginTop: 4,
                        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
                        fontVariantNumeric: "tabular-nums",
                        letterSpacing: "-0.01em",
                      }}
                    >
                      {p.clipCount} clip{p.clipCount === 1 ? "" : "s"} · {p.beatCount} beat{p.beatCount === 1 ? "" : "s"} · Edited {formattedDate}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    {isActive ? (
                      <button
                        className="st-btn ghost"
                        style={{ fontSize: 11, padding: "4px 10px", borderColor: "var(--accent)", color: "var(--accent)", fontWeight: 600, cursor: "default" }}
                        disabled
                      >
                        ✓ Active
                      </button>
                    ) : (
                      <button
                        className="st-btn primary"
                        style={{ fontSize: 11, padding: "4px 10px" }}
                        onClick={() => handleLoad(p.id)}
                      >
                        Load Project
                      </button>
                    )}
                    <button
                      className="st-btn ghost"
                      style={{ fontSize: 11, padding: "4px 8px", borderColor: "var(--danger)", color: "var(--danger)" }}
                      onClick={() => setDeleteTarget(p)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div
          className="st-modal-scrim"
          onClick={() => setDeleteTarget(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.75)",
            backdropFilter: "blur(4px)",
            zIndex: 1100,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
        >
          <div
            className="st-modal-card"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--panel-2)",
              border: "1px solid var(--danger)",
              borderRadius: 12,
              padding: 20,
              maxWidth: 400,
              width: "100%",
              boxShadow: "0 20px 50px rgba(0,0,0,0.8)",
            }}
          >
            <h4 style={{ margin: "0 0 6px 0", fontSize: 15, fontWeight: 700, color: "var(--ink)" }}>
              Delete Saved Project?
            </h4>
            <p style={{ margin: 0, fontSize: 12, color: "var(--ink-2)" }}>
              Are you sure you want to delete <strong>"{deleteTarget.title}"</strong>? This will remove the draft from browser storage.
            </p>
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button className="st-btn ghost" style={{ flex: 1, justifyContent: "center" }} onClick={() => setDeleteTarget(null)}>
                Cancel
              </button>
              <button className="st-btn danger" style={{ flex: 1, justifyContent: "center" }} onClick={handleDeleteConfirm}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
