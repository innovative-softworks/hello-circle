import { Router } from "express";
import { db } from "../db/index.js";
import { irelandWallTimeToUtc } from "../irelandTime.js";

export const discoverRouter = Router();

// "Happening today" / "This weekend" homepage feeds (Phase 5 gap) — the
// first platform-wide aggregate across the three scheduled-activity
// sources (games, program_sessions, club_sessions), none of which had a
// cross-listing list endpoint before this. Deliberately read-only and
// public — no capacity/checkout logic here, just "what's on."

export interface DiscoverItem {
  kind: "game" | "program_session" | "club_session";
  id: string;
  title: string;
  date: string;
  time: string;
  centreName: string | null;
  clubName: string | null;
  area: string | null;
  county: string | null;
  priceCents: number | null;
  href: string;
  /** Games only — lets the card offer an inline "Join" instead of only a
   * link through to the detail page. null for program/club sessions, which
   * don't have a single-tap join (a program enrolls the whole program, a
   * club session isn't itself the unit of registration). */
  spotsLeft: number | null;
  /** Games only, and only real data — how many residents have actually
   * joined. Deliberately not populated for program/club sessions: neither
   * tracks a per-session attendee count (a program enrolls the whole
   * series; a club session isn't its own registration unit), so showing a
   * number there would mean fabricating one. */
  joined: number | null;
  /** null means the client falls back to a kind-tinted placeholder, same
   * convention as CentreCard/ClubCard's `ph` fallback — happens whenever
   * the underlying row's own image_url is unset (no create/edit UI writes
   * one for games/club_sessions yet, so most seed rows will be empty
   * unless deliberately backfilled). */
  imageUrl: string | null;
  /** Best-effort "is this happening right now" — computed from the item's
   * Ireland wall-clock start time plus a duration (the session's own
   * duration_minutes for program sessions, a reasonable assumed default
   * for games/club sessions, which don't store one). Not exact, same
   * best-effort spirit as searchParser.ts elsewhere in this codebase. */
  isLive: boolean;
}

interface GameRow {
  id: string;
  activity_label: string;
  date: string;
  time: string;
  price_cents: number | null;
  centre_name: string | null;
  area: string | null;
  county: string | null;
  capacity: number;
  joined: number;
  image_url: string;
}

interface ProgramSessionRow {
  id: string;
  date: string;
  time: string;
  title: string;
  price_cents: number;
  listing_type: "centre" | "club";
  listing_name: string;
  area: string | null;
  county: string | null;
  duration_minutes: number;
  image_url: string;
}

interface ClubSessionRow {
  id: string;
  day_of_week: number;
  time: string;
  label: string;
  club_id: string;
  club_name: string;
  area: string;
  county: string;
  price: number;
  image_url: string;
}

