import type { DiscoverItem, Game } from "../types";
import { formatTime12h } from "../formatters";
import { irelandDaysFromToday } from "../irelandDate";

// The big date on a photo card, with the one label above it (card component,
// owner 2026-10-27). Used by every ListingCard that has a date, through
// ListingCard's `dateOn`; it shows only where the photo card look is on
// (<CardGrid>, `.lc-grid--b`). Rules: see the "Activity card labels" artifact.

/** "Tonight" (today from 17:00), "Today", "Tomorrow" or "Thu 29". */
export function bigDay(date: string, time?: string | null): string {
  if (date === irelandDaysFromToday(0)) return time && time >= "17:00" ? "Tonight" : "Today";
  if (date === irelandDaysFromToday(1)) return "Tomorrow";
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", timeZone: "Europe/Dublin" }).replace(",", "");
}

/** "HH:MM" now in Ireland. */
function irelandNowHhmm(): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Dublin", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
}
const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const hhmmOf = (mins: number) => `${String(Math.floor(mins / 60) % 24).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;

/** The end time ("HH:MM") when something is on right now: it started today
 * in Ireland and its length is known. Null otherwise. */
export function liveUntil(date: string, time: string, durationMinutes?: number | null): string | null {
  if (!durationMinutes || date !== irelandDaysFromToday(0)) return null;
  const now = minutesOf(irelandNowHhmm());
  const start = minutesOf(time);
  const end = start + durationMinutes;
  return now >= start && now < end ? hhmmOf(end) : null;
}

export type CardLabelTone = "mine" | "wait" | "full" | "hot" | "line" | "circle" | "plain";

/** The one label above the date. `hover` is what it swaps to on hover;
 * `link` makes the hover a shortcut to the card's own page. */
export interface CardLabel {
  rest: string;
  hover?: string;
  link?: string;
  tone: CardLabelTone;
  live?: boolean;
  /** Replaces the big date (e.g. "Now"). */
  big?: string;
}

const spots = (n: number) => `${n} spot${n === 1 ? "" : "s"} left`;

/** Everything a label can be decided from. Each card fills in what its data
 * has; a missing fact just skips that label. */
export interface CardFacts {
  date: string;
  time: string;
  durationMinutes?: number | null;
  /** Live by another rule (e.g. a session the server marks as on now). */
  isLive?: boolean;
  spotsLeft?: number | null;
  joined?: number | null;
  capacity?: number | null;
  minParticipants?: number | null;
  /** Waiting for enough people before it goes ahead. */
  pending?: boolean;
  comingSoon?: boolean;
  circleName?: string | null;
  createdAt?: string | null;
  soloFriendly?: boolean;
  /** "First-time friendly" in place of "Solo friendly" (Circle plans). */
  firstTimeFriendly?: boolean;
  joinedByMe?: boolean;
  waitlistedByMe?: boolean;
  joinRequested?: boolean;
}

/** The one label for a dated card: yours, then can't-book, then urgent,
 * then news. Null for an ordinary card, which shows just the date. */
export function cardLabel(f: CardFacts): CardLabel | null {
  const until = liveUntil(f.date, f.time, f.durationMinutes);
  if (until) return { rest: "Happening now", hover: `Until ${formatTime12h(until)}`, tone: "mine", live: true, big: "Now" };
  if (f.isLive) return { rest: "Happening now", tone: "mine", live: true, big: "Now" };
  if (f.joinedByMe) return { rest: "You're going", hover: f.joined ? `${f.joined} going` : undefined, tone: "mine" };
  if (f.waitlistedByMe) return { rest: "On the waitlist", hover: "We'll email you", tone: "wait" };
  if (f.joinRequested) return { rest: "Request sent", hover: "Waiting for the host", tone: "wait" };
  // Not bookable yet: nothing about places applies.
  if (f.comingSoon) return { rest: "Coming soon", hover: "Get told when it opens", tone: "line" };
  const left = f.spotsLeft;
  if (left !== null && left !== undefined && left <= 0) return { rest: "Fully booked", link: "Join the waitlist", tone: "full" };
  if (f.pending && f.minParticipants && (f.joined ?? 0) < f.minParticipants) {
    return { rest: `${f.minParticipants - (f.joined ?? 0)} more needed`, hover: `Goes ahead with ${f.minParticipants}`, tone: "hot" };
  }
  if (left !== null && left !== undefined && left <= 3) {
    return { rest: spots(left), hover: f.capacity && f.joined !== null && f.joined !== undefined ? `${f.joined} of ${f.capacity} going` : undefined, tone: "hot" };
  }
  if (f.date === irelandDaysFromToday(0) || f.date === irelandDaysFromToday(1)) return { rest: "Starts soon", hover: left ? spots(left) : undefined, tone: "hot" };
  if (f.circleName) return { rest: "Circle meetup", hover: f.circleName, tone: "circle" };
  const created = f.createdAt ? Date.parse(f.createdAt) : NaN;
  if (!Number.isNaN(created) && Date.now() - created < 7 * 24 * 3600 * 1000) {
    const days = Math.floor((Date.now() - created) / (24 * 3600 * 1000));
    return { rest: "New", hover: days === 0 ? "Added today" : days === 1 ? "Added yesterday" : `Added ${days} days ago`, tone: "plain" };
  }
  if (f.firstTimeFriendly) return { rest: "First-time friendly", hover: "People come on their own", tone: "plain" };
  if (f.soloFriendly) return { rest: "Solo friendly", hover: "People often come alone", tone: "plain" };
  return null;
}

/** An activity's label (Activities page, "More like this"). */
export function gameCardLabel(game: Game, joinedByMe = false): CardLabel | null {
  return cardLabel({
    date: game.date,
    time: game.time,
    durationMinutes: game.durationMinutes,
    spotsLeft: game.spotsLeft,
    joined: game.joined,
    capacity: game.capacity,
    minParticipants: game.minParticipants,
    pending: game.status === "pending_participants",
    comingSoon: game.effectiveLifecycle === "coming_soon",
    circleName: game.circleName,
    createdAt: game.createdAt,
    soloFriendly: game.soloFriendly,
    joinedByMe: joinedByMe || !!game.joinedByMe,
    waitlistedByMe: !!game.waitlistedByMe,
    joinRequested: game.joinRequestByMe === "requested",
  });
}

/** A Home / Explore item's label: an activity carries its `card` facts. */
export function discoverCardLabel(item: Pick<DiscoverItem, "date" | "time" | "isLive" | "spotsLeft" | "joined" | "card">): CardLabel | null {
  const c = item.card;
  return cardLabel({
    date: item.date,
    time: item.time,
    isLive: item.isLive,
    spotsLeft: item.spotsLeft,
    joined: item.joined,
    capacity: c?.capacity,
    minParticipants: c?.minParticipants,
    pending: c?.pending,
    comingSoon: c?.comingSoon,
    circleName: c?.circleName,
    createdAt: c?.createdAt,
    soloFriendly: c?.soloFriendly,
    joinedByMe: c?.joinedByMe,
    waitlistedByMe: c?.waitlistedByMe,
    joinRequested: c?.joinRequested,
  });
}

/** The same rules for a dated item that carries less detail (sessions,
 * experience dates, Circle plans). */
export function itemCardLabel(item: Omit<CardFacts, "durationMinutes"> & { durationMinutes?: number | null }): CardLabel | null {
  return cardLabel(item);
}

/** What goes on the photo: the label, the big date and the time. */
export function CardDate({ date, time, label, href, onGo }: { date: string; time?: string | null; label?: CardLabel | null; href?: string; onGo?: (to: string) => void }) {
  const swap = !!label && (!!label.hover || (!!label.link && !!href));
  return (
    <>
      {label && (
        <small className={`lc-date-label is-${label.tone}${label.live ? " is-live" : ""}`}>
          <span className={swap ? "lc-label-rest" : undefined}>{label.rest}</span>
          {label.link && href ? (
            <a
              className="lc-label-hover lc-label-link"
              href={href}
              tabIndex={-1}
              onClick={(e) => {
                if (!onGo) return;
                e.preventDefault();
                onGo(href);
              }}
            >
              {label.link}
            </a>
          ) : (
            label.hover && <span className="lc-label-hover">{label.hover}</span>
          )}
        </small>
      )}
      <b>{label?.big ?? bigDay(date, time)}</b>
      {time ? <span className="lc-date-time">{formatTime12h(time)}</span> : null}
    </>
  );
}
