import type { ButtonHTMLAttributes, ReactNode } from "react";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  icon: ReactNode;
  size?: "small" | "default";
  variant?: "quiet" | "selected" | "critical";
}

export default function IconButton({ label, icon, size = "default", variant = "quiet", className = "", type = "button", ...props }: IconButtonProps) {
  return (
    <button
      type={type}
      className={`ui-icon-button ${size} ${variant}${className ? ` ${className}` : ""}`}
      aria-label={label}
      title={props.title ?? label}
      {...props}
    >
      {icon}
    </button>
  );
}
