import Drawer from "../design-system/Drawer";

/**
 * Slide-over side panel for workspace settings. Mounted only while open.
 * AI options (engine, model, tone, script type) now live in the ✨ AI Story drawer.
 */
export default function SettingsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Drawer open={open} title="Settings" onClose={onClose} side="left" bodyClassName="st-settings-body">
          <div className="st-setting-row">
            <div className="st-setting-text">
              <div className="st-setting-name">Design system</div>
              <div className="st-setting-desc">
                Browse foundations, controls, feedback states, and editor patterns.
              </div>
            </div>
            <a className="st-settings-link" href="/design-system">
              View system
              <span aria-hidden="true">↗</span>
            </a>
          </div>
          <div className="st-setting-row">
            <div className="st-setting-text">
              <div className="st-setting-name">AI options moved</div>
              <div className="st-setting-desc">
                Engine, model, tone, and script type now live in the ✨ AI Story panel (top bar).
              </div>
            </div>
          </div>
    </Drawer>
  );
}