/** The next date (today or later) this weekday falls on, YYYY-MM-DD. */
function nextOccurrence(dayOfWeek: number, today: Date): string {
  const diff = (dayOfWeek - today.getUTCDay() + 7) % 7;
  const d = new Date(today);
  d.setUTCDate(today.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

// Neither games nor club_sessions store a duration — these are reasonable,
// documented assumptions (a pickup game runs ~2h, a club training session
// ~90m), not real data. Program sessions have a real duration_minutes and
// use that instead.
const ASSUMED_DURATION_MINUTES: Record<DiscoverItem["kind"], number> = {
  game: 120,
  club_session: 90,
  program_session: 0, // unused — program sessions always pass their own real duration
};

function computeIsLive(kind: DiscoverItem["kind"], date: string, time: string, durationMinutes: number, now: Date): boolean {
  const [hour, minute] = time.split(":").map(Number);
  const start = irelandWallTimeToUtc(date, hour, minute);
  const end = new Date(start.getTime() + (kind === "program_session" ? durationMinutes : ASSUMED_DURATION_MINUTES[kind]) * 60000);
  return now >= start && now <= end;
}

/** Ranking, not just chronological sort — deliberately rule-based (no ML,
 * same "start simple" spirit as searchParser.ts elsewhere in this
 * codebase; personalization/ML-backed ranking is Phase 18+ in the
 * roadmap, well past where this app is). Four signals, in priority order:
 *   1. Live beats everything — something happening right now is the most
 *      compelling thing to surface first, full stop.
 *   2. Starting soon beats starting later — decays smoothly rather than a
 *      hard cutoff, so "in 20 minutes" clearly outranks "in 6 hours".
 *   3. Filling up (games only, real capacity/joined data) signals real
 *      demand — genuine social proof, not urgency theatre, since it's
 *      backed by actual joins.
 *   4. Small, deliberately minor boosts for free (lower friction to act
 *      on) and for having a real photo (more compelling in a photo-driven
 *      feed) — tie-breakers, not primary signals.
 * `minutesUntilStart` is negative once a (non-live, already-ended) item
 * has passed — those still sort last naturally since every term is >= 0. */
function rankScore(params: { isLive: boolean; minutesUntilStart: number; fillRatio: number | null; isFree: boolean; hasPhoto: boolean }): number {
  let score = 0;
  if (params.isLive) score += 1000;
  else score += Math.max(0, 300 - Math.max(0, params.minutesUntilStart) / 10);
  if (params.fillRatio !== null && params.fillRatio >= 0.5) score += params.fillRatio * 100;
  if (params.isFree) score += 20;
  if (params.hasPhoto) score += 10;
  return score;
}

discoverRouter.get("/", async (req, res) => {
  const county = typeof req.query.county === "string" && req.query.county !== "All" ? req.query.county : undefined;
  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10);
  const weekFromNow = new Date(now);
  weekFromNow.setUTCDate(now.getUTCDate() + 7);
  const weekFromNowIso = weekFromNow.toISOString().slice(0, 10);

  const games = (
    county
      ? await db
          .prepare(
            `SELECT g.id, g.activity_label, g.date, g.time, g.price_cents, g.capacity, g.image_url, c.name as centre_name, c.area, c.county,
                    (SELECT COUNT(*) FROM game_participants gp WHERE gp.game_id = g.id AND gp.status = 'joined') as joined
             FROM games g LEFT JOIN centres c ON c.id = g.centre_id
             WHERE g.status = 'open' AND g.date >= ? AND g.date <= ? AND c.county = ?`
          )
          .all(todayIso, weekFromNowIso, county)
      : await db
          .prepare(
            `SELECT g.id, g.activity_label, g.date, g.time, g.price_cents, g.capacity, g.image_url, c.name as centre_name, c.area, c.county,
                    (SELECT COUNT(*) FROM game_participants gp WHERE gp.game_id = g.id AND gp.status = 'joined') as joined
             FROM games g LEFT JOIN centres c ON c.id = g.centre_id
             WHERE g.status = 'open' AND g.date >= ? AND g.date <= ?`
          )
          .all(todayIso, weekFromNowIso)
  ) as GameRow[];

  const programSessions = (await db
    .prepare(
      `SELECT ps.id, ps.date, ps.time, ps.duration_minutes, p.title, p.price_cents, p.listing_type, p.image_url,
              COALESCE(c.name, cl.name) as listing_name, COALESCE(c.area, cl.area) as area, COALESCE(c.county, cl.county) as county
       FROM program_sessions ps
       JOIN programs p ON p.id = ps.program_id
       LEFT JOIN centres c ON p.listing_type = 'centre' AND c.id = p.listing_id
       LEFT JOIN clubs cl ON p.listing_type = 'club' AND cl.id = p.listing_id
       WHERE p.status = 'published' AND ps.status != 'cancelled' AND ps.date >= ? AND ps.date <= ?
       ${county ? "AND COALESCE(c.county, cl.county) = ?" : ""}`
    )
    .all(...(county ? [todayIso, weekFromNowIso, county] : [todayIso, weekFromNowIso]))) as ProgramSessionRow[];

  const clubSessions = (await db
    .prepare(
      `SELECT cs.id, cs.day_of_week, cs.time, cs.label, cs.image_url, cl.id as club_id, cl.name as club_name, cl.area, cl.county, cl.price
       FROM club_sessions cs JOIN clubs cl ON cl.id = cs.club_id
       WHERE cs.active = 1 ${county ? "AND cl.county = ?" : ""}`
    )
    .all(...(county ? [county] : []))) as ClubSessionRow[];

  const minutesUntil = (date: string, time: string): number => {
    const [hour, minute] = time.split(":").map(Number);
    return (irelandWallTimeToUtc(date, hour, minute).getTime() - now.getTime()) / 60000;
  };

  const items: (DiscoverItem & { _date: string; _score: number })[] = [
    ...games.map((g) => {
      const isLive = computeIsLive("game", g.date, g.time, 0, now);
      return {
        kind: "game" as const,
        id: g.id,
        title: g.activity_label,
        date: g.date,
        time: g.time,
        centreName: g.centre_name,
        clubName: null,
        area: g.area,
        county: g.county,
        priceCents: g.price_cents,
        href: `/games/${g.id}`,
        spotsLeft: Math.max(0, g.capacity - g.joined),
        joined: g.joined,
        imageUrl: g.image_url || null,
        isLive,
        _date: g.date,
        _score: rankScore({ isLive, minutesUntilStart: minutesUntil(g.date, g.time), fillRatio: g.capacity > 0 ? g.joined / g.capacity : null, isFree: !g.price_cents, hasPhoto: !!g.image_url }),
      };
    }),
    ...programSessions.map((p) => {
      const isLive = computeIsLive("program_session", p.date, p.time, p.duration_minutes, now);
      return {
        kind: "program_session" as const,
        id: p.id,
        title: p.title,
        date: p.date,
        time: p.time,
        centreName: p.listing_type === "centre" ? p.listing_name : null,
        clubName: p.listing_type === "club" ? p.listing_name : null,
        area: p.area,
        county: p.county,
        priceCents: p.price_cents,
        href: `/programs/${p.id}`,
        spotsLeft: null,
        joined: null,
        imageUrl: p.image_url || null,
        isLive,
        _date: p.date,
        _score: rankScore({ isLive, minutesUntilStart: minutesUntil(p.date, p.time), fillRatio: null, isFree: !p.price_cents, hasPhoto: !!p.image_url }),
      };
    }),
    ...clubSessions.map((cs) => {
      const date = nextOccurrence(cs.day_of_week, now);
      const isLive = computeIsLive("club_session", date, cs.time, 0, now);
      return {
        kind: "club_session" as const,
        id: cs.id,
        title: cs.label || cs.club_name,
        date,
        time: cs.time,
        centreName: null,
        clubName: cs.club_name,
        area: cs.area,
        county: cs.county,
        priceCents: cs.price ? Math.round(cs.price * 100) : null,
        href: `/clubs/${cs.club_id}`,
        spotsLeft: null,
        joined: null,
        imageUrl: cs.image_url || null,
        isLive,
        _date: date,
        _score: rankScore({ isLive, minutesUntilStart: minutesUntil(date, cs.time), fillRatio: null, isFree: !cs.price, hasPhoto: !!cs.image_url }),
      };
    }),
  ];

  const today: (DiscoverItem & { _score: number })[] = [];
  const weekend: (DiscoverItem & { _score: number })[] = [];
  for (const { _date, ...item } of items) {
    if (_date === todayIso) today.push(item);
    const dow = new Date(`${_date}T12:00:00Z`).getUTCDay();
    if (_date >= todayIso && (dow === 0 || dow === 6)) weekend.push(item);
  }
  // Ranked, not chronological — see rankScore() above. Time remains the
  // tiebreaker among items the algorithm scores equally.
  const byScore = (a: { _score: number; time: string }, b: { _score: number; time: string }) => b._score - a._score || a.time.localeCompare(b.time);
  today.sort(byScore);
  weekend.sort(byScore);

  res.json({
    today: today.map(({ _score, ...item }) => item),
    weekend: weekend.map(({ _score, ...item }) => item),
  });
});
