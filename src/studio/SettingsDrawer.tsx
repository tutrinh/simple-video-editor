import { useEffect } from "react";
import { useSettings } from "../state/SettingsContext";
import Switch from "./Switch";

/**
 * Slide-over side panel for workspace settings. Mounted only while open.
 * Currently hosts the toggle for showing/hiding the AI Story bar (Step 2).
 */
export default function SettingsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { settings, update } = useSettings();

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
              <div className="st-setting-name">Show AI story bar</div>
              <div className="st-setting-desc">Show the "Author Story &amp; Script" bar (Step 2) below the timeline.</div>
            </div>
            <Switch
              checked={settings.showStoryBar}
              onChange={(next) => update({ showStoryBar: next })}
              label="Show AI story bar"
            />
          </div>
        </div>
      </aside>
    </>
  );
}
