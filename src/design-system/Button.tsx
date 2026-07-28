import type { ButtonHTMLAttributes, ReactNode } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "quiet";
  size?: "small" | "default";
  icon?: ReactNode;
}

export default function Button({
  variant = "secondary",
  size = "default",
  icon,
  className = "",
  children,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`ui-button ${variant}${size === "small" ? " small" : ""}${className ? ` ${className}` : ""}`}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}
