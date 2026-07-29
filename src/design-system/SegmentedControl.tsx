interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  value: T;
  options: readonly SegmentOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  disabled?: boolean;
}

export default function SegmentedControl<T extends string>({ value, options, onChange, ariaLabel, disabled = false }: SegmentedControlProps<T>) {
  return (
    <div className="ui-segmented" role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button key={option.value} type="button" disabled={disabled} aria-pressed={option.value === value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}
