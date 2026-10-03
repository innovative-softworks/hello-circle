import { db } from "./db/index.js";
import { nextOccurrence } from "./db/queries.js";
import { irelandTodayIso } from "./irelandTime.js";
import { discoverableGameSql } from "./gameVisibility.js";

// "Keep the connection going" (community participation upgrade, Releases
// 1+3) — what to do after taking part, for every participation kind, in
// the agreed priority: 1. the listing's official Circle, 2. an open Circle
// for the same activity nearby, 3. the next session, 4. start a Circle.
// Aggregate member counts only; never who is in a Circle or session.

export type NextStepsKind = "game" | "booking" | "registration" | "program" | "experience";

export interface NextStepCircle {
  id: string;
  slug: string | null;
  name: string;
  members: number;
  joinMode: string;
  isMember: boolean;
}

export interface NextSession {
  /** Kept for the Release 1 game-only client/tests; same as the id in href. */
  id: string;
  href: string;
  title: string;
  /** Kept for the Release 1 client (games) — same as title. */
  activityLabel: string;
  date: string;
  time: string;
  centreName: string | null;
  spotsLeft: number | null;
  sameHost: boolean;
}

export interface NextSteps {
  officialCircle: NextStepCircle | null;
  suggestedCircle: NextStepCircle | null;
  nextSession: NextSession | null;
  createCircle: { activityLabel: string; county: string } | null;
}

/** What we know about the thing someone took part in. */
interface Context {
  activityLabel: string;
  county: string;
  circleId: string | null;
  centreId: string | null;
  findNext: () => Promise<NextSession | null>;
}

const today = () => irelandTodayIso();

async function circleStep(circleId: string, viewerId: string | null): Promise<NextStepCircle | null> {
  const c = (await db
    .prepare(
      `SELECT c.id, c.slug, c.name, c.join_mode as joinMode,
              (SELECT COUNT(*) FROM circle_members cm WHERE cm.circle_id = c.id) as members,
              EXISTS(SELECT 1 FROM circle_members cm WHERE cm.circle_id = c.id AND cm.resident_id = ?) as isMember
       FROM circles c WHERE c.id = ? AND c.status = 'active'`
    )
    .get(viewerId ?? "", circleId)) as { id: string; slug: string | null; name: string; joinMode: string; members: number | string; isMember: number } | undefined;
  return c ? { ...c, members: Number(c.members), isMember: !!c.isMember } : null;
}

/** An open/approval Circle (never invite-only) for the same activity in the
 * same county — or at the same venue — that the viewer isn't already in. */
async function suggestCircle(ctx: Context, viewerId: string | null): Promise<NextStepCircle | null> {
  const byActivity = ctx.county && ctx.activityLabel;
  if (!byActivity && !ctx.centreId) return null;
  const row = (await db
    .prepare(
      `SELECT c.id FROM circles c
       WHERE c.status = 'active' AND c.join_mode IN ('open', 'approval')
         AND ((? AND LOWER(c.activity_label) = LOWER(?) AND c.county = ?) OR (? IS NOT NULL AND c.centre_id = ?))
         AND NOT EXISTS (SELECT 1 FROM circle_members cm WHERE cm.circle_id = c.id AND cm.resident_id = ?)
       ORDER BY (SELECT COUNT(*) FROM circle_members cm WHERE cm.circle_id = c.id) DESC
       LIMIT 1`
    )
    .get(byActivity ? 1 : 0, ctx.activityLabel, ctx.county, ctx.centreId, ctx.centreId, viewerId ?? "")) as { id: string } | undefined;
  return row ? circleStep(row.id, viewerId) : null;
}

