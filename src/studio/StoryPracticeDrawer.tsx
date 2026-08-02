import { useEffect } from "react";
import CloseButton from "../design-system/CloseButton";
import StoryPracticeView from "./StoryPracticeView";

export default function StoryPracticeDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  return (
    <aside className="st-col product-review story-practice-drawer" role="region" aria-label="Storytelling Practice" aria-hidden={!open}>
      <div className="st-product-review-head">
        <h2>Storytelling Practice</h2>
        <CloseButton onClick={onClose} label="Close Storytelling Practice panel" />
      </div>
      <div className="st-product-review-body no-scrollbar"><StoryPracticeView /></div>
    </aside>
  );
}
