interface RangeFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  formatValue?: (value: number) => string;
}

export default function RangeField({ label, value, min, max, step = 1, onChange, formatValue = String }: RangeFieldProps) {
  const percent = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  return (
    <div className="ui-range-field">
      <label>{label}</label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label={label}
        style={{
          accentColor: "var(--accent)",
          background: `linear-gradient(to right, var(--accent) 0%, var(--accent) ${percent}%, var(--panel-3) ${percent}%, var(--panel-3) 100%)`,
        }}
      />
      <output>{formatValue(value)}</output>
    </div>
  );
}
