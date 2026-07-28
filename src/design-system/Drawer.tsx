import { useEffect, useState, type ReactNode } from "react";
import CloseButton from "./CloseButton";

interface DrawerProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  side?: "left" | "right";
  width?: "narrow" | "full";
  bodyClassName?: string;
}

export default function Drawer({
  open,
  title,
  onClose,
  children,
  side = "right",
  width = "narrow",
  bodyClassName = "",
}: DrawerProps) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!open) {
      setShown(false);
      return;
    }
    const frame = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  return (
    <>
      <div className={`ui-drawer-scrim${shown ? " open" : ""}`} onClick={onClose} />
      <aside
        className={`ui-drawer ${side} ${width}${shown ? " open" : ""}`}
        role="dialog"
        aria-label={title}
        aria-hidden={!open}
      >
        <header className="ui-drawer-head">
          <h2>{title}</h2>
          <CloseButton onClick={onClose} />
        </header>
        <div className={`ui-drawer-body ${bodyClassName}`.trim()}>{children}</div>
      </aside>
    </>
  );
}
