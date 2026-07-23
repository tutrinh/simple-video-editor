import { useEffect, useState } from "react";
import ExportView from "../features/export/ExportView";

/**
 * Slide-over drawer that hosts the Export flow. It stays MOUNTED once created and
 * toggles open/closed via the `open` prop (CSS transition), so ExportView keeps
 * all of its state — the generated video, expanded sections, active layer, even
 * an in-progress export — when you close and reopen it.
 */
export default function ExportDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Drive the `.open` CSS class one frame behind `open` so the very first open
  // (which mounts already-open) still has a closed starting frame to slide from.
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!open) { setShown(false); return; }
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <>
      <div className={`st-drawer-scrim ${shown ? "open" : ""}`} onClick={onClose} />
      <div className={`st-drawer ${shown ? "open" : ""}`} role="dialog" aria-label="Export" aria-hidden={!open}>
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
