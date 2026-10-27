import type { ReactNode } from "react";
import { bigDay, type CardLabel } from "./CardDate";
import { formatTime12h } from "../formatters";
import "./compactRow.css";

// D · Compact rows (card styles, owner 2026-10-27): a small square photo with
// the date on it, the text beside it, thin lines between rows. The My Life
// type and colours in a denser shape, for lists of dated things under or
// beside the main content. The whole row opens `href`; `action` sits above
// that link. The label uses the same rules as the photo cards (CardDate.tsx)
// and shows as a coloured line above the title.

export function CompactRow({
  href,
  onOpen,
  image,
  fallbackIcon,
  date,
  time,
  label,
  title,
  meta,
  action,
}: {
  href: string;
  onOpen: () => void;
  image?: string | null;
  /** Shown on the green block when there's no photo. */
  fallbackIcon?: ReactNode;
  date: string;
  time?: string | null;
  label?: CardLabel | null;
  title: ReactNode;
  /** One muted line: place, going, places left. */
  meta?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <article className="cr-row">
      <span className={`cr-photo${image ? "" : " is-empty"}`} aria-hidden="true">
        {image ? <img src={image} alt="" loading="lazy" /> : <span className="cr-icon">{fallbackIcon}</span>}
        <span className="cr-date">
          <b>{label?.big ?? bigDay(date, time)}</b>
          {time ? <small>{formatTime12h(time)}</small> : null}
        </span>
      </span>
      <span className="cr-text">
        {label ? <span className={`cr-label is-${label.tone}`}>{label.rest}</span> : null}
        <a
          className="cr-title"
          href={href}
          onClick={(e) => {
            e.preventDefault();
            onOpen();
          }}
        >
          {title}
        </a>
        {meta ? <span className="cr-meta">{meta}</span> : null}
      </span>
      {action ? <span className="cr-action">{action}</span> : null}
    </article>
  );
}

/** Compact rows with thin lines between them. */
export function CompactRows({ children }: { children: ReactNode }) {
  return <div className="cr-rows">{children}</div>;
}
