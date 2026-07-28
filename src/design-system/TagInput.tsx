import { useState, type KeyboardEvent } from "react";
import CloseIcon from "./icons/CloseIcon";

interface TagInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  label?: string;
  placeholder?: string;
}

export default function TagInput({ tags, onChange, label = "Tags", placeholder = "Add tag" }: TagInputProps) {
  const [draft, setDraft] = useState("");
  const commit = () => {
    const tag = draft.trim();
    if (tag && !tags.includes(tag)) onChange([...tags, tag]);
    setDraft("");
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") { event.preventDefault(); commit(); }
    if (event.key === "Backspace" && !draft && tags.length) onChange(tags.slice(0, -1));
  };
  return (
    <label className="ui-field">
      <span className="ui-field-label">{label}</span>
      <span className="ui-tag-input">
        {tags.map((tag) => <span key={tag}>{tag}<button type="button" aria-label={`Remove ${tag}`} onClick={() => onChange(tags.filter((item) => item !== tag))}><CloseIcon size={11} /></button></span>)}
        <input value={draft} placeholder={placeholder} onChange={(event) => setDraft(event.target.value)} onKeyDown={onKeyDown} onBlur={commit} />
      </span>
    </label>
  );
}
