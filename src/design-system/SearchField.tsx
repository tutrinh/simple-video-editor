import type { InputHTMLAttributes } from "react";
import SearchIcon from "./icons/SearchIcon";
import CloseIcon from "./icons/CloseIcon";

interface SearchFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: string;
  onClear?: () => void;
}

export default function SearchField({ label = "Search", onClear, value, className = "", ...props }: SearchFieldProps) {
  return (
    <label className={`ui-search-field${className ? ` ${className}` : ""}`}>
      <span className="sr-only">{label}</span><SearchIcon size={15} />
      <input type="search" value={value} {...props} />
      {value && onClear && <button type="button" aria-label="Clear search" onClick={onClear}><CloseIcon size={13} /></button>}
    </label>
  );
}
