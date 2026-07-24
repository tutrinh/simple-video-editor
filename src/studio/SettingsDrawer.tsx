import { useEffect } from "react";

/**
 * Slide-over side panel for workspace settings. Mounted only while open.
 * AI options (engine, model, tone, script type) now live in the ✨ AI Story drawer.
 */
export default function SettingsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <>
      <div className={`st-drawer-scrim ${open ? "open" : ""}`} onClick={onClose} />
      <aside className={`st-settings-drawer ${open ? "open" : ""}`} role="dialog" aria-label="Settings" aria-hidden={!open}>
        <div className="st-drawer-head">
          <h2>Settings</h2>
          <button className="x" onClick={onClose} title="Close (Esc)">×</button>
        </div>
        <div className="st-settings-body">
          <div className="st-setting-row">
            <div className="st-setting-text">
              <div className="st-setting-name">AI options moved</div>
              <div className="st-setting-desc">
                Engine, model, tone, and script type now live in the ✨ AI Story panel (top bar).
              </div>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
