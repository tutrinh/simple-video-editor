import { useEffect, useState } from "react";
import ExportView from "../features/export/ExportView";

/** Slide-over drawer that hosts the existing Export flow, with animated slide open and slide back. */
export default function ExportDrawer({ onClose }: { onClose: () => void }) {
  const [closing, setClosing] = useState(false);

  const handleClose = () => {
    if (closing) return;
    setClosing(true);
    setTimeout(() => {
      onClose();
    }, 280);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") handleClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closing]);

  return (
    <>
      <div className={`st-drawer-scrim ${closing ? "closing" : ""}`} onClick={handleClose} />
      <div className={`st-drawer ${closing ? "closing" : ""}`} role="dialog" aria-label="Export">
        <div className="st-drawer-head">
          <h2>Export</h2>
          <button className="x" onClick={handleClose} title="Close (Esc)">×</button>
        </div>
        <div className="st-drawer-body">
          <ExportView />
        </div>
      </div>
    </>
  );
}