/** Next open public game matching a label (and optionally a host, venue or county). */
async function nextGame(opts: { excludeId?: string; label?: string; hostId?: string; centreId?: string | null; county?: string; viewerId: string | null }): Promise<NextSession | null> {
  const g = (await db
    .prepare(
      `SELECT g.id, g.activity_label, g.date, g.time, g.capacity, g.host_resident_id, c.name as centreName,
              (SELECT COUNT(*) FROM game_participants gp WHERE gp.game_id = g.id AND gp.status IN ('joined', 'pending_payment')) as joined
       FROM games g LEFT JOIN centres c ON c.id = g.centre_id
       WHERE g.id != ? AND g.status = 'open' AND ${discoverableGameSql("g")} AND g.date >= ?
         AND (? = '' OR LOWER(g.activity_label) = LOWER(?))
         AND (g.host_resident_id = ? OR (? != '' AND g.centre_id = ?) OR (? != '' AND c.county = ?))
         AND NOT EXISTS (SELECT 1 FROM game_participants gp WHERE gp.game_id = g.id AND gp.resident_id = ? AND gp.status IN ('joined', 'pending_payment'))
       ORDER BY (g.host_resident_id = ?) DESC, g.date, g.time
       LIMIT 1`
    )
    .get(
      opts.excludeId ?? "",
      today(),
      opts.label ?? "",
      opts.label ?? "",
      opts.hostId ?? "",
      opts.centreId ?? "",
      opts.centreId ?? "",
      opts.county ?? "",
      opts.county ?? "",
      opts.viewerId ?? "",
      opts.hostId ?? ""
    )) as { id: string; activity_label: string; date: string; time: string; capacity: number; host_resident_id: string; centreName: string | null; joined: number | string } | undefined;
  if (!g) return null;
  return {
    id: g.id,
    href: `/games/${g.id}`,
    title: g.activity_label,
    activityLabel: g.activity_label,
    date: g.date,
    time: g.time,
    centreName: g.centreName,
    spotsLeft: Math.max(0, g.capacity - Number(g.joined)),
    sameHost: !!opts.hostId && g.host_resident_id === opts.hostId,
  };
}

function session(href: string, id: string, title: string, date: string, time: string, place: string | null, sameHost: boolean): NextSession {
  return { id, href, title, activityLabel: title, date, time, centreName: place, spotsLeft: null, sameHost };
}

/** Loads the context for `kind`/`ref`, or null when it doesn't exist or the
 * caller doesn't own it (games: the host or a joined participant; the rest:
 * the device's client id or the signed-in resident). */
