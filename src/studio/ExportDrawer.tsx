import { useEffect, useRef } from "react";
import ExportView from "../features/export/ExportView";
import Drawer from "../design-system/Drawer";
import { pauseExportDrawerMedia } from "./exportDrawerPlayback";

/**
 * Slide-over drawer that hosts the Export flow. It stays MOUNTED once created and
 * toggles open/closed via the `open` prop (CSS transition), so ExportView keeps
 * all of its state — the generated video, expanded sections, active layer, even
 * an in-progress export — when you close and reopen it.
 */
export default function ExportDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) pauseExportDrawerMedia(contentRef.current);
  }, [open]);

  return (
    <Drawer open={open} title="Export" onClose={onClose} width="full" bodyClassName="st-drawer-body">
      <div ref={contentRef} style={{ width: "100%", height: "100%" }}>
        <ExportView active={open} />
      </div>
    </Drawer>
  );
}
