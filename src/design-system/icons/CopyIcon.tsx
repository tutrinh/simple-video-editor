interface CopyIconProps {
  size?: number;
  title?: string;
}

export default function CopyIcon({ size = 46, title }: CopyIconProps) {
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
    >
      <path d="M2 4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v4h4a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2v-4H4a2 2 0 0 1-2-2V4Zm8 12v4h10V10h-4v4a2 2 0 0 1-2 2h-4Zm4-2V4H4v10h10Z" />
    </svg>
  );
}
