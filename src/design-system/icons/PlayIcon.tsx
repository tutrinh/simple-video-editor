interface Props { size?: number; }
export default function PlayIcon({ size = 46 }: Props) {
  return <svg width={size} height={size} fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6.741c0-1.544 1.674-2.505 3.008-1.728l9.015 5.26c1.323.771 1.323 2.683 0 3.455l-9.015 5.258C7.674 19.764 6 18.803 6 17.26V6.741ZM17.015 12 8 6.741V17.26L17.015 12Z" /></svg>;
}
