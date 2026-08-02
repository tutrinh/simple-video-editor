import type {
  ButtonHTMLAttributes,
  CSSProperties,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  Ref,
} from "react";
import IconButton from "./IconButton";
import AddIcon from "./icons/AddIcon";

function classes(base: string, className?: string) {
  return `${base}${className ? ` ${className}` : ""}`;
}

export function TimelineShell({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <section className={classes("ui-editor-timeline", className)} {...props} />;
}

export function TimelineHeader({ title, meta, actions }: { title: string; meta: ReactNode; actions?: ReactNode }) {
  return <header className="ui-timeline-header"><div><strong>{title}</strong><span>{meta}</span></div>{actions && <div className="ui-timeline-header-actions">{actions}</div>}</header>;
}

export function TimelineAddButton({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className="ui-timeline-add" {...props}><AddIcon size={13} />{children}</button>;
}

export function TimelineZoom({
  value,
  min,
  max,
  step,
  onChange,
  onFit,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  onFit: () => void;
}) {
  const percent = ((value - min) / (max - min)) * 100;
  return (
    <div className="ui-timeline-zoom" aria-label="Timeline magnification">
      <span>Timeline zoom</span>
      <IconButton size="small" label="Zoom timeline out" icon={<span aria-hidden="true">−</span>} onClick={() => onChange(value - step)} disabled={value <= min} />
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label="Timeline zoom level"
        style={{ "--timeline-zoom": `${percent}%` } as CSSProperties}
      />
      <IconButton size="small" label="Zoom timeline in" icon={<AddIcon size={13} />} onClick={() => onChange(value + step)} disabled={value >= max} />
      <output>{Math.round(value * 100)}%</output>
      <button type="button" onClick={onFit} disabled={value === min}>Fit</button>
    </div>
  );
}

export function TimelineViewport({ viewportRef, className, ...props }: HTMLAttributes<HTMLDivElement> & { viewportRef?: Ref<HTMLDivElement> }) {
  return <div ref={viewportRef} className={classes("ui-timeline-viewport", className)} {...props} />;
}

export function TimelineCanvas({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={classes("ui-timeline-canvas", className)} {...props} />;
}

export function TimelineLane({ label, hint, actions, children, className }: { label: ReactNode; hint?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={classes("ui-timeline-lane", className)}><header><strong>{label}</strong>{hint && <span>{hint}</span>}{actions && <div className="ui-timeline-lane-actions">{actions}</div>}</header>{children}</section>;
}

export function TimelineLaneCanvas({ canvasRef, className, ...props }: HTMLAttributes<HTMLDivElement> & { canvasRef?: Ref<HTMLDivElement> }) {
  return <div ref={canvasRef} className={classes("ui-timeline-lane-canvas", className)} {...props} />;
}

export function TimelineDivider(props: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={classes("ui-timeline-divider", props.className)} />;
}

export function TimelineSegment({ selected, tone = "video", className, ...props }: HTMLAttributes<HTMLDivElement> & { selected?: boolean; tone?: "video" | "voice" | "sfx" | "sticker" }) {
  return <div {...props} className={classes(`ui-timeline-segment ${tone}${selected ? " selected" : ""}`, className)} />;
}

export function TimelineResizeHandle({ edge, className, ...props }: HTMLAttributes<HTMLDivElement> & { edge: "left" | "right" }) {
  return <div {...props} className={classes(`ui-timeline-resize ${edge}`, className)} />;
}

export function TimelinePlayhead(props: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={classes("ui-editor-playhead", props.className)} />;
}

export function TimelineRange(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input type="range" {...props} className={classes("ui-timeline-range", props.className)} />;
}
