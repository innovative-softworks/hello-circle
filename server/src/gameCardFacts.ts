import { db } from "./db/index.js";

// What an activity card needs for its label, beyond the summary itself
// (card labels, owner 2026-10-27; client rules in components/CardDate.tsx).
// Added to the activities in the Home feed (/discover) and the Explore search
// (/search), so their cards say "You're going", "2 more needed", "Circle
// meetup" and so on, like the Activities page. The viewer's own state is only
// ever the signed-in resident's own rows; signed out adds nothing personal.

export interface GameCardFacts {
  capacity: number;
  /** Set when the activity only goes ahead with this many people. */
  minParticipants: number | null;
  /** Still waiting for enough people ('pending_participants'). */
  pending: boolean;
  /** Booking isn't open yet. */
  comingSoon: boolean;
  circleName: string | null;
  createdAt: string | null;
  soloFriendly: boolean;
  joinedByMe: boolean;
  waitlistedByMe: boolean;
  joinRequested: boolean;
}

type Row = { id: string; capacity: number; minParticipants: number | null; status: string; lifecycle: string; bookingOpenAt: string | Date | null; circleName: string | null; createdAt: string | Date | null; soloFriendly: number | null };

/** The signed-in viewer's own joined / waitlisted / requested activities among `ids`. */
export async function viewerGameState(ids: string[], residentId: string | null): Promise<{ joined: Set<string>; waiting: Set<string>; requested: Set<string> }> {
  const none = { joined: new Set<string>(), waiting: new Set<string>(), requested: new Set<string>() };
  if (!residentId || ids.length === 0) return none;
  const marks = ids.map(() => "?").join(", ");
  const [joined, waiting, requested] = (await Promise.all([
    db.prepare(`SELECT game_id as id FROM game_participants WHERE resident_id = ? AND status = 'joined' AND game_id IN (${marks})`).all(residentId, ...ids),
    db.prepare(`SELECT listing_id as id FROM waitlist_entries WHERE listing_type = 'game' AND resident_id = ? AND status IN ('waiting', 'offered') AND listing_id IN (${marks})`).all(residentId, ...ids),
    db.prepare(`SELECT game_id as id FROM game_join_requests WHERE resident_id = ? AND status = 'requested' AND game_id IN (${marks})`).all(residentId, ...ids),
  ])) as { id: string }[][];
  const set = (rows: { id: string }[]) => new Set(rows.map((r) => r.id));
  return { joined: set(joined), waiting: set(waiting), requested: set(requested) };
}

/** Adds `card` to every game item in `items` (other kinds are returned as they are). */
export async function withGameCardFacts<T extends { kind: string; id: string }>(items: T[], residentId: string | null): Promise<(T & { card?: GameCardFacts })[]> {
  const ids = [...new Set(items.filter((i) => i.kind === "game").map((i) => i.id))];
  if (ids.length === 0) return items;
  const marks = ids.map(() => "?").join(", ");
  const [rows, mine] = await Promise.all([
    db
      .prepare(
        `SELECT g.id, g.capacity, g.min_participants as minParticipants, g.status, g.lifecycle, g.booking_open_at as bookingOpenAt,
                c.name as circleName, g.created_at as createdAt, g.solo_friendly as soloFriendly
         FROM games g LEFT JOIN circles c ON c.id = g.circle_id WHERE g.id IN (${marks})`
      )
      .all(...ids) as Promise<Row[]>,
    viewerGameState(ids, residentId),
  ]);
  const now = Date.now();
  const byId = new Map(rows.map((r) => [r.id, r]));
  const iso = (v: string | Date | null) => (v ? new Date(v).toISOString() : null);
  return items.map((item) => {
    const r = item.kind === "game" ? byId.get(item.id) : undefined;
    if (!r) return item;
    const opensAt = r.bookingOpenAt ? new Date(r.bookingOpenAt).getTime() : null;
    const card: GameCardFacts = {
      capacity: Number(r.capacity),
      minParticipants: r.minParticipants ? Number(r.minParticipants) : null,
      pending: r.status === "pending_participants",
      comingSoon: r.lifecycle === "coming_soon" && (opensAt === null || opensAt > now),
      circleName: r.circleName,
      createdAt: iso(r.createdAt),
      soloFriendly: !!r.soloFriendly,
      joinedByMe: mine.joined.has(r.id),
      waitlistedByMe: mine.waiting.has(r.id),
      joinRequested: mine.requested.has(r.id),
    };
    return { ...item, card };
  });
}
