import crypto from "node:crypto";
import { experienceHref } from "../participation/eventsVisibility.js";
import { Router } from "express";
import { requireFeature } from "../circleFeatures.js";
import { planDay, MAX_STOPS, ROAD_FACTOR, TRAVEL_KMH, BUFFER_MINUTES } from "../dayPlanner.js";
import { db } from "../db/index.js";
import { listScheduledActivities, type ScheduledActivity } from "../db/queries.js";
import { irelandTodayIso, irelandWallTimeToUtc } from "../irelandTime.js";
import { simpleRateLimit } from "../rateLimit.js";
import { requireResident } from "../residents.js";
import { clientIdFrom } from "../util.js";
import { MOOD_KEYWORDS, scoreActivities } from "./discover.js";

// Experience 3.0 (docs/experience-3/) — personal hub features, each behind
// its experience.* switch:
//   GET  /passport                      Activity Passport (private, D3)
//   GET  /programmes/:ref/journey       Programme journey
//   POST /plan-my-day                   suggest a day (D1, rough travel)
//   GET/POST/PUT/DELETE /plans[/:id]    saved day plans
// Everything is the caller's own data only. Nothing here books, reserves or
// changes a participation row.

export const experienceHubRouter = Router();

// --- Activity Passport --------------------------------------------------------

export interface PassportEntry {
  kind: "activity" | "adventure" | "experience" | "volunteering" | "programme" | "hall" | "club" | "circle";
  title: string;
  date: string;
  href: string | null;
  /** How we know it happened. */
  evidence: "organiser" | "you" | "joined";
}

/** First-time milestones, from real dates only — no streaks, no ranks. */
export function passportMilestones(entries: PassportEntry[]): { key: string; label: string; date: string; title: string }[] {
  const firstOf = (pred: (e: PassportEntry) => boolean) => entries.filter(pred).sort((a, b) => a.date.localeCompare(b.date))[0];
  const defs: [string, string, (e: PassportEntry) => boolean][] = [
    ["first_activity", "First thing you took part in", (e) => e.kind !== "circle"],
    ["first_circle", "First Circle you joined", (e) => e.kind === "circle"],
    ["first_adventure", "First adventure", (e) => e.kind === "adventure"],
    ["first_programme", "First programme session", (e) => e.kind === "programme"],
    ["first_volunteering", "First time volunteering", (e) => e.kind === "volunteering"],
  ];
  return defs.flatMap(([key, label, pred]) => {
    const hit = firstOf(pred);
    return hit ? [{ key, label, date: hit.date, title: hit.title }] : [];
  });
}

