import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AwardIcon, CalendarIcon, ChevronRightIcon, ClockIcon, PinIcon } from "../icons";
import { SinglePinMap } from "../SinglePinMap";
import { Avatar } from "../ui";
import { colors, fonts, radius } from "../../theme";

// Detail-page redesign (owner feedback 2026-10-22: "Hosted by, Where,
// Schedule, Reviews should be improved"). One section style for every
// detail page: a heading over a thin rule, plain rows instead of a stack of
// bordered boxes, and the map folded into the location block.

const linkStyle: React.CSSProperties = { fontSize: 13.5, fontWeight: 700, color: colors.text, textDecoration: "underline", textUnderlineOffset: 3, background: "none", border: "none", padding: 0, cursor: "pointer", font: "inherit" };

export function DetailSection({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  return (
    <section aria-labelledby={id} style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 24, marginBottom: 28 }}>
      <h2 id={id} style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 18, margin: "0 0 14px" }}>{title}</h2>
      {children}
    </section>
  );
}

/** Hosted by — a person or a business: monogram/photo, name, a real
 * verification badge (only when the data says so), one line of real stats,
 * and a link to the profile. */
export function HostRow({
  name,
  avatarUrl,
  verifiedLabel,
  meta,
  href,
  linkLabel = "View profile",
  bio,
}: {
  name: string;
  avatarUrl?: string | null;
  /** e.g. "Verified Host" / "Verified provider" — omit when not verified. */
  verifiedLabel?: string | null;
  meta?: ReactNode;
  href?: string | null;
  linkLabel?: string;
  bio?: string | null;
}) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
      <Avatar name={name} size={48} src={avatarUrl ?? null} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 700, fontSize: 15.5 }}>{name}</span>
          {verifiedLabel && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, fontWeight: 700, color: colors.greenText, background: colors.greenBg, borderRadius: radius.pill, padding: "2px 8px" }}>
              <AwardIcon size={11} /> {verifiedLabel}
            </span>
          )}
        </div>
        {meta && <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 3, fontSize: 13, color: colors.mutedLight }}>{meta}</div>}
        {bio && <p style={{ margin: "8px 0 0", fontSize: 14, color: colors.textSoft, lineHeight: 1.55 }}>{bio}</p>}
        {href && (
          <Link to={href} className="tap-target" style={{ ...linkStyle, marginTop: 8, gap: 2 }}>
            {linkLabel} <ChevronRightIcon size={14} />
          </Link>
        )}
      </div>
    </div>
  );
}

/** Where — place name (linked when it has a page), area, a privacy note when
 * the pin is approximate, and Get directions / Show map side by side; the
 * click-to-load map opens underneath, in the same block. */
export function LocationBlock({
  name,
  nameHref,
  area,
  note,
  directionsUrl,
  map,
  extra,
}: {
  name: string;
  nameHref?: string | null;
  area?: string | null;
  /** e.g. "Approximate area — not an exact address". */
  note?: string | null;
  directionsUrl?: string | null;
  map?: { lat: number; lng: number; label: string } | null;
  /** Extra links (e.g. "View venue"). */
  extra?: ReactNode;
}) {
  const [mapOpen, setMapOpen] = useState(false);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <span aria-hidden="true" style={{ width: 40, height: 40, borderRadius: "50%", background: colors.panel, color: colors.muted, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
          <PinIcon size={17} />
        </span>
        <div style={{ minWidth: 0 }}>
          {nameHref ? (
            <Link to={nameHref} style={{ fontWeight: 700, fontSize: 15.5, color: colors.text, textDecoration: "none" }}>{name}</Link>
          ) : (
            <div style={{ fontWeight: 700, fontSize: 15.5 }}>{name}</div>
          )}
          {area && <div style={{ fontSize: 13.5, color: colors.mutedLight, marginTop: 2 }}>{area}</div>}
          {note && <div style={{ fontSize: 12, fontWeight: 700, color: colors.orangeDark, marginTop: 4 }}>{note}</div>}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 18px", marginTop: 8 }}>
            {directionsUrl && (
              <a href={directionsUrl} target="_blank" rel="noreferrer" className="tap-target" style={linkStyle}>
                Get directions
              </a>
            )}
            {map && (
              <button type="button" className="tap-target" aria-expanded={mapOpen} onClick={() => setMapOpen((v) => !v)} style={linkStyle}>
                {mapOpen ? "Hide map" : "Show map"}
              </button>
            )}
            {extra}
          </div>
        </div>
      </div>
      {map && mapOpen && (
        <div style={{ marginTop: 14 }}>
          <SinglePinMap lat={map.lat} lng={map.lng} label={map.label} height={240} startOpen />
        </div>
      )}
    </div>
  );
}

/** Schedule — one row per session: date, time · length, and any extra (room,
 * instructor). Rows are separated by rules, not boxed. */
export function ScheduleList({ rows }: { rows: { id: string; date: string; time: string; extra?: string | null }[] }) {
  return (
    <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {rows.map((r, i) => (
        <li key={r.id} style={{ display: "grid", gridTemplateColumns: "28px minmax(0, 1fr)", gap: 12, padding: "12px 0", borderTop: i === 0 ? "none" : `1px solid ${colors.border}` }}>
          <span aria-hidden="true" style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 14, color: colors.mutedLight, paddingTop: 1 }}>{String(i + 1).padStart(2, "0")}</span>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "4px 16px" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 700, fontSize: 14.5 }}><CalendarIcon size={14} /> {r.date}</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 14, color: colors.muted }}><ClockIcon size={14} /> {r.time}</span>
            {r.extra && <span style={{ fontSize: 13.5, color: colors.mutedLight }}>{r.extra}</span>}
          </div>
        </li>
      ))}
    </ol>
  );
}
