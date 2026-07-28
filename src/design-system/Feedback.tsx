import type { ReactNode } from "react";
import Button from "./Button";

export function EmptyState({ title, description, action }: { title: string; description: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="ui-empty-state">
      <h3>{title}</h3>
      <p>{description}</p>
      {action && <Button onClick={action.onClick}>{action.label}</Button>}
    </div>
  );
}

export function ProgressNotice({ title, message, trailing }: { title: string; message: string; trailing?: ReactNode }) {
  return (
    <div className="ui-progress-notice" role="status">
      <div className="ui-progress-notice-head">
        <span className="ui-progress-notice-spinner" aria-hidden="true" />
        <div><strong>{title}</strong><span>{message}</span></div>
        {trailing}
      </div>
    </div>
  );
}
