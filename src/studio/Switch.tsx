interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Accessible label for the switch (used when there is no visible text label). */
  label?: string;
  disabled?: boolean;
}

/** Reusable on/off toggle switch (accessible `role="switch"` button). */
export default function Switch({ checked, onChange, label, disabled }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={"st-switch" + (checked ? " on" : "")}
      onClick={() => onChange(!checked)}
    >
      <span className="st-switch-knob" />
    </button>
  );
}
