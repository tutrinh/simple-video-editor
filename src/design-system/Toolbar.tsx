import type { HTMLAttributes, ReactNode } from "react";

export default function Toolbar({ className = "", children, ...props }: HTMLAttributes<HTMLElement> & { children: ReactNode }) {
  return <header className={`ui-toolbar${className ? ` ${className}` : ""}`} {...props}>{children}</header>;
}
