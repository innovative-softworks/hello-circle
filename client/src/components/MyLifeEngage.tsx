import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Activity, ArrowRight, Award, Building2, Check, Clock3, GraduationCap, HeartHandshake, Lock, Mountain, Sparkles, Stamp, Trophy, UsersRound, X } from "lucide-react";
import { fetchFreeTimeOptions, fetchPassport, saveOnboarding, submitIntent, type Passport } from "../api";
import { FormModal } from "../pages/account/accountUi";
import { IRISH_COUNTY_COORDS } from "../irishCounties";
import { AVAILABILITY_PRESETS } from "../participationVocab";
import { INTEREST_OPTIONS } from "../types";
import { trackEvent } from "../analytics";
import { useGuest } from "../GuestContext";
import { getMediaUrl } from "../media";
import { irelandDaysFromToday, irelandToday } from "../irelandDate";
import type { DiscoverItem } from "../types";
import { CardView, shortDay, type UpcomingCard } from "./MyLifeOverview";
import "../pages/myLife.css";

// My Life 3.0 (owner 2026-10-25, docs/my-life-3/): the engagement sections,
// in the same photo-and-type style as the rest of My Life. Every item comes
// from real data (Free Time Mode's matching, needs-attention, follows, chat
// unread counts, the for-you ranking, the Passport). Nothing books anything.

const dayFmt = (iso: string, o: Intl.DateTimeFormatOptions) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-IE", { ...o, timeZone: "Europe/Dublin" });

function Head({ id, label, action }: { id: string; label: string; action?: ReactNode }) {
  return (
    <div className="mlx-section-head">
      <h2 className="mlx-label" id={id}>{label}</h2>
      {action}
    </div>
  );
}

// ---------------------------------------------------------------- what are you up for?
type What = "active" | "people" | "easy" | "new" | "learn" | "give" | "outdoors" | "friends";
type When = "today" | "tomorrow" | "weekend" | "date" | "any";
type Who = "me" | "friends" | "family" | "meet";

const WHAT: { key: What; label: string }[] = [
  { key: "active", label: "Get active" },
  { key: "people", label: "Meet people" },
  { key: "easy", label: "Take it easy" },
  { key: "new", label: "Try something new" },
  { key: "learn", label: "Learn something" },
  { key: "give", label: "Give back" },
  { key: "outdoors", label: "Be outdoors" },
  { key: "friends", label: "Something with friends" },
];
const WHEN: { key: When; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "tomorrow", label: "Tomorrow" },
  { key: "weekend", label: "This weekend" },
  { key: "date", label: "Choose a date" },
  { key: "any", label: "I'm flexible" },
];
const WHO: { key: Who; label: string }[] = [
  { key: "me", label: "Just me" },
  { key: "friends", label: "With friends" },
  { key: "family", label: "With family" },
  { key: "meet", label: "Open to meeting people" },
];

// Existing Free Time moods (server MOOD_KEYWORDS): move, social, chill, learn.
const MOOD: Partial<Record<What, string>> = { active: "move", people: "social", easy: "chill", learn: "learn", friends: "social" };
const OUTDOOR_WORDS = ["walk", "hike", "park", "outdoor", "swim", "sea", "cycl", "run", "trail", "beach", "kayak", "surf"];

function weekendDates(today: string): string[] {
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 Sun … 6 Sat
  if (dow === 0) return [today];
  const toSat = 6 - dow;
  return [irelandDaysFromToday(toSat), irelandDaysFromToday(toSat + 1)];
}

