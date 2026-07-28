import { useState } from "react";
import AddIcon from "./icons/AddIcon";
import DeleteIcon from "./icons/DeleteIcon";
import MenuIcon from "./icons/MenuIcon";
import IconButton from "./IconButton";
import Popover from "./Popover";
import MediaCard from "./MediaCard";
import CollapsibleSection from "./CollapsibleSection";
import PropertyRow from "./PropertyRow";
import ColorControl from "./ColorControl";
import RangeField from "./RangeField";
import SearchField from "./SearchField";
import TagInput from "./TagInput";
import Tabs from "./Tabs";
import Menu from "./Menu";
import Toast from "./Toast";
import ProgressBar from "./ProgressBar";
import Button from "./Button";
import Badge from "./Badge";

export default function ComponentInventoryShowcase() {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [tags, setTags] = useState(["interview", "product"]);
  const [tab, setTab] = useState("properties");
  const [color, setColor] = useState("#0a7558");
  const [rotation, setRotation] = useState(0);
  const [scale, setScale] = useState(100);
  return (
    <div className="ds-inventory-grid">
      <article className="ds-inventory-block"><h3>Icon buttons and menu</h3><div className="ds-inline-wrap">
        <IconButton label="Add clip" icon={<AddIcon size={16} />} />
        <IconButton label="Delete clip" icon={<DeleteIcon size={16} />} variant="critical" />
        <span className="ds-relative"><IconButton label="Open menu" icon={<MenuIcon size={16} />} variant={popoverOpen ? "selected" : "quiet"} onClick={() => setPopoverOpen((value) => !value)} /><Popover open={popoverOpen} onClose={() => setPopoverOpen(false)} label="Clip actions"><Menu label="Clip actions" items={[{ id: "duplicate", label: "Duplicate" }, { id: "delete", label: "Delete", critical: true }]} onSelect={() => setPopoverOpen(false)} /></Popover></span>
      </div></article>
      <article className="ds-inventory-block"><h3>Media cards</h3><div className="ds-mini-media-grid"><MediaCard title="Opening shot" meta="Used in 2 beats" duration="6.4s" selected /><MediaCard title="Product detail" meta="Available" duration="5.9s" /></div></article>
      <article className="ds-inventory-block"><h3>Inspector patterns</h3><CollapsibleSection title="Transform" description="Position and scale"><RangeField label="Rotation" value={rotation} min={-180} max={180} onChange={setRotation} formatValue={(value) => `${value}°`} /><RangeField label="Scale" value={scale} min={25} max={300} onChange={setScale} formatValue={(value) => `${value}%`} /><PropertyRow label="Tint"><ColorControl value={color} onChange={(event) => setColor(event.target.value)} /></PropertyRow></CollapsibleSection></article>
      <article className="ds-inventory-block"><h3>Search and tags</h3><div className="ds-stack"><SearchField value={search} placeholder="Search clips" onChange={(event) => setSearch(event.target.value)} onClear={() => setSearch("")} /><TagInput tags={tags} onChange={setTags} /></div></article>
      <article className="ds-inventory-block"><h3>Tabs</h3><Tabs label="Inspector views" value={tab} onChange={setTab} tabs={[{ value: "properties", label: "Properties" }, { value: "effects", label: "Effects" }, { value: "audio", label: "Audio" }]} /><p className="ds-inventory-note">Current view: {tab}</p></article>
      <article className="ds-inventory-block"><h3>Progress and notifications</h3><div className="ds-stack"><ProgressBar label="Rendering preview" value={64} /><ProgressBar label="Analyzing footage" /><Toast title="Project saved" message="All edits are stored locally." /></div></article>
      <article className="ds-inventory-block ds-span-2"><h3>Empty-state actions</h3><div className="ds-inline-wrap"><Button variant="primary" icon={<AddIcon size={15} />}>Add media</Button><Button variant="secondary">Browse files</Button></div></article>
      <article className="ds-inventory-block ds-span-2"><h3>Application components</h3><div className="ds-inline-wrap">
        {["Workspace", "Toolbar", "Drawer", "Modal", "Popover", "MediaCard", "Inspector section", "Property row", "Timeline shell", "Timeline lane", "Timeline segment", "Timeline zoom"].map((name) => <Badge key={name}>{name}</Badge>)}
      </div></article>
    </div>
  );
}
