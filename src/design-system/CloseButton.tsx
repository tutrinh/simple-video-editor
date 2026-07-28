import CloseIcon from "./icons/CloseIcon";

interface CloseButtonProps {
  onClick: () => void;
  label?: string;
}

export default function CloseButton({ onClick, label = "Close" }: CloseButtonProps) {
  return (
    <button type="button" className="ui-close" onClick={onClick} aria-label={label} title="Close (Esc)">
      <CloseIcon size={16} />
    </button>
  );
}
