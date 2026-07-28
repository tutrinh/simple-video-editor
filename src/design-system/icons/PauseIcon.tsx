interface Props { size?: number; }
export default function PauseIcon({ size = 46 }: Props) {
  return <svg width={size} height={size} fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6a1 1 0 0 1 1 1v10a1 1 0 1 1-2 0V7a1 1 0 0 1 1-1Zm6 0a1 1 0 0 1 1 1v10a1 1 0 0 1-2 0V7a1 1 0 0 1 1-1Z" /></svg>;
}