experienceHubRouter.get("/passport", requireResident, requireFeature("experience.activity_passport"), async (req, res) => {
  const me = req.resident!.id;
  const email = req.resident!.email ?? "";
  const today = irelandTodayIso();
  const present = "a.status IN ('present', 'late')";
  // Only things that actually happened: an organiser's check-in or register,
  // or (activities only) the resident's own "I went". Cancelled never counts.
  const [games, experiences, programmes, bookings, registrations, circles] = await Promise.all([
    db
      .prepare(
        `SELECT g.id, g.activity_label as title, g.date FROM game_participants gp JOIN games g ON g.id = gp.game_id
         WHERE gp.resident_id = ? AND gp.status = 'joined' AND gp.attended = 1 AND g.status != 'cancelled' AND g.date < ?`
      )
      .all(me, today) as Promise<{ id: string; title: string; date: string }[]>,
    db
      .prepare(
        `SELECT e.id, e.slug, e.title, e.kind, es.date FROM experience_bookings eb
         JOIN experience_sessions es ON es.id = eb.session_id JOIN experiences e ON e.id = eb.experience_id
         JOIN attendance a ON a.kind = 'experience' AND a.ref = eb.ref AND ${present}
         WHERE (eb.resident_id = ? OR (eb.resident_id IS NULL AND LOWER(eb.email) = LOWER(?))) AND eb.status != 'cancelled'`
      )
      .all(me, email) as Promise<{ id: string; slug: string | null; title: string; kind: string; date: string }[]>,
    db
      .prepare(
        `SELECT p.id, p.title, ps.date FROM program_enrollments pe JOIN programs p ON p.id = pe.program_id
         JOIN program_sessions ps ON ps.program_id = pe.program_id
         JOIN attendance a ON a.kind = 'program_session' AND a.ref = CONCAT(ps.id, ':', pe.id) AND ${present}
         WHERE (pe.resident_id = ? OR (pe.resident_id IS NULL AND LOWER(pe.email) = LOWER(?)))`
      )
      .all(me, email) as Promise<{ id: string; title: string; date: string }[]>,
    db
      .prepare(
        `SELECT c.id, c.name as title, b.date FROM bookings b JOIN centres c ON c.id = b.centre_id
         JOIN attendance a ON a.kind = 'booking' AND a.ref = b.ref AND ${present}
         WHERE (b.resident_id = ? OR (b.resident_id IS NULL AND LOWER(b.email) = LOWER(?))) AND b.status != 'cancelled'`
      )
      .all(me, email) as Promise<{ id: string; title: string; date: string }[]>,
    db
      .prepare(
        `SELECT cl.id, cl.name as title, DATE_FORMAT(a.checked_in_at, '%Y-%m-%d') as date FROM registrations r JOIN clubs cl ON cl.id = r.club_id
         JOIN attendance a ON a.kind = 'registration' AND a.ref = r.ref AND ${present}
         WHERE (r.resident_id = ? OR (r.resident_id IS NULL AND LOWER(r.email) = LOWER(?)))`
      )
      .all(me, email) as Promise<{ id: string; title: string; date: string }[]>,
    db
      .prepare(`SELECT c.id, c.slug, c.name as title, DATE_FORMAT(cm.joined_at, '%Y-%m-%d') as date FROM circle_members cm JOIN circles c ON c.id = cm.circle_id WHERE cm.resident_id = ?`)
      .all(me) as Promise<{ id: string; slug: string | null; title: string; date: string }[]>,
  ]);
  const entries: PassportEntry[] = [
    ...games.map((g) => ({ kind: "activity" as const, title: g.title, date: g.date, href: `/games/${g.id}`, evidence: "you" as const })),
    ...experiences.map((e) => ({
      kind: (e.kind === "adventure" ? "adventure" : e.kind === "volunteer" ? "volunteering" : "experience") as PassportEntry["kind"],
      title: e.title,
      date: e.date,
      href: experienceHref(e.kind, e.slug ?? e.id),
      evidence: "organiser" as const,
    })),
    ...programmes.map((p) => ({ kind: "programme" as const, title: p.title, date: p.date, href: `/programs/${p.id}`, evidence: "organiser" as const })),
    ...bookings.map((b) => ({ kind: "hall" as const, title: b.title, date: b.date, href: null, evidence: "organiser" as const })),
    ...registrations.map((r) => ({ kind: "club" as const, title: r.title, date: r.date, href: null, evidence: "organiser" as const })),
    ...circles.map((c) => ({ kind: "circle" as const, title: c.title, date: c.date, href: `/circles/${c.slug ?? c.id}`, evidence: "joined" as const })),
  ].sort((a, b) => b.date.localeCompare(a.date));
  const memories = (await db.prepare(`SELECT COUNT(*) as n FROM circle_memories WHERE resident_id = ? AND status = 'visible'`).get(me)) as { n: number | string };
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ entries, milestones: passportMilestones(entries), memoriesShared: Number(memories.n) });
});

// --- Programme journey ------------------------------------------------------

export type JourneyState = "attended" | "missed" | "not_recorded" | "upcoming" | "cancelled";

/** A past session with no register is "not recorded" — never "completed". */
export function journeyState(sessionDate: string, sessionStatus: string, attendanceStatus: string | null, todayIso: string): JourneyState {
  if (sessionStatus === "cancelled") return "cancelled";
  if (attendanceStatus === "present" || attendanceStatus === "late") return "attended";
  if (attendanceStatus === "absent" || attendanceStatus === "no_show") return "missed";
  return sessionDate >= todayIso ? "upcoming" : "not_recorded";
}

