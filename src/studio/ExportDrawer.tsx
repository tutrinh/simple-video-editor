import { useEffect } from "react";
import ExportView from "../features/export/ExportView";

/** Slide-over drawer that hosts the existing Export flow, unchanged. */
export default function ExportDrawer({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="st-drawer-scrim" onClick={onClose} />
      <div className="st-drawer" role="dialog" aria-label="Export">
        <div className="st-drawer-head">
          <h2>Export</h2>
          <button className="x" onClick={onClose} title="Close (Esc)">×</button>
        </div>
        <div className="st-drawer-body">
          <ExportView />
        </div>
      </div>
    </>
  );
}
