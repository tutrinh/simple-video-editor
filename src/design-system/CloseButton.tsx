import CloseIcon from "./icons/CloseIcon";

interface CloseButtonProps {
  onClick: () => void;
  label?: string;
  disabled?: boolean;
}

export default function CloseButton({ onClick, label = "Close", disabled = false }: CloseButtonProps) {
  return (
    <button
      type="button"
      className="ui-close"
      onClick={onClick}
      aria-label={label}
      title="Close (Esc)"
      disabled={disabled}
    >
      <CloseIcon size={16} />
    </button>
  );
}
