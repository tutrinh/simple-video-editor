import type { ReactNode } from "react";

interface MediaCardProps {
  title: string;
  meta?: string;
  image?: string;
  duration?: string;
  selected?: boolean;
  badge?: ReactNode;
  actions?: ReactNode;
  onClick?: () => void;
}

export default function MediaCard({ title, meta, image, duration, selected, badge, actions, onClick }: MediaCardProps) {
  const content = (
    <>
      <span className="ui-media-card-preview" style={image ? { backgroundImage: `url("${image}")` } : undefined}>
        {duration && <code>{duration}</code>}
        {badge && <span className="ui-media-card-badge">{badge}</span>}
      </span>
      <span className="ui-media-card-copy"><strong>{title}</strong>{meta && <small>{meta}</small>}</span>
    </>
  );
  return (
    <article className={`ui-media-card${selected ? " selected" : ""}`}>
      {onClick ? <button type="button" className="ui-media-card-main" onClick={onClick} aria-pressed={selected}>{content}</button> : <div className="ui-media-card-main">{content}</div>}
      {actions && <div className="ui-media-card-actions">{actions}</div>}
    </article>
  );
}
