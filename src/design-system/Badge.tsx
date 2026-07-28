import type { HTMLAttributes, ReactNode } from "react";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: "neutral" | "signal" | "positive" | "critical";
  children: ReactNode;
}

export default function Badge({ tone = "neutral", className = "", children, ...props }: BadgeProps) {
  return <span className={`ui-badge ${tone}${className ? ` ${className}` : ""}`} {...props}>{children}</span>;
}
