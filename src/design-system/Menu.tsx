import type { ReactNode } from "react";

export interface MenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  critical?: boolean;
  disabled?: boolean;
}
interface MenuProps {
  items: MenuItem[];
  onSelect: (id: string) => void;
  label: string;
}
export default function Menu({ items, onSelect, label }: MenuProps) {
  return <div className="ui-menu" role="menu" aria-label={label}>{items.map((item) => <button key={item.id} type="button" role="menuitem" disabled={item.disabled} className={item.critical ? "critical" : ""} onClick={() => onSelect(item.id)}>{item.icon}{item.label}</button>)}</div>;
}
