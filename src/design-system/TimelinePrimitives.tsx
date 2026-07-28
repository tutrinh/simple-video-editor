import type { CSSProperties, ReactNode } from "react";

export function TimelineRuler({ marks }: { marks: string[] }) {
  return <div className="ui-timeline-ruler">{marks.map((mark) => <span key={mark}>{mark}</span>)}</div>;
}
export function TimelineTrack({ label, children, actions }: { label: string; children: ReactNode; actions?: ReactNode }) {
  return <div className="ui-timeline-track"><header><strong>{label}</strong>{actions}</header><div>{children}</div></div>;
}
export function TimelineClip({ label, start, width, tone = "video", selected, onClick }: { label: string; start: number; width: number; tone?: "video" | "voice" | "overlay"; selected?: boolean; onClick?: () => void }) {
  const style = { "--clip-start": `${start}%`, "--clip-width": `${width}%` } as CSSProperties;
  return <button type="button" className={`ui-timeline-clip ${tone}${selected ? " selected" : ""}`} style={style} onClick={onClick}>{label}<ResizeHandle edge="start" /><ResizeHandle edge="end" /></button>;
}
export function TimelinePlayhead({ position }: { position: number }) {
  return <div className="ui-timeline-playhead" style={{ left: `${position}%` }} aria-hidden="true" />;
}
export function ResizeHandle({ edge }: { edge: "start" | "end" }) {
  return <span className={`ui-resize-handle ${edge}`} aria-hidden="true" />;
}
