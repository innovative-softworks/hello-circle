import type { ReactNode } from "react";
import { CalendarDays, Clock3, Gauge, MapPin } from "lucide-react";
import { Photo } from "./Photo";
import { CardLink } from "./ui";
import { CardArrow, CardAvailability, STATUS_ICON, type ListingStatusTone } from "./ListingCard";
import "./listingCard.css";
import "./featureCard.css";

// FeatureCard — the four large "Different ways to discover" treatments from
// the owner's card reference (2026-10-22), for curated / featured
// placements only. The results grids keep the compact ListingCard so
// listings stay easy to compare (brief §3). Every variant takes the same
// data and opens the same detail page; none of them books anything itself.
// Only real fields are shown: no invented distances, routes, difficulty,
// avatars or urgency.
//
//   immersive — photo-led, title over a darkened photo, cream action strip
//   editorial — photo + a vertical date panel (month / day / weekday / time)
//   adventure — wide photo; date, duration and skill level when known
//   bold      — the category set large over the photo's lower edge

export type FeatureVariant = "immersive" | "editorial" | "adventure" | "bold";

export interface FeatureCardData {
  href: string;
  title: string;
  image: string | null;
  /** Placeholder colour when there's no photo. */
  ph: string;
  category?: string | null;
  status?: { label: string; tone?: ListingStatusTone } | null;
  place?: string | null;
  /** Ireland calendar date (YYYY-MM-DD) and display time ("12:00 PM"). */
  date?: string | null;
  time?: string | null;
  durationMinutes?: number | null;
  skill?: string | null;
  blurb?: string | null;
  going?: number | null;
  price: string;
  spotsLeft?: number | null;
}

export function FeatureCard({
  data,
  variant,
  save,
  onOpen,
  actionLabel = "View",
  action,
  children,
}: {
  data: FeatureCardData;
  variant: FeatureVariant;
  save?: ReactNode;
  onOpen: () => void;
  actionLabel?: string;
  /** Replaces the open arrow (e.g. a Join / waitlist CardAction). */
  action?: ReactNode;
  /** Extra line above the footer (e.g. WhyRecommended); not on Immersive. */
  children?: ReactNode;
}) {
  const d = data;
  const when = d.date ? whenParts(d.date) : null;
  const tone = d.status?.tone ?? "hot";
  const meta = [
    when ? { icon: <CalendarDays size={14} aria-hidden="true" />, text: `${when.weekday}${d.time ? `, ${d.time}` : ""}` } : null,
    variant === "adventure" || variant === "bold" ? (d.durationMinutes ? { icon: <Clock3 size={14} aria-hidden="true" />, text: formatMinutes(d.durationMinutes) } : null) : null,
    variant === "adventure" || variant === "bold" ? (d.skill ? { icon: <Gauge size={14} aria-hidden="true" />, text: d.skill } : null) : null,
  ].filter((m): m is { icon: JSX.Element; text: string } => !!m);

  const statusPill = d.status ? (
    <span className="lc-status" data-tone={tone}>
      {STATUS_ICON[tone]}
      {d.status.label}
    </span>
  ) : null;
  const footer = (
    <div className="fc-footer">
      <div className="lc-facts">
        <span className="lc-price">{d.price}</span>
        <CardAvailability spotsLeft={d.spotsLeft} />
      </div>
      <div className="stretched-link-above">
        {action ?? <CardArrow label={`${actionLabel}: ${d.title}`} onClick={onOpen} filled={variant === "immersive"} />}
      </div>
    </div>
  );
  const going = d.going ? <div className="lc-going">{d.going} going</div> : null;
  const place = d.place ? (
    <div className="lc-detail">
      <span className="lc-detail-icon"><MapPin size={14} aria-hidden="true" /></span>
      <span className="lc-detail-text">{d.place}</span>
    </div>
  ) : null;

  return (
    <article className={`fc fc--${variant}`}>
      <CardLink to={d.href} label={d.title} />
      <div className="fc-media">
        <Photo src={d.image ?? undefined} alt="" ph={d.ph} style={{ position: "absolute", inset: 0 }} />
        {statusPill}
        {save}
        {variant === "bold" && d.category ? (
          <span className="fc-bold-word" style={{ ["--chars" as string]: Math.max(4, d.category.length) }}>
            {d.category}
          </span>
        ) : null}
        {variant === "immersive" ? (
          <div className="fc-over">
            {d.category ? <span className="lc-tag fc-tag-inline">{d.category}</span> : null}
            <h3 className="fc-title fc-title--over">{d.title}</h3>
            {d.place ? (
              <div className="fc-over-place">
                <MapPin size={15} aria-hidden="true" /> {d.place}
              </div>
            ) : null}
            {when ? (
              <div className="fc-over-place">
                <CalendarDays size={15} aria-hidden="true" /> {when.weekday}
                {d.time ? `, ${d.time}` : ""}
              </div>
            ) : null}
            {d.going ? <div className="fc-over-going">{d.going} going</div> : null}
          </div>
        ) : d.category && variant !== "bold" ? (
          <span className="lc-tag">{d.category}</span>
        ) : null}
      </div>

      {variant === "editorial" && when ? (
        <div className="fc-datepanel" aria-label={`${when.long}${d.time ? ` at ${d.time}` : ""}`}>
          <span className="fc-dp-month">{when.month}</span>
          <span className="fc-dp-day">{when.day}</span>
          <span className="fc-dp-week">{when.weekdayShort}</span>
          {d.time ? <span className="fc-dp-time">{d.time}</span> : null}
        </div>
      ) : null}

      {variant === "immersive" ? (
        footer
      ) : (
        <div className="fc-body">
          <h3 className="fc-title">{d.title}</h3>
          {place}
          {variant !== "editorial" &&
            meta.length > 0 && (
              <div className="fc-meta">
                {meta.map((m, i) => (
                  <span key={i} className="fc-meta-item">
                    {m.icon}
                    {m.text}
                  </span>
                ))}
              </div>
            )}
          {variant === "editorial" && d.blurb ? <p className="fc-blurb">{d.blurb}</p> : null}
          {going}
          {children}
          {footer}
        </div>
      )}
    </article>
  );
}

function whenParts(iso: string) {
  const dt = new Date(`${iso}T12:00:00Z`);
  const opt = (o: Intl.DateTimeFormatOptions) => dt.toLocaleDateString("en-IE", { timeZone: "Europe/Dublin", ...o });
  return {
    month: opt({ month: "short" }).toUpperCase(),
    day: opt({ day: "numeric" }),
    weekdayShort: opt({ weekday: "short" }).toUpperCase(),
    weekday: opt({ weekday: "short", day: "numeric", month: "short" }),
    long: opt({ weekday: "long", day: "numeric", month: "long" }),
  };
}

function formatMinutes(m: number): string {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (rest === 30) return `${h}.5 hrs`;
  return `${h} hr${h === 1 ? "" : "s"}${rest ? ` ${rest} min` : ""}`;
}

/** Whether a listing has what a style needs; callers fall back to the
 * compact ListingCard otherwise (owner plan, 2026-10-23). */
export function featureFits(variant: FeatureVariant, d: { image?: string | null; date?: string | null; category?: string | null }): boolean {
  if (variant === "immersive" || variant === "adventure") return !!d.image;
  if (variant === "editorial") return !!d.date;
  return !!d.category;
}