experienceHubRouter.get("/programmes/:ref/journey", requireFeature("experience.programme_journey"), async (req, res) => {
  let clientId: string;
  try {
    clientId = clientIdFrom(req);
  } catch {
    return res.status(400).json({ error: "Missing client id" });
  }
  const enrollment = (await db
    .prepare(`SELECT pe.id, pe.program_id as programId, p.title FROM program_enrollments pe JOIN programs p ON p.id = pe.program_id WHERE pe.ref = ? AND (pe.client_id = ? OR (pe.resident_id IS NOT NULL AND pe.resident_id = ?))`)
    .get(req.params.ref, clientId, req.resident?.id ?? "")) as { id: number; programId: string; title: string } | undefined;
  // Someone else's enrolment reads exactly like a missing one.
  if (!enrollment) return res.status(404).json({ error: "Booking not found" });
  const today = irelandTodayIso();
  const sessions = (await db
    .prepare(
      `SELECT ps.id, ps.date, ps.time, ps.status, a.status as attendance FROM program_sessions ps
       LEFT JOIN attendance a ON a.kind = 'program_session' AND a.ref = CONCAT(ps.id, ':', ?)
       WHERE ps.program_id = ? ORDER BY ps.date, ps.time`
    )
    .all(enrollment.id, enrollment.programId)) as { id: string; date: string; time: string; status: string; attendance: string | null }[];
  const rows = sessions.map((s) => ({ id: s.id, date: s.date, time: s.time, state: journeyState(s.date, s.status, s.attendance, today) }));
  const count = (st: JourneyState) => rows.filter((r) => r.state === st).length;
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ title: enrollment.title, sessions: rows, totals: { attended: count("attended"), missed: count("missed"), notRecorded: count("not_recorded"), upcoming: count("upcoming") } });
});

// --- Plan My Day --------------------------------------------------------------

const planLimiter = simpleRateLimit({ windowMs: 15 * 60 * 1000, max: 60 });
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

interface PlanBody {
  date?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  maxPriceCents?: unknown;
  county?: unknown;
  mood?: unknown;
  origin?: unknown;
  exclude?: unknown;
}

function stopJson(item: ScheduledActivity & { matchReasons?: string[] }) {
  return {
    kind: item.kind,
    id: item.id,
    title: item.title,
    date: item.date,
    time: item.time,
    durationMinutes: item.durationMinutes,
    href: item.href,
    priceCents: item.priceCents,
    spotsLeft: item.spotsLeft,
    place: item.centreName ?? item.clubName ?? ([item.area, item.county].filter(Boolean).join(", ") || null),
    imageUrl: item.imageUrl,
  };
}

