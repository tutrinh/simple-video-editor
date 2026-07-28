interface ProgressBarProps {
  value?: number;
  label: string;
  showValue?: boolean;
}
export default function ProgressBar({ value, label, showValue = true }: ProgressBarProps) {
  const normalized = value == null ? undefined : Math.min(100, Math.max(0, value));
  return <div className={`ui-progress${normalized == null ? " indeterminate" : ""}`}><span><strong>{label}</strong>{showValue && normalized != null && <code>{Math.round(normalized)}%</code>}</span><div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={normalized}><i style={normalized == null ? undefined : { width: `${normalized}%` }} /></div></div>;
}
