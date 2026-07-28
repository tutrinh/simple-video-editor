import { useState, useEffect } from "react";
import { useProject } from "../state/ProjectContext";
import {
  listSavedProjects,
  loadProjectFromStorage,
  deleteProjectFromStorage,
  loadAllTemplates,
  deleteTemplate,
  type SavedProjectMeta,
} from "../lib/projectStorage";
import { exportProjectFile, importProjectFile } from "../lib/projectPackager";
import InspirationUploadModal from "./InspirationUploadModal";
import TemplateApplyModal from "./TemplateApplyModal";
import TemplateDetails from "./TemplateDetails";
import type { ProjectTemplate } from "../domain/types";
import { useExportSettings } from "../state/ExportSettingsContext";
import { ControlButton, InputControl } from "../design-system/ControlPrimitives";
import { ModalScrim, ModalSurface } from "../design-system/ModalPrimitives";
import CloseButton from "../design-system/CloseButton";


interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export default function ProjectManagerModal({ isOpen, onClose }: Props) {
  const { state, dispatch } = useProject();
  const { reset: resetExport } = useExportSettings();
  const [activeTab, setActiveTab] = useState<"projects" | "templates">("projects");
  const [projects, setProjects] = useState<SavedProjectMeta[]>([]);
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SavedProjectMeta | null>(null);
  const [deleteTemplateTarget, setDeleteTemplateTarget] = useState<ProjectTemplate | null>(null);
  const [applyTemplateTarget, setApplyTemplateTarget] = useState<ProjectTemplate | null>(null);
  const [expandedTemplateId, setExpandedTemplateId] = useState<string | null>(null);
  const [showInspirationModal, setShowInspirationModal] = useState(false);

  useEffect(() => {
    if (isOpen) {
      refreshProjects();
      refreshTemplates();
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

  const refreshTemplates = async () => {
    try {
      const list = await loadAllTemplates();
      setTemplates(list);
    } catch (err) {
      console.error("Failed to list templates:", err);
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
        resetExport();
        onClose();
      } else {
        await refreshProjects();
      }
    } catch (err) {
      console.error("Failed to delete project:", err);
    }
  };

  const handleDeleteTemplateConfirm = async () => {
    if (!deleteTemplateTarget) return;
    try {
      await deleteTemplate(deleteTemplateTarget.id);
      setDeleteTemplateTarget(null);
      await refreshTemplates();
    } catch (err) {
      console.error("Failed to delete template:", err);
    }
  };

  const handleNewProject = () => {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem("simple_editor_active_project_id");
    }
    dispatch({ type: "RESET" });
    resetExport();
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
    <ModalScrim
      onClick={onClose}
      style={{ zIndex: 1000 }}
    >
      <ModalSurface
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(680px, 100%)",
          maxHeight: "85vh",
        }}
      >
        <header className="ui-modal-head">
          <div className="ui-modal-heading">
            <h2>Projects &amp; Templates</h2>
            <p>
              Manage your saved projects and reusable video templates.
            </p>
          </div>
          <CloseButton onClick={onClose} label="Close projects and templates" />
        </header>

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid var(--line)", flexShrink: 0 }}>
          {(["projects", "templates"] as const).map((tab) => (
            <ControlButton
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                flex: 1,
                padding: "10px 0",
                background: "none",
                border: "none",
                borderBottom: activeTab === tab ? "2px solid var(--accent)" : "2px solid transparent",
                color: activeTab === tab ? "var(--accent)" : "var(--ink-2)",
                fontWeight: activeTab === tab ? 700 : 400,
                fontSize: 12,
                cursor: "pointer",
                transition: "color 0.15s",
                textTransform: "capitalize",
              }}
            >
              {tab === "projects" ? `My Projects (${projects.length})` : `Templates (${templates.length})`}
            </ControlButton>
          ))}
        </div>

        {/* ── PROJECTS TAB ── */}
        {activeTab === "projects" && (
          <>
            {/* Action Toolbar */}
            <div
              style={{
                padding: "10px 18px",
                background: "var(--panel)",
                borderBottom: "1px solid var(--line)",
                display: "flex",
                gap: 10,
                alignItems: "center",
                flexShrink: 0,
              }}
            >
              <ControlButton
                className="st-btn primary"
                style={{ fontSize: 11, padding: "5px 12px" }}
                onClick={handleNewProject}
                title="Start a fresh, new video project"
              >
                New Project
              </ControlButton>

              <ControlButton
                className="st-btn ghost"
                style={{ fontSize: 11, padding: "5px 12px" }}
                onClick={handleExportCurrent}
                disabled={exporting || state.clips.length === 0}
                title="Download current editing session as a portable .vidstr project file"
              >
                {exporting ? "Packaging..." : "Export Package"}
              </ControlButton>

              <label
                className="st-btn ghost"
                style={{ fontSize: 11, padding: "5px 12px", cursor: "pointer", display: "inline-flex", alignItems: "center" }}
                title="Import a previously saved .vidstr project file"
              >
                {importing ? "Importing..." : "Import .vidstr File"}
                <InputControl type="file" accept=".vidstr,.json" onChange={handleImportFile} style={{ display: "none" }} />
              </label>
            </div>

            {/* Saved Projects List */}
            <div style={{ padding: 18, overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
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
                        border: isActive ? "1px solid var(--accent)" : "1px solid var(--line)",
                        borderRadius: 8,
                        padding: "12px 16px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                      }}
                    >
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)" }}>{p.title}</span>
                          {isActive && (
                            <span className="ui-badge positive">
                              Currently editing
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
                        {!isActive && (
                          <ControlButton
                            className="st-btn primary"
                            style={{ fontSize: 11, padding: "4px 10px" }}
                            onClick={() => handleLoad(p.id)}
                          >
                            Load Project
                          </ControlButton>
                        )}
                        <ControlButton
                          className="st-btn ghost"
                          style={{ fontSize: 11, padding: "4px 8px", borderColor: "var(--danger)", color: "var(--danger)" }}
                          onClick={() => setDeleteTarget(p)}
                        >
                          Delete
                        </ControlButton>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}

        {/* ── TEMPLATES TAB ── */}
        {activeTab === "templates" && (
          <>
            <div
              style={{
                padding: "10px 18px",
                background: "var(--panel)",
                borderBottom: "1px solid var(--line)",
                display: "flex",
                gap: 10,
                alignItems: "center",
                flexShrink: 0,
              }}
            >
              <ControlButton
                className="st-btn primary"
                style={{ fontSize: 11, padding: "5px 12px" }}
                onClick={() => setShowInspirationModal(true)}
                title="Upload a reference video and let Claude extract its edit structure as a template"
              >
                Create from Inspiration Video
              </ControlButton>
            </div>

            <div style={{ padding: 18, overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
              {templates.length === 0 ? (
                <div style={{ textAlign: "center", padding: "40px 24px", color: "var(--ink-3)", fontSize: 13 }}>
                  No templates saved yet.
                  <br />
                  <span style={{ fontSize: 11, marginTop: 6, display: "block" }}>
                    Upload an inspiration video to extract a reusable edit structure.
                  </span>
                </div>
              ) : (
                templates.map((t) => (
                  <div
                    key={t.id}
                    style={{
                      background: "var(--panel)",
                      border: "1px solid var(--line)",
                      borderRadius: 8,
                      padding: "12px 16px",
                      display: "flex",
                      flexWrap: "wrap",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>{t.name}</div>
                      {t.description && (
                        <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 2 }}>{t.description}</div>
                      )}
                      <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 10, padding: "2px 8px", background: "var(--panel-3)", borderRadius: 999, color: "var(--ink-2)", border: "1px solid var(--line)" }}>
                          {t.beats.length} beats
                        </span>
                        {t.aspect && (
                          <span style={{ fontSize: 10, padding: "2px 8px", background: "var(--panel-3)", borderRadius: 999, color: "var(--ink-2)", border: "1px solid var(--line)" }}>
                            {t.aspect}
                          </span>
                        )}
                        {t.toneHint && (
                          <span style={{ fontSize: 10, padding: "2px 8px", background: "color-mix(in srgb, var(--accent) 12%, transparent)", borderRadius: 999, color: "var(--accent)", border: "1px solid color-mix(in srgb, var(--accent) 30%, transparent)" }}>
                            {t.toneHint}
                          </span>
                        )}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                      <ControlButton
                        className="st-btn ghost"
                        style={{ fontSize: 11, padding: "4px 8px" }}
                        aria-expanded={expandedTemplateId === t.id}
                        onClick={() => setExpandedTemplateId((id) => id === t.id ? null : t.id)}
                      >
                        {expandedTemplateId === t.id ? "Hide Details" : "View Details"}
                      </ControlButton>
                      <ControlButton
                        className="st-btn primary"
                        style={{ fontSize: 11, padding: "4px 10px" }}
                        onClick={() => setApplyTemplateTarget(t)}
                      >
                        Use Template
                      </ControlButton>
                      <ControlButton
                        className="st-btn ghost"
                        style={{ fontSize: 11, padding: "4px 8px", borderColor: "var(--danger)", color: "var(--danger)" }}
                        onClick={() => setDeleteTemplateTarget(t)}
                      >
                        Delete
                      </ControlButton>
                    </div>
                    {expandedTemplateId === t.id && (
                      <div style={{ flexBasis: "100%", width: "100%", borderTop: "1px solid var(--line)", paddingTop: 12, marginTop: 2 }}>
                        <TemplateDetails template={t} compact />
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </ModalSurface>

      {/* Delete Project Confirmation */}
      {deleteTarget && (
        <ModalScrim
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
          <ModalSurface
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
              <ControlButton className="st-btn ghost" style={{ flex: 1, justifyContent: "center" }} onClick={() => setDeleteTarget(null)}>
                Cancel
              </ControlButton>
              <ControlButton className="st-btn danger" style={{ flex: 1, justifyContent: "center" }} onClick={handleDeleteConfirm}>
                Delete
              </ControlButton>
            </div>
          </ModalSurface>
        </ModalScrim>
      )}

      {/* Delete Template Confirmation */}
      {deleteTemplateTarget && (
        <ModalScrim
          className="st-modal-scrim"
          onClick={() => setDeleteTemplateTarget(null)}
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
          <ModalSurface
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
              Delete Template?
            </h4>
            <p style={{ margin: 0, fontSize: 12, color: "var(--ink-2)" }}>
              Are you sure you want to delete <strong>"{deleteTemplateTarget.name}"</strong>? This cannot be undone.
            </p>
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <ControlButton className="st-btn ghost" style={{ flex: 1, justifyContent: "center" }} onClick={() => setDeleteTemplateTarget(null)}>
                Cancel
              </ControlButton>
              <ControlButton className="st-btn danger" style={{ flex: 1, justifyContent: "center" }} onClick={handleDeleteTemplateConfirm}>
                Delete
              </ControlButton>
            </div>
          </ModalSurface>
        </ModalScrim>
      )}

      {/* Inspiration Upload Modal */}
      <InspirationUploadModal
        isOpen={showInspirationModal}
        onClose={() => setShowInspirationModal(false)}
        onSaved={async () => {
          setShowInspirationModal(false);
          await refreshTemplates();
          setActiveTab("templates");
        }}
      />
      {applyTemplateTarget && (
        <TemplateApplyModal
          template={applyTemplateTarget}
          clips={state.clips}
          onClose={() => setApplyTemplateTarget(null)}
          onApplied={() => {
            setApplyTemplateTarget(null);
            onClose();
          }}
        />
      )}
    </ModalScrim>
  );
}