experienceHubRouter.post("/plan-my-day", requireFeature("experience.plan_my_day"), planLimiter, async (req, res) => {
  const b = req.body as PlanBody;
  const today = irelandTodayIso();
  if (typeof b.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.date) || b.date < today) return res.status(400).json({ error: "Choose today or a later date", field: "date" });
  const startTime = typeof b.startTime === "string" && TIME.test(b.startTime) ? b.startTime : "09:00";
  const endTime = typeof b.endTime === "string" && TIME.test(b.endTime) ? b.endTime : "21:00";
  if (startTime >= endTime) return res.status(400).json({ error: "The end of your day has to be after the start", field: "endTime" });
  const maxPriceCents = typeof b.maxPriceCents === "number" && Number.isInteger(b.maxPriceCents) && b.maxPriceCents >= 0 ? b.maxPriceCents : null;
  const county = typeof b.county === "string" && b.county && b.county !== "All" ? b.county : undefined;
  const mood = typeof b.mood === "string" && b.mood !== "any" ? b.mood : undefined;
  const o = b.origin as { lat?: unknown; lng?: unknown } | null | undefined;
  const origin = o && typeof o.lat === "number" && typeof o.lng === "number" && Math.abs(o.lat) <= 90 && Math.abs(o.lng) <= 180 ? { lat: o.lat, lng: o.lng } : null;
  const exclude = new Set(Array.isArray(b.exclude) ? b.exclude.filter((x): x is string => typeof x === "string").slice(0, 50) : []);

  const now = new Date();
  // Start of the chosen day (or now, if it's today) to its end, Ireland time.
  const from = b.date === today ? now : irelandWallTimeToUtc(b.date, 0, 0);
  const to = irelandWallTimeToUtc(b.date, 23, 59);
  let pool = (await listScheduledActivities({ county, from, to, includeExperiences: true })).filter((a) => a.date === b.date && !exclude.has(a.id));
  if (b.date === today) {
    const nowMin = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Dublin", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now).replace(":", ""));
    pool = pool.filter((a) => Number(a.time.replace(":", "")) > nowMin);
  }
  if (mood) {
    const keywords = MOOD_KEYWORDS[mood] ?? [];
    pool = pool.filter((a) => keywords.some((k) => a.title.toLowerCase().includes(k)));
  }
  const scored = await scoreActivities(pool, now, req.resident?.id ?? null, req.resident?.homeCounty ?? null);
  const scoreOf = new Map(scored.map((s) => [`${s.item.kind}:${s.item.id}`, s.score]));
  const plan = planDay(
    scored.map((s) => s.item),
    { startTime, endTime, maxPriceCents, origin },
    (i) => scoreOf.get(`${i.kind}:${i.id}`) ?? 0
  );
  const skippedUnknownLength = pool.filter((a) => !a.durationKnown).length;
  res.json({
    date: b.date,
    stops: plan.stops.map((s) => ({ ...stopJson(s.item), start: s.start, end: s.end, travelMinutes: s.travelMinutes })),
    totalPriceCents: plan.totalPriceCents,
    assumptions: {
      travel: `Rough estimate: straight-line distance × ${ROAD_FACTOR} at ${TRAVEL_KMH} km/h, plus ${BUFFER_MINUTES} minutes. Check your own route.`,
      skippedUnknownLength,
      maxStops: MAX_STOPS,
    },
    // Never "bookable": each stop is booked or joined on its own page.
    bookable: false,
  });
});

// --- Saved day plans ----------------------------------------------------------

interface PlanItem {
  kind: ScheduledActivity["kind"];
  id: string;
  title: string;
  date: string;
  time: string;
  durationMinutes: number;
  href: string;
  priceCents: number | null;
  place: string | null;
}

function cleanItems(raw: unknown): PlanItem[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_STOPS) return null;
  const kinds = new Set(["game", "program_session", "club_session", "experience_session"]);
  const out: PlanItem[] = [];
  for (const r of raw) {
    const x = r as Record<string, unknown>;
    if (!kinds.has(String(x.kind)) || typeof x.id !== "string" || typeof x.title !== "string" || typeof x.date !== "string" || typeof x.time !== "string" || typeof x.href !== "string") return null;
    if (!x.href.startsWith("/")) return null;
    out.push({
      kind: x.kind as PlanItem["kind"],
      id: x.id.slice(0, 191),
      title: x.title.slice(0, 255),
      date: x.date.slice(0, 10),
      time: x.time.slice(0, 5),
      durationMinutes: Number(x.durationMinutes) || 0,
      href: x.href.slice(0, 300),
      priceCents: typeof x.priceCents === "number" ? x.priceCents : null,
      place: typeof x.place === "string" ? x.place.slice(0, 255) : null,
    });
  }
  return out;
}

/** Each saved stop re-checked against what's listed now — never trusted. */
async function withCurrentState(date: string, items: PlanItem[]) {
  const today = irelandTodayIso();
  if (date < today) return items.map((i) => ({ ...i, current: "past" as const }));
  const live = await listScheduledActivities({ from: date === today ? new Date() : irelandWallTimeToUtc(date, 0, 0), to: irelandWallTimeToUtc(date, 23, 59), includeExperiences: true });
  const byKey = new Map(live.map((a) => [`${a.kind}:${a.id}:${a.date}`, a]));
  return items.map((i) => {
    const now = byKey.get(`${i.kind}:${i.id}:${i.date}`);
    const current = !now ? ("gone" as const) : now.time !== i.time ? ("changed" as const) : now.spotsLeft === 0 ? ("full" as const) : ("listed" as const);
    return { ...i, current, currentTime: now?.time ?? null };
  });
}