async function loadContext(kind: NextStepsKind, ref: string, viewerId: string | null, clientId: string | null): Promise<Context | null> {
  const owner = `(t.client_id = ? OR (t.resident_id IS NOT NULL AND t.resident_id = ?))`;
  const ownerArgs = [clientId ?? "", viewerId ?? ""];

  if (kind === "game") {
    const g = (await db
      .prepare(`SELECT g.id, g.activity_label, g.centre_id, g.circle_id, g.host_resident_id, c.county FROM games g LEFT JOIN centres c ON c.id = g.centre_id WHERE g.id = ?`)
      .get(ref)) as { id: string; activity_label: string; centre_id: string | null; circle_id: string | null; host_resident_id: string; county: string | null } | undefined;
    if (!g || !viewerId) return null;
    const inIt = g.host_resident_id === viewerId || !!(await db.prepare(`SELECT 1 FROM game_participants WHERE game_id = ? AND resident_id = ? AND status = 'joined'`).get(g.id, viewerId));
    if (!inIt) return null;
    return {
      activityLabel: g.activity_label,
      county: g.county ?? "",
      circleId: g.circle_id,
      centreId: null, // a game's own venue isn't a "same activity" signal on its own
      findNext: () => nextGame({ excludeId: g.id, label: g.activity_label, hostId: g.host_resident_id, county: g.county ?? "", viewerId }),
    };
  }

  if (kind === "booking") {
    const b = (await db
      .prepare(`SELECT t.centre_id, c.name, c.county, t.event_type FROM bookings t JOIN centres c ON c.id = t.centre_id WHERE t.ref = ? AND ${owner}`)
      .get(ref, ...ownerArgs)) as { centre_id: string; name: string; county: string; event_type: string } | undefined;
    if (!b) return null;
    // A room hire has no activity of its own — the venue is the link.
    return {
      activityLabel: "",
      county: b.county,
      circleId: null,
      centreId: b.centre_id,
      findNext: () => nextGame({ centreId: b.centre_id, viewerId }),
    };
  }

  if (kind === "registration") {
    const r = (await db
      .prepare(`SELECT c.id, c.name, c.sport, c.county, c.circle_id FROM registrations t JOIN clubs c ON c.id = t.club_id WHERE t.ref = ? AND ${owner}`)
      .get(ref, ...ownerArgs)) as { id: string; name: string; sport: string; county: string; circle_id: string | null } | undefined;
    if (!r) return null;
    return {
      activityLabel: r.sport,
      county: r.county,
      circleId: r.circle_id,
      centreId: null,
      findNext: async () => {
        const cs = (await db.prepare(`SELECT id, day_of_week, time, label FROM club_sessions WHERE club_id = ? AND active = 1`).all(r.id)) as {
          id: string;
          day_of_week: number;
          time: string;
          label: string;
        }[];
        const now = new Date();
        const upcoming = cs.map((s) => ({ ...s, date: nextOccurrence(s.day_of_week, now) })).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))[0];
        return upcoming ? session(`/clubs/${r.id}`, upcoming.id, upcoming.label || r.name, upcoming.date, upcoming.time, r.name, true) : null;
      },
    };
  }

  if (kind === "program") {
    const p = (await db
      .prepare(
        `SELECT p.id, p.title, p.category, p.circle_id, p.listing_type, p.listing_id, COALESCE(c.county, cl.county) as county, COALESCE(c.name, cl.name) as place
         FROM program_enrollments t JOIN programs p ON p.id = t.program_id
         LEFT JOIN centres c ON p.listing_type = 'centre' AND c.id = p.listing_id
         LEFT JOIN clubs cl ON p.listing_type = 'club' AND cl.id = p.listing_id
         WHERE t.ref = ? AND ${owner}`
      )
      .get(ref, ...ownerArgs)) as { id: string; title: string; category: string; circle_id: string | null; listing_type: string; listing_id: string; county: string | null; place: string | null } | undefined;
    if (!p) return null;
    return {
      activityLabel: p.category || p.title,
      county: p.county ?? "",
      circleId: p.circle_id,
      centreId: p.listing_type === "centre" ? p.listing_id : null,
      findNext: async () => {
        const s = (await db
          .prepare(`SELECT id, date, time FROM program_sessions WHERE program_id = ? AND status != 'cancelled' AND date >= ? ORDER BY date, time LIMIT 1`)
          .get(p.id, today())) as { id: string; date: string; time: string } | undefined;
        if (s) return session(`/programs/${p.id}`, s.id, p.title, s.date, s.time, p.place, true);
        // This program is over — the next published one in the same category at the same venue.
        const other = (await db
          .prepare(
            `SELECT p2.id, p2.title, ps.date, ps.time FROM programs p2 JOIN program_sessions ps ON ps.program_id = p2.id
             WHERE p2.id != ? AND p2.status = 'published' AND p2.listing_id = ? AND (? = '' OR p2.category = ?) AND ps.status != 'cancelled' AND ps.date >= ?
             ORDER BY ps.date, ps.time LIMIT 1`
          )
          .get(p.id, p.listing_id, p.category, p.category, today())) as { id: string; title: string; date: string; time: string } | undefined;
        return other ? session(`/programs/${other.id}`, other.id, other.title, other.date, other.time, p.place, true) : null;
      },
    };
  }

  // experience
  const e = (await db
    .prepare(
      `SELECT e.id, e.title, e.kind, e.county, e.circle_id, e.slug FROM experience_bookings t JOIN experiences e ON e.id = t.experience_id WHERE t.ref = ? AND ${owner}`
    )
    .get(ref, ...ownerArgs)) as { id: string; title: string; kind: string; county: string; circle_id: string | null; slug: string | null } | undefined;
  if (!e) return null;
  return {
    activityLabel: e.title,
    county: e.county,
    circleId: e.circle_id,
    centreId: null,
    findNext: async () => {
      const s = (await db
        .prepare(`SELECT id, date, time FROM experience_sessions WHERE experience_id = ? AND status = 'scheduled' AND date >= ? ORDER BY date, time LIMIT 1`)
        .get(e.id, today())) as { id: string; date: string; time: string } | undefined;
      return s ? session(`/experiences/${e.slug ?? e.id}`, s.id, e.title, s.date, s.time, null, true) : null;
    },
  };
}

export async function getNextSteps(kind: NextStepsKind, ref: string, viewerId: string | null, clientId: string | null): Promise<NextSteps | null> {
  const ctx = await loadContext(kind, ref, viewerId, clientId);
  if (!ctx) return null;
  const officialCircle = ctx.circleId ? await circleStep(ctx.circleId, viewerId) : null;
  const suggestedCircle = officialCircle ? null : await suggestCircle(ctx, viewerId);
  const nextSession = await ctx.findNext();
  // "Start a Circle" needs something to name it after.
  const createCircle = !officialCircle && !suggestedCircle && ctx.activityLabel ? { activityLabel: ctx.activityLabel, county: ctx.county } : null;
  return { officialCircle, suggestedCircle, nextSession, createCircle };
}

export const NEXT_STEPS_KINDS: readonly NextStepsKind[] = ["game", "booking", "registration", "program", "experience"];
