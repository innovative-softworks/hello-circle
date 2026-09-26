import type { ReactNode } from "react";
import { colors, fonts } from "../theme";

export type MarqueeItem = { label: string; icon?: ReactNode };

function Group({ items, accent, ariaHidden }: { items: MarqueeItem[]; accent: string; ariaHidden?: boolean }) {
  return (
    <div aria-hidden={ariaHidden} style={{ display: "flex", alignItems: "center" }}>
      {items.map((item, i) => (
        <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 20, padding: "0 28px" }}>
          {item.icon && <span style={{ color: accent, display: "flex" }}>{item.icon}</span>}
          <span style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 16, whiteSpace: "nowrap" }}>{item.label}</span>
          <span style={{ color: colors.borderStrong, fontWeight: 700 }} aria-hidden="true">
            /
          </span>
        </span>
      ))}
    </div>
  );
}

// Endless horizontal ticker — same .fv-marquee mechanism (index.css) as
// BrowseTicker and the For Venues benefit strip: two copies of the track
// shift left by one copy's width so the loop is invisible; pauses on hover,
// static under reduced motion.
export function Marquee({ items, accent = colors.greenText, label, style }: { items: MarqueeItem[]; accent?: string; label: string; style?: React.CSSProperties }) {
  return (
    <div style={{ borderTop: `1px solid ${colors.border}`, borderBottom: `1px solid ${colors.border}`, ...style }}>
      <div className="fv-marquee-viewport" style={{ overflow: "hidden", padding: "16px 0" }} role="list" aria-label={label}>
        <div className="fv-marquee-track">
          <Group items={items} accent={accent} />
          <Group items={items} accent={accent} ariaHidden />
        </div>
      </div>
    </div>
  );
}