const savedLimiter = simpleRateLimit({ windowMs: 15 * 60 * 1000, max: 60 });

experienceHubRouter.get("/plans", requireResident, requireFeature("experience.plan_my_day"), async (req, res) => {
  const rows = (await db
    .prepare(`SELECT id, title, date, items, created_at as createdAt, updated_at as updatedAt FROM day_plans WHERE resident_id = ? ORDER BY date DESC, created_at DESC LIMIT 50`)
    .all(req.resident!.id)) as { id: string; title: string; date: string; items: string; createdAt: string; updatedAt: string }[];
  res.setHeader("Cache-Control", "private, no-store");
  res.json(await Promise.all(rows.map(async (r) => ({ ...r, items: await withCurrentState(r.date, JSON.parse(r.items) as PlanItem[]) }))));
});

experienceHubRouter.post("/plans", requireResident, requireFeature("experience.plan_my_day"), savedLimiter, async (req, res) => {
  const b = req.body as { title?: unknown; date?: unknown; items?: unknown };
  const items = cleanItems(b.items);
  if (!items) return res.status(400).json({ error: `A plan needs between 1 and ${MAX_STOPS} stops` });
  if (typeof b.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.date) || items.some((i) => i.date !== b.date)) return res.status(400).json({ error: "Every stop must be on the plan's day" });
  const title = typeof b.title === "string" && b.title.trim() ? b.title.trim().slice(0, 120) : "My day";
  const { n } = (await db.prepare(`SELECT COUNT(*) as n FROM day_plans WHERE resident_id = ?`).get(req.resident!.id)) as { n: number | string };
  if (Number(n) >= 50) return res.status(409).json({ error: "You have 50 saved plans. Delete one to save another." });
  const id = crypto.randomUUID();
  await db.prepare(`INSERT INTO day_plans (id, resident_id, title, date, items) VALUES (?, ?, ?, ?, ?)`).run(id, req.resident!.id, title, b.date, JSON.stringify(items));
  res.status(201).json({ id });
});

experienceHubRouter.put("/plans/:id", requireResident, requireFeature("experience.plan_my_day"), savedLimiter, async (req, res) => {
  const existing = (await db.prepare(`SELECT date FROM day_plans WHERE id = ? AND resident_id = ?`).get(req.params.id, req.resident!.id)) as { date: string } | undefined;
  if (!existing) return res.status(404).json({ error: "Plan not found" });
  const b = req.body as { title?: unknown; items?: unknown };
  const items = b.items === undefined ? undefined : cleanItems(b.items);
  if (items === null) return res.status(400).json({ error: `A plan needs between 1 and ${MAX_STOPS} stops — delete the plan to remove the last one` });
  if (items && items.some((i) => i.date !== existing.date)) return res.status(400).json({ error: "Every stop must be on the plan's day" });
  const title = typeof b.title === "string" && b.title.trim() ? b.title.trim().slice(0, 120) : undefined;
  await db.prepare(`UPDATE day_plans SET title = COALESCE(?, title), items = COALESCE(?, items) WHERE id = ? AND resident_id = ?`).run(title, items ? JSON.stringify(items) : undefined, req.params.id, req.resident!.id);
  res.json({ ok: true });
});

experienceHubRouter.delete("/plans/:id", requireResident, requireFeature("experience.plan_my_day"), async (req, res) => {
  const r = await db.prepare(`DELETE FROM day_plans WHERE id = ? AND resident_id = ?`).run(req.params.id, req.resident!.id);
  if (r.changes !== 1) return res.status(404).json({ error: "Plan not found" });
  res.json({ ok: true });
});
