import type { HTMLAttributes, ReactNode } from "react";

export function Workspace({ className = "", children, ...props }: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return <div className={`ui-workspace${className ? ` ${className}` : ""}`} {...props}>{children}</div>;
}

export function WorkspaceMain({ className = "", children, ...props }: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return <main className={`ui-workspace-main${className ? ` ${className}` : ""}`} {...props}>{children}</main>;
}

export function WorkspacePanel({ className = "", children, ...props }: HTMLAttributes<HTMLElement> & { children: ReactNode }) {
  return <section className={`ui-workspace-panel${className ? ` ${className}` : ""}`} {...props}>{children}</section>;
}
