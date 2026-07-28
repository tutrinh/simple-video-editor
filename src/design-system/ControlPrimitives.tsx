import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

export const ControlButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(function ControlButton(
  { className = "", type = "button", ...props },
  ref,
) {
  return <button ref={ref} type={type} className={`ui-control-button${className ? ` ${className}` : ""}`} {...props} />;
});

export const InputControl = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function InputControl(
  { className = "", ...props },
  ref,
) {
  return <input ref={ref} className={`ui-input-control${className ? ` ${className}` : ""}`} {...props} />;
});

export const SelectControl = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function SelectControl(
  { className = "", ...props },
  ref,
) {
  return <select ref={ref} className={`ui-select-control ui-control${className ? ` ${className}` : ""}`} {...props} />;
});

export const TextareaControl = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function TextareaControl(
  { className = "", ...props },
  ref,
) {
  return <textarea ref={ref} className={`ui-textarea-control${className ? ` ${className}` : ""}`} {...props} />;
});
