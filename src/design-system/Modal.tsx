import { useEffect, type CSSProperties, type ReactNode } from "react";
import CloseButton from "./CloseButton";

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  description?: string;
  footer?: ReactNode;
  headerMeta?: ReactNode;
  maxWidth?: number;
  emphasis?: "neutral" | "signal";
  ariaLabel?: string;
}

export default function Modal({
  open,
  title,
  onClose,
  children,
  description,
  footer,
  headerMeta,
  maxWidth = 520,
  emphasis = "neutral",
  ariaLabel,
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="ui-modal-scrim" onMouseDown={onClose}>
      <section
        className={`ui-modal${emphasis === "signal" ? " signal" : ""}`}
        style={{ "--ui-modal-width": `${maxWidth}px` } as CSSProperties}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel ?? title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="ui-modal-head">
          <div className="ui-modal-heading">
            <h2>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          {headerMeta && <div className="ui-modal-meta">{headerMeta}</div>}
          <CloseButton onClick={onClose} />
        </header>
        <div className="ui-modal-body">{children}</div>
        {footer && <footer className="ui-modal-footer">{footer}</footer>}
      </section>
    </div>
  );
}
