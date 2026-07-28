import { useEffect } from "react";
import AiStoryView from "./AiStoryView";
import CloseButton from "../design-system/CloseButton";

/**
 * AI Story side panel — a docked column on the right (inspector width) that PUSHES
 * the stage/inspector rather than overlaying them. It's rendered as the 4th child
 * of `.st-main`; the grid's 4th track animates 0 → 500px via `.st-main.ai-open`
 * (see studio.css), so opening/closing slides the layout instead of covering it.
 * Stays mounted once opened so its state survives close/reopen.
 */
export default function AiStoryDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <aside className="st-col aistory" role="region" aria-label="AI Story" aria-hidden={!open}>
      <div className="st-aistory-head">
        <h2>✨ AI Story</h2>
        <CloseButton onClick={onClose} label="Close AI Story panel" />
      </div>
      <div className="st-aistory-body no-scrollbar">
        <AiStoryView />
      </div>
    </aside>
  );
}
