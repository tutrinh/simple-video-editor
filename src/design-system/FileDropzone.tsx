import { useRef, useState, type DragEvent } from "react";

interface FileDropzoneProps {
  title: string;
  description: string;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  onFiles: (files: File[]) => void;
}

export default function FileDropzone({ title, description, accept, multiple = false, disabled = false, onFiles }: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function receive(files: FileList | null) {
    if (!files || disabled) return;
    onFiles(Array.from(files));
  }

  function onDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    setDragging(false);
    receive(event.dataTransfer.files);
  }

  return (
    <button
      type="button"
      className={`ui-dropzone${dragging ? " dragging" : ""}`}
      disabled={disabled}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
    >
      <strong>{title}</strong>
      <span>{description}</span>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        hidden
        onChange={(event) => {
          receive(event.target.files);
          event.target.value = "";
        }}
      />
    </button>
  );
}