function Chips<T extends string>({ label, options, value, onChange }: { label: string; options: { key: T; label: string }[]; value: T | null; onChange: (v: T) => void }) {
  return (
    <fieldset className="mlx-q">
      <legend className="mlx-q-label">{label}</legend>
      <div className="mlx-q-chips">
        {options.map((o) => (
          <button key={o.key} type="button" aria-pressed={value === o.key} onClick={() => onChange(o.key)}>
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** "What are you up for?" — real listings from Free Time Mode's matching
 * (/discover/free-time), narrowed here by date and group size. */
export function IntentFinder({ soloOn }: { soloOn: boolean }) {
  const navigate = useNavigate();
  const [what, setWhat] = useState<What | null>(null);
  const [when, setWhen] = useState<When>("any");
  const [date, setDate] = useState(irelandDaysFromToday(1));
  const [who, setWho] = useState<Who>("me");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<DiscoverItem[] | null>(null);
  const [failed, setFailed] = useState(false);

  const find = async () => {
    setBusy(true);
    setFailed(false);
    const today = irelandToday();
    const dates = when === "today" ? [today] : when === "tomorrow" ? [irelandDaysFromToday(1)] : when === "weekend" ? weekendDates(today) : when === "date" ? [date] : null;
    trackEvent("mylife_intent_submitted", { what: what ?? "any", when, who });
    try {
      const rows = await fetchFreeTimeOptions({
        mood: what ? MOOD[what] : undefined,
        when: when === "any" ? undefined : when === "date" ? date : when,
        solo: soloOn && who === "me" ? true : undefined,
        limit: 40,
      });
      const groupSize = who === "friends" ? 3 : who === "family" ? 3 : 1;
      const filtered = rows
        .filter((r) => !dates || dates.includes(r.date))
        .filter((r) => (what === "give" ? r.experienceKind === "volunteer" : true))
        .filter((r) => (what === "outdoors" ? OUTDOOR_WORDS.some((w) => r.title.toLowerCase().includes(w)) : true))
        .filter((r) => r.spotsLeft === null || r.spotsLeft >= groupSize)
        .filter((r) => (who === "meet" ? (r.joined ?? 0) > 0 : true))
        .slice(0, 6);
      setResults(filtered);
    } catch {
      setFailed(true);
      setResults(null);
    } finally {
      setBusy(false);
    }
  };

  const cards: UpcomingCard[] = (results ?? []).map((r) => ({
    key: `${r.kind}-${r.id}`,
    date: r.date,
    dateLabel: r.date === irelandToday() ? "Today" : r.date === irelandDaysFromToday(1) ? "Tomorrow" : shortDay(r.date),
    time: r.time,
    title: r.title,
    meta: [r.centreName ?? r.clubName ?? r.area, r.priceCents ? `€${(r.priceCents / 100).toFixed(2).replace(/\.00$/, "")}` : "Free"].filter(Boolean).join(" · "),
    kind: "mine",
    kindLabel: r.matchReasons?.[0] ?? (r.fitLabel ?? "Matches your choices"),
    image: r.imageUrl ? getMediaUrl(r.imageUrl, "card") : null,
    onOpen: () => {
      trackEvent("mylife_intent_result_opened", { kind: r.kind });
      navigate(r.href);
    },
  }));

  return (
    <section className="mlx-section mlx-intent" aria-labelledby="mlx-intent">
      <Head id="mlx-intent" label="What are you up for?" />
      <Chips label="What" options={WHAT} value={what} onChange={setWhat} />
      <Chips label="When are you free?" options={WHEN} value={when} onChange={setWhen} />
      {when === "date" && (
        <label className="mlx-q-date">
          <span className="mlx-q-label">Date</span>
          <input type="date" min={irelandToday()} value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      )}
      <Chips label="Who's coming?" options={WHO} value={who} onChange={setWho} />
      <div className="mlx-intent-go">
        <button type="button" className="mlx-btn" onClick={find} disabled={busy} aria-busy={busy}>
          {busy ? "Finding…" : "Find something for me"}
        </button>
        <Link className="mlx-link" to="/free-time">More options in Free time</Link>
      </div>
      <div aria-live="polite">
        {failed && <p className="mlx-muted">That search didn't load. Try again.</p>}
        {results && results.length === 0 && (
          <p className="mlx-muted">Nothing matches all of that yet. Try "I'm flexible", or another kind of thing to do.</p>
        )}
        {cards.length > 0 && (
          <ul className="mlx-grid" style={{ marginTop: 8 }}>
            {cards.map((c) => (
              <li key={c.key}>
                <CardView c={c} />
              </li>
            ))}
          </ul>
        )}
        {cards.length > 0 && <p className="mlx-muted" style={{ fontSize: 13, marginTop: 10 }}>Real listings. Places, prices and times are checked again when you join or book.</p>}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- pulse
export type PulseItem = {
  key: string;
  source: string;
  title: string;
  context: string;
  when: string | null;
  actionLabel: string;
  href: string;
  /** Booking/payment/offer items: always first, never dismissible. */
  critical: boolean;
  unread?: number;
  /** When set, the action opens in place (e.g. a poll's vote popup) instead of following href. */
  onAction?: () => void;
};

function ago(iso: string | null): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const mins = Math.round((Date.now() - t) / 60000);
  // A future time is a deadline (an offer or a poll closing).
  if (mins < -60 * 48) return `until ${dayFmt(iso.slice(0, 10), { weekday: "short", day: "numeric", month: "short" })}`;
  if (mins < -60) return `ends in ${Math.round(-mins / 60)} h`;
  if (mins < 0) return "ends within the hour";
  if (mins < 60) return `${Math.max(mins, 1)} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  return `${Math.round(mins / 1440)} d ago`;
}

export function PulseList({ items, onDismiss, onOpen }: { items: PulseItem[]; onDismiss: (key: string) => void; onOpen: (item: PulseItem) => void }) {
  const [all, setAll] = useState(false);
  if (items.length === 0) return null;
  const shown = all ? items : items.slice(0, 3);
  return (
    <section className="mlx-section" aria-labelledby="mlx-pulse">
      <Head
        id="mlx-pulse"
        label="Pulse"
        action={items.length > 3 ? <button type="button" className="mlx-link" aria-expanded={all} onClick={() => setAll((v) => !v)}>{all ? "Show fewer" : `See all ${items.length}`}</button> : undefined}
      />
      <ul className="mlx-pulse">
        {shown.map((it) => (
          <li key={it.key} className={it.critical ? "is-critical" : undefined}>
            <span className="mlx-pulse-source">{it.source}</span>
            <span className="mlx-pulse-main">
              <strong>
                {it.title}
                {it.unread ? <span className="mlx-unread" aria-label={`${it.unread} unread`}>{it.unread}</span> : null}
              </strong>
              <span>{[it.context, ago(it.when)].filter(Boolean).join(" · ")}</span>
            </span>
            <span className="mlx-pulse-actions">
              {it.onAction ? (
                <button type="button" className="mlx-link" onClick={() => { onOpen(it); it.onAction?.(); }}>{it.actionLabel}</button>
              ) : (
                <Link className="mlx-link" to={it.href} onClick={() => onOpen(it)}>{it.actionLabel}</Link>
              )}
              {!it.critical && (
                <button type="button" className="mlx-x" aria-label={`Hide: ${it.title}`} onClick={() => onDismiss(it.key)}>
                  <X size={16} aria-hidden="true" />
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------- made for your week
export type Suggestion = UpcomingCard & { reason: string; dismissKey: string };

export function MadeForWeek({ items, onDismiss, title = "Made for your week", seeAll }: { items: Suggestion[]; onDismiss: (key: string) => void; title?: string; seeAll?: ReactNode }) {
  if (items.length === 0) return null;
  return (
    <section className="mlx-section" aria-labelledby={`mlx-mfw-${title.replace(/\W+/g, "")}`}>
      <Head id={`mlx-mfw-${title.replace(/\W+/g, "")}`} label={title} action={seeAll} />
      <ul className="mlx-cards" aria-label={title}>
        {items.map((s) => (
          <li key={s.key} className="mlx-sugg">
            <CardView c={{ ...s, kindLabel: s.reason }} />
            <button type="button" className="mlx-x mlx-sugg-x" aria-label={`Not for me: ${s.title}`} onClick={() => onDismiss(s.dismissKey)}>
              <X size={16} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------- mini calendar (right panel)
export function MiniCalendar({ days, onOpen }: { days: Set<string>; onOpen: () => void }) {
  const today = irelandToday();
  const [y, m] = [Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1];
  const first = new Date(Date.UTC(y, m, 1));
  const lead = (first.getUTCDay() + 6) % 7; // Monday first
  const count = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: count }, (_, i) => `${today.slice(0, 7)}-${String(i + 1).padStart(2, "0")}`)];
  return (
    <section className="mlx-section" aria-labelledby="mlx-cal">
      <Head id="mlx-cal" label={first.toLocaleDateString("en-IE", { month: "long", year: "numeric", timeZone: "UTC" })} action={<button type="button" className="mlx-link" onClick={onOpen}>Calendar</button>} />
      <div className="mlx-mini" role="grid" aria-label="This month">
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
          <span key={`h${i}`} className="mlx-mini-h" aria-hidden="true">{d}</span>
        ))}
        {cells.map((c, i) =>
          c ? (
            <span key={c} role="gridcell" className={`mlx-mini-d${c === today ? " is-today" : ""}${days.has(c) ? " has" : ""}${c < today ? " is-past" : ""}`} aria-label={`${dayFmt(c, { weekday: "long", day: "numeric", month: "long" })}${days.has(c) ? ", something on" : ""}`}>
              {Number(c.slice(8))}
            </span>
          ) : (
            <span key={`e${i}`} aria-hidden="true" />
          ),
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- Passport
type PEntry = Passport["entries"][number];
const STAMPS: { kind: PEntry["kind"]; label: string; icon: ReactNode }[] = [
  { kind: "activity", label: "Activities", icon: <Activity size={22} /> },
  { kind: "adventure", label: "Adventures", icon: <Mountain size={22} /> },
  { kind: "experience", label: "Experiences", icon: <Sparkles size={22} /> },
  { kind: "volunteering", label: "Volunteering", icon: <HeartHandshake size={22} /> },
  { kind: "programme", label: "Programmes", icon: <GraduationCap size={22} /> },
  { kind: "club", label: "Clubs", icon: <Trophy size={22} /> },
  { kind: "hall", label: "Hall bookings", icon: <Building2 size={22} /> },
  { kind: "circle", label: "Circles joined", icon: <UsersRound size={22} /> },
];
const KIND: Record<PEntry["kind"], string> = {
  activity: "Activity", adventure: "Adventure", experience: "Experience", volunteering: "Volunteering",
  programme: "Programme session", hall: "Hall booking", club: "Club", circle: "Joined a Circle",
};
const EVIDENCE: Record<PEntry["evidence"], { text: string; tone: "ok" | "you" | "plain" }> = {
  organiser: { text: "Checked in", tone: "ok" },
  you: { text: "You said you went", tone: "you" },
  joined: { text: "Joined", tone: "plain" },
};
const monthYear = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-IE", { month: "long", year: "numeric", timeZone: "Europe/Dublin" });

// Recognition levels from real counts only (owner 2026-10-26: "badge with
// recognition value"). No streaks, no comparison with anyone.
const TIERS = [
  { name: "Gold", min: 10 },
  { name: "Silver", min: 5 },
  { name: "Bronze", min: 1 },
] as const;
const tierOf = (n: number) => TIERS.find((t) => n >= t.min) ?? null;
const nextTier = (n: number) => [...TIERS].reverse().find((t) => t.min > n) ?? null;
const INK: Record<PEntry["kind"], string> = {
  activity: "#c2410c", adventure: "#1f5f99", experience: "#6d4aa8", volunteering: "#1f7a4d",
  programme: "#0f7676", club: "#9b2350", hall: "#8a5a1f", circle: "#d7380f",
};
const TILT = [-7, 5, -3, 8, -5, 3, -8, 6];
const stampDate = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-IE", { day: "2-digit", month: "short", year: "numeric", timeZone: "Europe/Dublin" }).toUpperCase();

/** One passport ink stamp: the kind around the rim, icon and count in the
 * middle, the date of the first one, and a recognition level. */
function PassportStamp({ kind, label, icon, count, first, index }: { kind: PEntry["kind"]; label: string; icon: ReactNode; count: number; first: string | null; index: number }) {
  const on = count > 0;
  const tier = tierOf(count);
  const next = nextTier(count);
  const id = `pp-arc-${kind}`;
  return (
    <li className={`mlx-stamp${on ? " is-on" : " is-off"}`} style={{ ["--ink" as string]: on ? INK[kind] : "var(--color-faint)", ["--tilt" as string]: `${on ? TILT[index % TILT.length] : 0}deg` }}>
      <div className="mlx-stamp-seal" role="img" aria-label={on ? `${label} stamp: ${count} ${count === 1 ? "time" : "times"}${tier ? `, ${tier.name} level` : ""}${first ? `, first on ${stampDate(first)}` : ""}` : `${label}: not yet`}>
        <svg viewBox="0 0 160 160" aria-hidden="true">
          <defs>
            <path id={`${id}-top`} d="M 24 80 A 56 56 0 0 1 136 80" />
            <path id={`${id}-bot`} d="M 30 84 A 50 50 0 0 0 130 84" />
          </defs>
          <circle cx="80" cy="80" r="74" className="mlx-stamp-ring" />
          <circle cx="80" cy="80" r="66" className="mlx-stamp-ring2" />
          <text className="mlx-stamp-arc"><textPath href={`#${id}-top`} startOffset="50%" textAnchor="middle">{label.toUpperCase()}</textPath></text>
          <text className="mlx-stamp-arc mlx-stamp-arc--small"><textPath href={`#${id}-bot`} startOffset="50%" textAnchor="middle">{on && first ? stampDate(first) : "HELLOCIRCLE"}</textPath></text>
        </svg>
        <span className="mlx-stamp-core">
          <span className="mlx-stamp-icon">{icon}</span>
          <b>{on ? `${count}×` : "Not yet"}</b>
        </span>
      </div>
      {tier ? (
        <span className={`mlx-stamp-tier mlx-stamp-tier--${tier.name.toLowerCase()}`}>{tier.name}</span>
      ) : (
        <span className="mlx-stamp-tier mlx-stamp-tier--none">Not earned yet</span>
      )}
      {on && <span className="mlx-stamp-next">{next ? `${next.min - count} more for ${next.name}` : "Top level"}</span>}
    </li>
  );
}

/** The Activity Passport (owner 2026-10-26 redesign): a private record of
 * things you actually took part in. Used by the My Life Passport tab and by
 * /my-life/passport. Counts and stamps come only from real entries; a kind
 * you haven't done shows as "not yet", never a guess. */
/** `showTitle`: the cover's "Your Activity Passport" heading (the full page
 * already has it as its page title, so it hides it there). */
export function PassportView({ showTitle = true }: { showTitle?: boolean }) {
  const [data, setData] = useState<Passport | null>(null);
  const [failed, setFailed] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const holder = useGuest().resident?.name ?? null;
  const load = () => {
    setFailed(false);
    fetchPassport().then(setData).catch(() => setFailed(true));
  };
  useEffect(load, []);
  if (failed) return <p className="mlx-muted">We couldn't load your Passport. <button type="button" className="mlx-link" onClick={load}>Try again</button></p>;
  if (!data) return <p className="mlx-muted">Loading your Passport…</p>;

  const entries = [...data.entries].sort((a, b) => b.date.localeCompare(a.date));
  const took = entries.filter((e) => e.kind !== "circle");
  const checkedIn = entries.filter((e) => e.evidence === "organiser").length;
  const since = entries.length ? entries[entries.length - 1].date.slice(0, 10) : null;
  const byKind = new Map<PEntry["kind"], PEntry[]>();
  for (const e of entries) byKind.set(e.kind, [...(byKind.get(e.kind) ?? []), e]);
  const months: { key: string; label: string; list: PEntry[] }[] = [];
  for (const e of entries) {
    const key = e.date.slice(0, 7);
    let m = months.find((x) => x.key === key);
    if (!m) months.push((m = { key, label: monthYear(e.date), list: [] }));
    m.list.push(e);
  }
  const shownMonths = showAll ? months : months.slice(0, 3);

  if (entries.length === 0) {
    return (
      <div className="mlx-pp-empty">
        <span className="mlx-pp-seal" aria-hidden="true"><Stamp size={30} /></span>
        <h2 className="mlx-nothing-title">Your story starts here.</h2>
        <p className="mlx-muted">Each time an organiser checks you in, or you confirm you went, it gets a stamp here. Only you can see it.</p>
        <div><Link className="mlx-btn" to="/explore">Find something to do</Link></div>
      </div>
    );
  }

  return (
    <div className="mlx-pp">
      <section className="mlx-pp-cover" aria-labelledby="mlx-pp-title">
        <div className="mlx-pp-cover-text">
          <p className="mlx-pp-crest" aria-hidden="true">HelloCircle · Ireland</p>
          <p className="mlx-pp-kicker"><Lock size={13} aria-hidden="true" /> Private · only you can see this</p>
          {/* On the full Passport page the page title already says it. */}
          <h2 className={showTitle ? "mlx-pp-title" : "mlx-sr"} id="mlx-pp-title">Your Activity Passport</h2>
          <dl className="mlx-pp-id">
            {holder && <div><dt>Holder</dt><dd>{holder}</dd></div>}
            {since && <div><dt>Issued</dt><dd>{stampDate(since)}</dd></div>}
            <div><dt>Stamps</dt><dd>{STAMPS.filter((st) => (byKind.get(st.kind)?.length ?? 0) > 0).length} of {STAMPS.length}</dd></div>
          </dl>
        </div>
        <dl className="mlx-pp-stats">
          <div><dt>Things you took part in</dt><dd>{took.length}</dd></div>
          <div><dt>Checked in by organisers</dt><dd>{checkedIn}</dd></div>
          <div><dt>Firsts</dt><dd>{data.milestones.length}</dd></div>
          <div><dt>Circles joined</dt><dd>{byKind.get("circle")?.length ?? 0}</dd></div>
        </dl>
      </section>

      <section className="mlx-section" aria-labelledby="mlx-pp-stamps">
        <h2 className="mlx-label" id="mlx-pp-stamps">Your stamps</h2>
        <ul className="mlx-pp-stamps">
          {STAMPS.map((st, i) => {
            const list = byKind.get(st.kind) ?? [];
            const first = list.length ? list[list.length - 1].date : null;
            return <PassportStamp key={st.kind} kind={st.kind} label={st.label} icon={st.icon} count={list.length} first={first} index={i} />;
          })}
        </ul>
        <p className="mlx-muted" style={{ fontSize: 13.5 }}>Levels come from how many times you've taken part: Bronze from 1, Silver from 5, Gold from 10.</p>
      </section>

      {data.milestones.length > 0 && (
        <section className="mlx-section" aria-labelledby="mlx-firsts">
          <h2 className="mlx-label" id="mlx-firsts">Firsts</h2>
          <ul className="mlx-pp-firsts">
            {data.milestones.map((m) => (
              <li key={m.key}>
                <span className="mlx-pp-badge" aria-hidden="true"><Award size={20} /></span>
                <span>
                  <strong>{m.label}</strong>
                  <span>{m.title} · {dayFmt(m.date.slice(0, 10), { day: "numeric", month: "short", year: "numeric" })}</span>
                </span>
              </li>
            ))}
          </ul>
          {data.memoriesShared > 0 && <p className="mlx-muted" style={{ fontSize: 14 }}>You've shared {data.memoriesShared} {data.memoriesShared === 1 ? "memory" : "memories"} with your Circles.</p>}
        </section>
      )}

      {(() => {
        // "Your record": facts worked out from your real Passport entries only.
        const counts = new Map<string, number>();
        for (const e of took) counts.set(e.title, (counts.get(e.title) ?? 0) + 1);
        const fav = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
        const byMonth = new Map<string, number>();
        for (const e of took) byMonth.set(e.date.slice(0, 7), (byMonth.get(e.date.slice(0, 7)) ?? 0) + 1);
        const busiest = [...byMonth.entries()].sort((a, b) => b[1] - a[1])[0];
        const days = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
        const byDay = new Array(7).fill(0);
        for (const e of took) byDay[new Date(`${e.date.slice(0, 10)}T12:00:00Z`).getUTCDay()] += 1;
        const topDay = byDay.indexOf(Math.max(...byDay));
        const said = took.filter((e) => e.evidence === "you").length;
        const latest = entries[0];
        const facts: { label: string; value: string; note?: string }[] = [
          { label: "First stamp", value: since ? stampDate(since) : "—", note: entries.length ? entries[entries.length - 1].title : undefined },
          { label: "Latest stamp", value: latest ? stampDate(latest.date) : "—", note: latest?.title },
          { label: "Done most", value: fav ? `${fav[1]}×` : "Nothing yet", note: fav?.[0] },
          { label: "Busiest month", value: busiest ? monthYear(`${busiest[0]}-01`) : "Nothing yet", note: busiest ? `${busiest[1]} ${busiest[1] === 1 ? "thing" : "things"}` : undefined },
          { label: "You're out most on", value: took.length ? days[topDay] : "Nothing yet" },
          { label: "How it was confirmed", value: `${checkedIn} checked in`, note: `${said} you said you went` },
          { label: "Memories shared", value: String(data.memoriesShared), note: "with your Circles" },
          { label: "Kinds of activity", value: `${new Set(took.map((e) => e.kind)).size} of ${STAMPS.length - 1}` },
        ];
        const circleEntries = byKind.get("circle") ?? [];
        return (
          <>
            <section className="mlx-section" aria-labelledby="mlx-pp-record">
              <h2 className="mlx-label" id="mlx-pp-record">Your record</h2>
              <dl className="mlx-pp-record">
                {facts.map((f) => (
                  <div key={f.label}>
                    <dt>{f.label}</dt>
                    <dd>{f.value}</dd>
                    {f.note && <span>{f.note}</span>}
                  </div>
                ))}
              </dl>
            </section>
            {circleEntries.length > 0 && (
              <section className="mlx-section" aria-labelledby="mlx-pp-circles">
                <h2 className="mlx-label" id="mlx-pp-circles">Circles you joined</h2>
                <ul className="mlx-pp-visas">
                  {circleEntries.map((e, i) => (
                    <li key={`${e.title}-${i}`}>
                      {e.href ? <Link to={e.href}>{e.title}</Link> : <span>{e.title}</span>}
                      <small>Joined {stampDate(e.date)}</small>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        );
      })()}

      <section className="mlx-section" aria-labelledby="mlx-pp-tl">
        <div className="mlx-section-head">
          <h2 className="mlx-label" id="mlx-pp-tl">Timeline</h2>
          {months.length > 3 && (
            <button type="button" className="mlx-link" aria-expanded={showAll} onClick={() => setShowAll((v) => !v)}>{showAll ? "Show less" : `Show all ${months.length} months`}</button>
          )}
        </div>
        {shownMonths.map((m) => (
          <div key={m.key} className="mlx-pp-month">
            <h3 className="mlx-label">{m.label} <span className="mlx-muted" style={{ fontSize: 14, fontWeight: 500 }}>· {m.list.length}</span></h3>
            <ol className="mlx-pp-list">
              {m.list.map((e, i) => {
                const ev = EVIDENCE[e.evidence];
                const inner = (
                  <>
                    <span className="mlx-pp-day" aria-hidden="true">
                      <b>{Number(e.date.slice(8, 10))}</b>
                      <small>{dayFmt(e.date.slice(0, 10), { weekday: "short" })}</small>
                    </span>
                    <span className="mlx-pp-main">
                      <strong>{e.title}</strong>
                      <span>{KIND[e.kind]}</span>
                    </span>
                    <span className={`mlx-pp-ev mlx-pp-ev--${ev.tone}`}>{ev.tone === "ok" && <Check size={13} aria-hidden="true" />}{ev.text}</span>
                  </>
                );
                return <li key={`${e.kind}-${e.date}-${i}`}>{e.href ? <Link to={e.href} className="mlx-pp-row">{inner}</Link> : <span className="mlx-pp-row">{inner}</span>}</li>;
              })}
            </ol>
          </div>
        ))}
        <p className="mlx-muted" style={{ fontSize: 13.5 }}>Missing something? It appears once the organiser checks you in or, for activities, once you confirm you went on the activity's page.</p>
      </section>
    </div>
  );
}

/** My Life tab wrapper. */
export function PassportTab() {
  return <PassportView />;
}

// ---------------------------------------------------------------- popups (owner 2026-10-26: forms in a popup, not a separate page)
const COUNTIES = Object.keys(IRISH_COUNTY_COORDS).sort();

/** What you're into + when you're free. Saves only these two fields (the
 * onboarding save keeps everything else as it is). */
export function PreferencesModal({ open, onClose, interests, availability, onSaved }: { open: boolean; onClose: () => void; interests: string[]; availability: string[]; onSaved: () => void }) {
  const [picked, setPicked] = useState<string[]>(interests);
  const [free, setFree] = useState<string[]>(availability);
  useEffect(() => {
    if (open) {
      setPicked(interests);
      setFree(availability);
    }
  }, [open, interests, availability]);
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const presetOn = (tokens: string[]) => tokens.every((t) => free.includes(t));
  const dirty = JSON.stringify([...picked].sort()) !== JSON.stringify([...interests].sort()) || JSON.stringify([...free].sort()) !== JSON.stringify([...availability].sort());
  return (
    <FormModal
      open={open}
      title="What you're into"
      subtitle="Used for your suggestions and Pulse. Change it any time."
      submitLabel="Save"
      dirty={dirty}
      size="wide"
      onClose={onClose}
      onSubmit={async () => {
        await saveOnboarding({ interests: picked, availability: free });
        trackEvent("mylife_preferences_saved", { interests: picked.length, freeTimes: free.length });
        onSaved();
      }}
    >
      <fieldset className="mlx-q">
        <legend className="mlx-q-label">Interests</legend>
        <div className="mlx-q-chips">
          {INTEREST_OPTIONS.map((o) => (
            <button key={o} type="button" aria-pressed={picked.includes(o)} onClick={() => setPicked((p) => toggle(p, o))}>{o}</button>
          ))}
        </div>
      </fieldset>
      <fieldset className="mlx-q">
        <legend className="mlx-q-label">When you're usually free</legend>
        <div className="mlx-q-chips">
          {AVAILABILITY_PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              aria-pressed={presetOn(p.tokens)}
              onClick={() => setFree((f) => (presetOn(p.tokens) ? f.filter((t) => !p.tokens.includes(t)) : [...new Set([...f, ...p.tokens])]))}
            >
              {p.label}
            </button>
          ))}
        </div>
      </fieldset>
      <p className="mlx-muted" style={{ fontSize: 13.5 }}>
        Goals, distance, group size and budget are in <Link to="/profile?tab=preferences" onClick={onClose}>all preferences</Link>.
      </p>
    </FormModal>
  );
}

/** "Add my interest": tell HelloCircle something you'd like to do (an existing participation intent). */
export function AddInterestModal({ open, onClose, county, onAdded }: { open: boolean; onClose: () => void; county: string; onAdded: () => void }) {
  const [label, setLabel] = useState("");
  const [where, setWhere] = useState(county);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setLabel("");
      setWhere(county);
      setDate("");
      setTime("");
      setNotes("");
      setError(null);
    }
  }, [open, county]);
  return (
    <FormModal
      open={open}
      title="What would you like to do?"
      subtitle="We'll let you know when something nearby matches. Nothing is booked."
      submitLabel="Add my interest"
      dirty={!!(label || notes || date || time)}
      error={error}
      onClose={onClose}
      onSubmit={async () => {
        if (!label.trim()) {
          setError("Say what you'd like to do, for example padel or a sea swim.");
          return false;
        }
        if (!where) {
          setError("Choose a county.");
          return false;
        }
        setError(null);
        await submitIntent({ activityLabel: label.trim(), county: where, preferredDate: date || undefined, preferredTimeWindow: time || undefined, notes: notes.trim() || undefined, sourceQuery: "my_life" });
        trackEvent("mylife_interest_added", {});
        onAdded();
      }}
    >
      <label className="mlx-field">
        <span className="mlx-q-label">Activity</span>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Padel, sea swim, book club" autoFocus maxLength={80} />
      </label>
      <div className="mlx-field-row">
        <label className="mlx-field">
          <span className="mlx-q-label">County</span>
          <select value={where} onChange={(e) => setWhere(e.target.value)}>
            <option value="">Choose a county</option>
            {COUNTIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="mlx-field">
          <span className="mlx-q-label">Date (optional)</span>
          <input type="date" min={irelandToday()} value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="mlx-field">
          <span className="mlx-q-label">Time of day (optional)</span>
          <select value={time} onChange={(e) => setTime(e.target.value)}>
            <option value="">Any time</option>
            <option value="morning">Morning</option>
            <option value="afternoon">Afternoon</option>
            <option value="evening">Evening</option>
          </select>
        </label>
      </div>
      <label className="mlx-field">
        <span className="mlx-q-label">Anything else (optional)</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={500} placeholder="e.g. beginner, weekends only" />
      </label>
    </FormModal>
  );
}

// ---------------------------------------------------------------- free time prompt
/** Replaces the inline "What are you up for?" form on For You (owner
 * 2026-10-26: "remove this … free time mode button"): one line and the
 * existing tools, each on its own page. */
export function FreeTimePrompt({ planDay, forMe }: { planDay: boolean; forMe: boolean }) {
  return (
    <section className="mlx-freetime" aria-labelledby="mlx-freetime-t">
      <span className="mlx-freetime-icon" aria-hidden="true">
        <Clock3 size={26} />
      </span>
      <div className="mlx-freetime-text">
        <h2 className="mlx-freetime-title" id="mlx-freetime-t">Got some free time?</h2>
        <p>Tell us how long you've got and what you're in the mood for. We'll show real things on near you.</p>
      </div>
      <div className="mlx-freetime-actions">
        <Link className="mlx-btn" to="/free-time" onClick={() => trackEvent("mylife_freetime_opened", {})}>
          Find free time <ArrowRight size={17} aria-hidden="true" />
        </Link>
        {planDay && <Link className="mlx-btn mlx-btn--ghost" to="/plan-my-day">Plan a day</Link>}
        {forMe && <Link className="mlx-btn mlx-btn--ghost" to="/my-life/for-you">Ideas for you</Link>}
      </div>
    </section>
  );
}
