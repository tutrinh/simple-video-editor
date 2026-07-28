import type { ReactNode } from "react";

interface PropertyRowProps {
  label: string;
  hint?: string;
  children: ReactNode;
  action?: ReactNode;
}

export default function PropertyRow({ label, hint, children, action }: PropertyRowProps) {
  return (
    <div className="ui-property-row">
      <span className="ui-property-label"><strong>{label}</strong>{hint && <small>{hint}</small>}</span>
      <div className="ui-property-control">{children}</div>
      {action && <div className="ui-property-action">{action}</div>}
    </div>
  );
}
