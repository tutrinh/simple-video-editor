import type { InputHTMLAttributes } from "react";

interface NumberFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: string;
  unit?: string;
}

export default function NumberField({ label, unit, className = "", ...props }: NumberFieldProps) {
  const input = <span className="ui-number-field"><input type="number" className={`ui-control${className ? ` ${className}` : ""}`} {...props} />{unit && <span>{unit}</span>}</span>;
  return label ? <label className="ui-field"><span className="ui-field-label">{label}</span>{input}</label> : input;
}
