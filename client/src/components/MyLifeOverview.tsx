import { useRef, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { activityIcon } from "./circle/CircleHomeParts";
import type { NeedsAttentionItem } from "../types";
import "../pages/myLife.css";

// My Life overview, minimal photo-and-type design (owner, 2026-10-25,
// "implement this design": https://claude.ai/artifact/HsDMmRFquwy8VNDAq5Ukjp).
// Presentation only: MyBookings.tsx works out every row from data it already
// loads; nothing here invents a count, a date or a person.

const dayFmt = (iso: string, o: Intl.DateTimeFormatOptions) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-IE", { ...o, timeZone: "Europe/Dublin" });
export const shortDay = (iso: string) => `${dayFmt(iso, { weekday: "short" })} ${dayFmt(iso, { day: "numeric" })}`;

// ---------------------------------------------------------------- header
export function MyLifeTitle({ name, summary, actions, kicker, message }: { name: string | null; summary: string | null; actions: ReactNode; kicker?: string; message?: ReactNode }) {
  const h = Number(new Intl.DateTimeFormat("en-IE", { hour: "numeric", hourCycle: "h23", timeZone: "Europe/Dublin" }).format(new Date()));
  const greeting = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  return (
    <header className="mlx-head">
      <div style={{ minWidth: 0 }}>
        <p className="mlx-label">{kicker ? `My Life · ${kicker}` : "My Life"}</p>
        {name ? <h1 className="mlx-title">{greeting}, {name.split(" ")[0] || name}.</h1> : <h1 className="mlx-title">My Life</h1>}
        {message && <p className="mlx-hero-msg">{message}</p>}
        {summary && <p className="mlx-summary">{summary}</p>}
      </div>
      <div className="mlx-head-actions">{actions}</div>
    </header>
  );
}

// ---------------------------------------------------------------- card row
export type UpcomingCard = {
  key: string;
  date: string;
  dateLabel: string;
  time: string;
  title: string;
  meta: string;
  kind: "mine" | "circle";
  kindLabel: string;
  image: string | null;
  /** Where the card goes — a real link (open in a new tab, copy, Back work). */
  href?: string;
  /** Runs on open: tracking, or opening something in place when there's no href. */
  onOpen?: () => void;
  onTrack?: () => void;
};

export function CardView({ c }: { c: UpcomingCard }) {
  // My Life cards (2026-10-27 fix): callers pass `href` (My bookings, For me)
  // or `onOpen` (intent results); a card with neither did nothing on click.
  if (c.href) {
    return (
      <Link
        to={c.href}
        className="mlx-card"
        onClick={() => {
          c.onTrack?.();
          c.onOpen?.();
        }}
      >
        <CardInner c={c} />
      </Link>
    );
  }
  return (
    <button
      type="button"
      className="mlx-card"
      onClick={() => {
        c.onTrack?.();
        c.onOpen?.();
      }}
    >
      <CardInner c={c} />
    </button>
  );
}

function CardInner({ c }: { c: UpcomingCard }) {
  return (
    <>
      <span className={`mlx-card-photo${c.image ? "" : " is-empty"}`}>
        {c.image ? <img src={c.image} alt="" loading="lazy" /> : <span className="mlx-card-icon" aria-hidden="true">{activityIcon(c.title, 36)}</span>}
        <span className="mlx-card-date">
          <b>{c.dateLabel}</b>
          {c.time && c.time !== "00:00" && <span>{c.time}</span>}
        </span>
      </span>
      <span className="mlx-card-text">
        <small className={`mlx-kind mlx-kind--${c.kind === "mine" ? "mine" : "circle"}`}>{c.kindLabel}</small>
        <strong>{c.title}</strong>
        <span>{c.meta}</span>
      </span>
    </>
  );
}

/** Upcoming things as a grid of photo cards, one heading per month. */
export function UpcomingByMonth({ cards }: { cards: UpcomingCard[] }) {
  const months: { key: string; label: string; cards: UpcomingCard[] }[] = [];
  for (const c of cards) {
    const key = c.date.slice(0, 7);
    let m = months.find((x) => x.key === key);
    if (!m) {
      m = { key, label: dayFmt(c.date, { month: "long", year: "numeric" }), cards: [] };
      months.push(m);
    }
    m.cards.push(c);
  }
  return (
    <div className="mlx-months">
      {months.map((m) => (
        <section key={m.key} className="mlx-month" aria-labelledby={`mlx-m-${m.key}`}>
          <h3 className="mlx-month-title" id={`mlx-m-${m.key}`}>
            {m.label} <span>{m.cards.length}</span>
          </h3>
          <ul className="mlx-grid">
            {m.cards.map((c) => (
              <li key={c.key}>
                <CardView c={c} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- circles tab
export type CircleCard = {
  key: string;
  name: string;
  meta: string;
  image: string | null;
  organiser: boolean;
  next: string | null;
  planning: string | null;
  href: string;
};

export function CircleCards({ circles, onFindMore, row }: { circles: CircleCard[]; onFindMore: () => void; /** Overview: one sideways-scrolling row. */ row?: boolean }) {
  return (
    <ul className={row ? "mlx-cards" : "mlx-grid"} aria-label={row ? "Your Circles" : undefined}>
      {circles.map((c) => (
        <li key={c.key}>
          <Link to={c.href} className="mlx-card">
            <span className={`mlx-card-photo${c.image ? "" : " is-empty"}`}>
              {c.image ? <img src={c.image} alt="" loading="lazy" /> : <span className="mlx-card-icon" aria-hidden="true">{activityIcon(c.name, 36)}</span>}
              {c.organiser && <span className="mlx-card-badge">You organise</span>}
            </span>
            <span className="mlx-card-text">
              <strong>{c.name}</strong>
              <span>{c.meta}</span>
              <span className={c.next ? "mlx-card-next" : "mlx-card-next is-none"}>
                {c.next ? `Next: ${c.next}` : c.planning ? `Planning: ${c.planning}` : "Nothing planned yet"}
              </span>
            </span>
          </Link>
        </li>
      ))}
      <li>
        <button type="button" className="mlx-card mlx-card--more" onClick={onFindMore}>
          <span className="mlx-card-photo is-more">
            <span aria-hidden="true">+</span>
          </span>
          <span className="mlx-card-text">
            <strong>Find more Circles</strong>
            <span>Groups that meet around something you enjoy.</span>
          </span>
        </button>
      </li>
    </ul>
  );
}

// ---------------------------------------------------------------- recently
export type RecentItem = { key: string; date: string; title: string; detail: string; kindLabel: string; image: string | null; href: string; cancelled: boolean };

/** Past activity, one block per day: the date large on the left, what you
 * did on the right. Says "joined"/"booked", never "attended" (the feed
 * doesn't know you went unless you were checked in). */
export function RecentByDay({ items, maxDays = 4, perDay = 3 }: { items: RecentItem[]; maxDays?: number; perDay?: number }) {
  const days: { date: string; items: RecentItem[] }[] = [];
  for (const it of items) {
    let d = days.find((x) => x.date === it.date);
    if (!d) {
      if (days.length >= maxDays) break;
      d = { date: it.date, items: [] };
      days.push(d);
    }
    d.items.push(it);
  }
  return (
    <ol className="mlx-recent">
      {days.map((d) => (
        <li key={d.date} className="mlx-recent-day">
          <div className="mlx-recent-date" aria-hidden="true">
            <b>{dayFmt(d.date, { day: "numeric" })}</b>
            <span>{dayFmt(d.date, { weekday: "short" })} · {dayFmt(d.date, { month: "short" })}</span>
          </div>
          <div className="mlx-recent-items">
            <h3 className="mlx-sr">{dayFmt(d.date, { weekday: "long", day: "numeric", month: "long" })}</h3>
            {d.items.slice(0, perDay).map((it) => (
              <Link key={it.key} to={it.href} className={`mlx-recent-item${it.cancelled ? " is-cancelled" : ""}`}>
                <span className={`mlx-recent-thumb${it.image ? "" : " is-empty"}`} aria-hidden="true">
                  {it.image ? <img src={it.image} alt="" loading="lazy" /> : activityIcon(it.title, 20)}
                </span>
                <span className="mlx-recent-text">
                  <strong>{it.title}</strong>
                  <span>{it.cancelled ? "Cancelled" : it.kindLabel}{it.detail ? ` · ${it.detail}` : ""}</span>
                </span>
              </Link>
            ))}
            {d.items.length > perDay && <span className="mlx-recent-more">and {d.items.length - perDay} more that day</span>}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Upcoming things as a horizontal row of photo cards (scrolls sideways). */
export function UpcomingCards({ cards }: { cards: UpcomingCard[] }) {
  const rowRef = useRef<HTMLUListElement>(null);
  const scrollBy = (dir: 1 | -1) => {
    const row = rowRef.current;
    if (row) row.scrollBy({ left: dir * Math.max(row.clientWidth * 0.8, 280), behavior: "auto" });
  };
  return (
    <div className="mlx-cards-wrap">
      {cards.length > 2 && (
        <div className="mlx-cards-nav">
          <button type="button" className="mlx-arrow" aria-label="Scroll back" onClick={() => scrollBy(-1)}>←</button>
          <button type="button" className="mlx-arrow" aria-label="Scroll forward" onClick={() => scrollBy(1)}>→</button>
        </div>
      )}
      <ul className="mlx-cards" ref={rowRef} aria-label="Coming up">
        {cards.map((c) => (
          <li key={c.key}>
            <CardView c={c} />
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------- needs you
const ACTION_LABEL: Record<NeedsAttentionItem["actionType"], string> = {
  payment_incomplete: "Payment",
  waitlist_offered: "Place offered",
  join_request: "Request",
  circle_invitation: "Invite",
  plan_activity_creation: "Plan",
  plan_confirmation: "Plan",
  open_poll: "Poll",
};

function dueLabel(dueAt: string | null): string | null {
  if (!dueAt) return null;
  const ms = new Date(dueAt).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  if (ms <= 0) return "Due now";
  const hours = Math.round(ms / 3600000);
  if (hours < 1) return "Ends within the hour";
  if (hours < 48) return `Ends in ${hours} h`;
  return `Due ${new Date(dueAt).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Dublin" })}`;
}

/** `onAction` returns true when it handled the item in place (e.g. a poll's vote popup). */
export function NeedsList({ items, onAction }: { items: NeedsAttentionItem[]; onAction?: (item: NeedsAttentionItem) => boolean }) {
  if (items.length === 0) return null;
  const sorted = [...items].sort((a, b) => (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999"));
  return (
    <section className="mlx-section" aria-labelledby="mlx-needs">
      <h2 className="mlx-label" id="mlx-needs">Needs you</h2>
      <ul className="mlx-needs">
        {sorted.map((it) => {
          const due = dueLabel(it.dueAt);
          return (
            <li key={it.id}>
              <span className="mlx-needs-main">
                <strong>{it.title}</strong>
                {it.description && <span>{it.description}</span>}
              </span>
              <span className={due ? "mlx-needs-when is-due" : "mlx-needs-when"}>{due ?? ACTION_LABEL[it.actionType]}</span>
              <Link className="mlx-link" to={it.actionUrl} onClick={(e) => { if (onAction?.(it)) e.preventDefault(); }}>{it.actionLabel}</Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------- nothing booked
export function NothingBooked({ hasIdeas, onFind }: { hasIdeas: boolean; onFind: () => void }) {
  return (
    <section className="mlx-nothing" aria-labelledby="mlx-nothing-title">
      <p className="mlx-label">Next up</p>
      <h2 className="mlx-nothing-title" id="mlx-nothing-title">Nothing booked yet.</h2>
      <p className="mlx-muted">{hasIdeas ? "Here are a few things on this week that suit you." : "Activities, bookings and programme sessions you join will show here."}</p>
      <div>
        <button type="button" className="mlx-btn" onClick={onFind}>Find something to do</button>
      </div>
    </section>
  );
}

function Photo({ src, title, className }: { src: string | null; title: string; className: string }) {
  return (
    <div className={`${className}${src ? "" : " is-empty"}`}>
      {src ? <img src={src} alt="" loading="lazy" /> : <span aria-hidden="true">{activityIcon(title, 40)}</span>}
    </div>
  );
}

// ---------------------------------------------------------------- ideas
export type IdeaTile = { key: string; kind: "circle" | "again" | "saved"; title: string; meta: string; image: string | null; href: string };
const KIND_LABEL: Record<IdeaTile["kind"], string> = { circle: "Your Circle", again: "Do it again", saved: "Saved" };

export function IdeaTiles({ tiles, title }: { tiles: IdeaTile[]; title: string }) {
  if (tiles.length === 0) return null;
  return (
    <section className="mlx-section" aria-labelledby="mlx-ideas">
      <h2 className="mlx-label" id="mlx-ideas">{title}</h2>
      <ul className={`mlx-tiles mlx-tiles--${Math.min(tiles.length, 3)}`}>
        {tiles.map((t) => (
          <li key={t.key}>
            <Link to={t.href} className="mlx-tile">
              <Photo src={t.image} title={t.title} className="mlx-tile-img" />
              <span className="mlx-tile-text">
                <small className={`mlx-kind mlx-kind--${t.kind}`}>{KIND_LABEL[t.kind]}</small>
                <strong>{t.title}</strong>
                <span>{t.meta}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------- life highlights
export type WeekBar = { label: string; count: number; current: boolean };

/** Life highlights (owner 2026-10-26: "redesign much better"). All from real
 * participation dates: this month vs last month, the last 8 weeks as a small
 * labelled chart, and what you did most this month. Says "joined", never
 * "attended" (the feed doesn't know you went unless you were checked in). */
export function ActivitySummary({
  monthName,
  month,
  lastMonth,
  distinct,
  weeks,
  top,
  onSeeAll,
  extra,
}: {
  monthName: string;
  month: number;
  lastMonth: number;
  distinct: number;
  /** Oldest first. */
  weeks: WeekBar[];
  top: { title: string; count: number }[];
  onSeeAll: () => void;
  extra?: ReactNode;
}) {
  const max = Math.max(1, ...weeks.map((w) => w.count));
  const active = weeks.filter((w) => w.count > 0).length;
  const diff = month - lastMonth;
  const compare =
    lastMonth === 0 ? (month > 0 ? "Your first busy month here." : null) : diff > 0 ? `${diff} more than last month` : diff < 0 ? `${-diff} fewer than last month` : "Same as last month";
  return (
    <section className="mlx-section mlx-boxed mlx-hl" aria-labelledby="mlx-activity">
      <div className="mlx-section-head">
        <h2 className="mlx-label" id="mlx-activity">Life highlights</h2>
        <span style={{ display: "flex", gap: 10 }}>
          {extra}
          <button type="button" className="mlx-link" onClick={onSeeAll}>See all</button>
        </span>
      </div>

      <div className="mlx-hl-grid">
        <div className="mlx-hl-lead">
          <p className="mlx-hl-num">{month}</p>
          <p className="mlx-hl-what">
            {month === 1 ? "thing" : "things"} you joined in {monthName}
          </p>
          {compare && <p className={`mlx-hl-compare${diff > 0 ? " is-up" : ""}`}>{diff > 0 ? "↑ " : diff < 0 ? "↓ " : ""}{compare}</p>}
          <dl className="mlx-hl-facts">
            <div><dt>Different activities</dt><dd>{distinct}</dd></div>
            <div><dt>Active weeks</dt><dd>{active}<small> of {weeks.length}</small></dd></div>
          </dl>
        </div>

        <figure className="mlx-hl-chart" aria-label={`Things you joined each week, last ${weeks.length} weeks: ${weeks.map((w) => `${w.label} ${w.count}`).join(", ")}`}>
          <figcaption className="mlx-hl-cap">Last {weeks.length} weeks</figcaption>
          <div className="mlx-hl-bars" aria-hidden="true">
            {weeks.map((w, i) => (
              <div key={i} className={`mlx-hl-bar${w.current ? " is-now" : ""}${w.count === 0 ? " is-zero" : ""}`}>
                <span className="mlx-hl-count">{w.count > 0 ? w.count : ""}</span>
                <i style={{ height: `${Math.max(w.count ? 10 : 4, Math.round((w.count / max) * 100))}%` }} />
                <span className="mlx-hl-wk">{w.label}</span>
              </div>
            ))}
          </div>
        </figure>
      </div>

      {top.length > 0 && (
        <div className="mlx-hl-top">
          <p className="mlx-hl-cap">What you did most in {monthName}</p>
          <ol>
            {top.map((t, i) => (
              <li key={t.title}>
                <span className="mlx-hl-rank">{i + 1}</span>
                <strong>{t.title}</strong>
                <span className="mlx-hl-times">{t.count}×</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- more for you
export function MoreLinks({ links, title = "More for you" }: { links: { label: string; onClick: () => void }[]; title?: string }) {
  if (links.length === 0) return null;
  return (
    <nav className="mlx-section" aria-labelledby="mlx-more">
      <h2 className="mlx-label" id="mlx-more">{title}</h2>
      <ul className="mlx-more">
        {links.map((l) => (
          <li key={l.label}>
            <button type="button" onClick={l.onClick}>
              {l.label} <span aria-hidden="true">→</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Closing line in the same minimal style (replaces the green band here). */
export function ClosingPrompt({ onInterest, onFind }: { onInterest: () => void; onFind: () => void }) {
  return (
    <section className="mlx-closing" aria-labelledby="mlx-closing-title">
      <div>
        <h2 className="mlx-closing-title" id="mlx-closing-title">What do you want to do next?</h2>
        <p className="mlx-muted">Tell HelloCircle what you're up for. We'll let you know when something nearby matches.</p>
      </div>
      <div className="mlx-closing-actions">
        <button type="button" className="mlx-btn" onClick={onFind}>Find plans</button>
        <button type="button" className="mlx-link" onClick={onInterest}>Add my interest</button>
      </div>
    </section>
  );
}
