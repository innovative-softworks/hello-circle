import type { ReactNode } from "react";
import { euro } from "../euro";
import { daysBetween, irelandToday } from "../irelandDate";

// Right-hand booking card facts (owner choice "A · Fact rows", 2026-10-22):
// date, location and price each get an icon tile, a bold value and a muted
// second line; price is the last row, right above the main action. Shared by
// the activity, experience/adventure/volunteer and programme detail pages.
// A definition list, so each value is announced with its label.

export interface BookingFact {
  key: string;
  icon: ReactNode;
  /** Read by screen readers ("Date", "Where", "Price"); not shown. */
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  /** Price row: larger value. "free" colours it green. */
  emphasis?: "price" | "free";
}

export function BookingFacts({ facts, footnote }: { facts: BookingFact[]; footnote?: ReactNode }) {
  return (
    <div className="booking-facts">
      <dl className="booking-facts-list">
        {facts.map((f) => (
          <div key={f.key} className={`booking-fact${f.emphasis ? ` booking-fact--${f.emphasis}` : ""}`}>
            <span className="booking-fact-icon" aria-hidden="true">
              {f.icon}
            </span>
            <div className="booking-fact-text">
              <dt className="visually-hidden">{f.label}</dt>
              <dd className="booking-fact-value">{f.value}</dd>
              {f.sub && <dd className="booking-fact-sub">{f.sub}</dd>}
            </div>
          </div>
        ))}
      </dl>
      {footnote && <p className="booking-facts-footnote">{footnote}</p>}
    </div>
  );
}

/** The booking box price (D1, owner 2026-10-27): the same price and unit
 * as the card ("€8 per person", "€60 for 6 sessions"), larger. Free is the
 * word "Free". Totals with VAT and fees come later, in the breakdown. */
export function BookingPrice({ cents, unit }: { cents: number | null | undefined; unit?: string }) {
  if (!cents) return <span className="booking-price is-free"><b>Free</b></span>;
  return (
    <span className="booking-price">
      <b>{euro(cents / 100)}</b>
      {unit ? <span>{unit}</span> : null}
    </span>
  );
}

/** The row of quieter actions under the booking box's main button (Share,
 * Invite, Calendar, Directions, Group chat; owner 2026-10-27): round icons,
 * each with a short label under it so they're clear without hovering. */
export function BookingActions({ children }: { children: ReactNode }) {
  return <div className="booking-actions">{children}</div>;
}

/** One labelled round icon in BookingActions. `href` makes it a link (opens
 * a new tab, e.g. directions); `done` shows it ticked (e.g. calendar added). */
export function IconAction({ label, short, onClick, href, done, children }: { label: string; short?: string; onClick?: () => void; href?: string; done?: boolean; children: ReactNode }) {
  const body = (
    <>
      <span className="booking-icon-dot" aria-hidden="true">{children}</span>
      <span className="booking-icon-label">{short ?? label}</span>
    </>
  );
  const cls = `booking-icon${done ? " is-done" : ""}`;
  if (href) {
    return (
      <a className={cls} href={href} target="_blank" rel="noopener noreferrer" aria-label={label} onClick={onClick}>
        {body}
      </a>
    );
  }
  return (
    <button type="button" className={cls} aria-label={label} onClick={onClick}>
      {body}
    </button>
  );
}

/** "Starts tonight", "Starts tomorrow", "Starts in 5 days", "Starts on 12 Nov".
 * Ireland dates; null once it has started. */
export function startsIn(date: string, time?: string | null): string | null {
  const days = daysBetween(irelandToday(), date);
  if (days < 0) return null;
  if (days === 0) return time && time >= "17:00" ? "Starts tonight" : "Starts today";
  if (days === 1) return "Starts tomorrow";
  if (days <= 13) return `Starts in ${days} days`;
  return `Starts on ${new Date(`${date}T12:00:00Z`).toLocaleDateString("en-IE", { day: "numeric", month: "short", timeZone: "Europe/Dublin" })}`;
}

export interface GlanceItem {
  key: string;
  icon: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
}

/** "At a glance" (owner 2026-10-27): the few things people check before
 * booking — length and level, what to bring, cancellation — between who's
 * going and the price. Callers pass only lines with real data. */
export function BookingGlance({ items }: { items: GlanceItem[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="booking-glance">
      {items.map((i) => (
        <li key={i.key}>
          <span className="booking-glance-icon" aria-hidden="true">{i.icon}</span>
          <span>
            <b>{i.value}</b>
            {i.sub ? <span className="booking-glance-sub"> · {i.sub}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Right after booking: what's done and what's worth doing next. */
export function NextSteps({ steps }: { steps: { key: string; label: ReactNode; done: boolean }[] }) {
  return (
    <ul className="booking-next">
      {steps.map((s) => (
        <li key={s.key} className={s.done ? "is-done" : undefined}>
          <span className="booking-next-tick" aria-hidden="true">{s.done ? "✓" : ""}</span>
          <span>
            {s.label}
            {s.done ? <span className="visually-hidden"> (done)</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** A quiet text action under the icons — leave, withdraw, cancel. Kept small
 * so nobody leaves by accident; every one of them confirms first. */
export function QuietAction({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <div className="booking-quiet">
      <button type="button" onClick={onClick} disabled={disabled}>
        {children}
      </button>
    </div>
  );
}

/** The booked summary ("ticket"): when, where, and anything else to keep. */
export function BookingTicket({ children }: { children: ReactNode }) {
  return <div className="booking-ticket">{children}</div>;
}

/** Google Maps directions link for a place name / address (opens a new tab). */
export function directionsHref(query: string, lat?: number | null, lng?: number | null): string {
  const q = lat != null && lng != null ? `${lat},${lng}` : query;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}`;
}
