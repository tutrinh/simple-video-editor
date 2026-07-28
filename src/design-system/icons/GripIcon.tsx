interface Props { size?: number; className?: string; }
export default function GripIcon({ size = 15, className }: Props) {
  return <svg className={className} width={Math.round(size * 0.54)} height={size} viewBox="0 0 8 15" fill="currentColor" aria-hidden="true"><circle cx="2" cy="2" r="1.2" /><circle cx="6" cy="2" r="1.2" /><circle cx="2" cy="7.5" r="1.2" /><circle cx="6" cy="7.5" r="1.2" /><circle cx="2" cy="13" r="1.2" /><circle cx="6" cy="13" r="1.2" /></svg>;
}
