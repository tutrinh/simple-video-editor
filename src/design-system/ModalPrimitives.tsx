import { forwardRef, type HTMLAttributes } from "react";

export const ModalScrim = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function ModalScrim(
  { className = "", ...props },
  ref,
) {
  return <div ref={ref} className={`ui-modal-scrim${className ? ` ${className}` : ""}`} {...props} />;
});

export const ModalSurface = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function ModalSurface(
  { className = "", ...props },
  ref,
) {
  return <div ref={ref} className={`ui-modal ui-modal-compatible${className ? ` ${className}` : ""}`} {...props} />;
});
