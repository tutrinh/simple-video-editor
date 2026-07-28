import type { InputHTMLAttributes } from "react";

export default function InlineTextField({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input type="text" className={`ui-inline-text${className ? ` ${className}` : ""}`} {...props} />;
}
