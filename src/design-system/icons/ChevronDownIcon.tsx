import type { CSSProperties } from "react";

interface ChevronDownIconProps {
  size?: number;
  title?: string;
  className?: string;
  style?: CSSProperties;
}

export default function ChevronDownIcon({ size = 46, title, className, style }: ChevronDownIconProps) {
  return (
    <svg
      width={size}
      height={size}
      fill="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      className={className}
      style={style}
    >
      <path d="M5.293 9.293a1 1 0 0 1 1.414 0L12 14.586l5.293-5.293a1 1 0 1 1 1.414 1.414l-6 6a1 1 0 0 1-1.414 0l-6-6a1 1 0 0 1 0-1.414Z" />
    </svg>
  );
}
