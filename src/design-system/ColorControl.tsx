import type { InputHTMLAttributes } from "react";

interface ColorControlProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: string;
  value: string;
}

export default function ColorControl({ label, value, onChange, ...props }: ColorControlProps) {
  const control = <span className="ui-color-control"><input type="color" value={value} onChange={onChange} {...props} /><code>{value.toUpperCase()}</code></span>;
  return label ? <label className="ui-field"><span className="ui-field-label">{label}</span>{control}</label> : control;
}
