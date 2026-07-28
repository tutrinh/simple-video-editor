import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

interface FieldShellProps {
  label: string;
  help?: string;
  error?: string;
  children: (id: string) => ReactNode;
}

function FieldShell({ label, help, error, children }: FieldShellProps) {
  const id = useId();
  return (
    <label className="ui-field" htmlFor={id}>
      <span className="ui-field-label">{label}</span>
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

export function TextareaField({ label, help, error, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & Omit<FieldShellProps, "children">) {
  return <FieldShell label={label} help={help} error={error}>{(id) => <textarea {...props} id={id} className={`ui-control ${props.className ?? ""}`.trim()} aria-invalid={Boolean(error)} />}</FieldShell>;
}
