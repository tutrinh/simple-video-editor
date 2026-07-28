import { useId, useState, type ReactNode } from "react";
import ChevronDownIcon from "./icons/ChevronDownIcon";

interface CollapsibleSectionProps {
  title: string;
  description?: string;
  children: ReactNode;
  defaultOpen?: boolean;
  actions?: ReactNode;
}

export default function CollapsibleSection({ title, description, children, defaultOpen = true, actions }: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <section className="ui-collapsible">
      <header>
        <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((value) => !value)}>
          <span><strong>{title}</strong>{description && <small>{description}</small>}</span>
          <ChevronDownIcon size={16} />
        </button>
        {actions}
      </header>
      {open && <div id={id} className="ui-collapsible-body">{children}</div>}
    </section>
  );
}
