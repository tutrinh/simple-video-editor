import { useId, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import CopyIcon from "./icons/CopyIcon";

interface FieldShellProps {
  label: string;
  help?: string;
  error?: string;
  copyable?: boolean;
  copyValue?: string;
  children: (id: string) => ReactNode;
}

function FieldShell({ label, help, error, copyable, copyValue, children }: FieldShellProps) {
  const id = useId();
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!copyValue) return;
    navigator.clipboard.writeText(copyValue).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  return (
    <label className="ui-field" htmlFor={id}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
        <span className="ui-field-label">{label}</span>
        {copyable && (
          <button
            type="button"
            className="st-btn ghost"
            onClick={handleCopy}
            disabled={!copyValue?.trim()}
            style={{
              padding: "2px 6px",
              fontSize: 10,
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              cursor: copyValue?.trim() ? "pointer" : "default",
              border: "none",
              background: "transparent",
              color: "var(--ink-2)",
            }}
            title="Copy text to clipboard"
          >
            <CopyIcon size={11} /> {copied ? "Copied!" : "Copy"}
          </button>
        )}
      </div>
      {children(id)}
      {error ? <span className="ui-field-error">{error}</span> : help ? <span className="ui-field-help">{help}</span> : null}
    </label>
  );
}

export function TextField({ label, help, error, ...props }: InputHTMLAttributes<HTMLInputElement> & Omit<FieldShellProps, "children">) {
  return <FieldShell label={label} help={help} error={error}>{(id) => <input {...props} id={id} className={`ui-control ${props.className ?? ""}`.trim()} aria-invalid={Boolean(error)} />}</FieldShell>;
}

export function SelectField({ label, help, error, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & Omit<FieldShellProps, "children">) {
  return <FieldShell label={label} help={help} error={error}>{(id) => <select {...props} id={id} className={`ui-control ${props.className ?? ""}`.trim()} aria-invalid={Boolean(error)}>{children}</select>}</FieldShell>;
}

export function TextareaField({ label, help, error, copyable, copyValue, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & Omit<FieldShellProps, "children">) {
  return <FieldShell label={label} help={help} error={error} copyable={copyable} copyValue={copyValue ?? (typeof props.value === "string" ? props.value : "")}>{(id) => <textarea {...props} id={id} className={`ui-control ${props.className ?? ""}`.trim()} aria-invalid={Boolean(error)} />}</FieldShell>;
}
