interface Tab {
  value: string;
  label: string;
}
interface TabsProps {
  tabs: Tab[];
  value: string;
  onChange: (value: string) => void;
  label: string;
}
export default function Tabs({ tabs, value, onChange, label }: TabsProps) {
  return <div className="ui-tabs" role="tablist" aria-label={label}>{tabs.map((tab) => <button key={tab.value} type="button" role="tab" aria-selected={value === tab.value} onClick={() => onChange(tab.value)}>{tab.label}</button>)}</div>;
}
