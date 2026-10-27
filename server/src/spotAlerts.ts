import { Router } from "express";
import { featureOn, requireFeature } from "./circleFeatures.js";
import { db } from "./db/index.js";
import { occupiesCapacitySql, startIsInFuture } from "./bookingIntegrity.js";
import { irelandWallTimeToUtc } from "./irelandTime.js";
import { notifyResident } from "./notifications.js";
import { orgActiveSql } from "./orgSql.js";
import { simpleRateLimit } from "./rateLimit.js";
import { requireResident } from "./residents.js";

// Experience 3.0 — Spot alerts for full experience / adventure departures
// (owner decision D4: departures only; games and clubs keep their waitlists).
// An alert is a promise to *tell* someone, never to hold a place: nothing
// here touches capacity or checkout. A departure counts as having a place
// only by the same rule checkout uses (occupiesCapacitySql — paid bookings
// plus live payment holds and review holds), and every send re-checks that
// the departure can still be booked. Each alert fires at most once; it
// expires when the departure starts. Uses the "waitlist" notification kind,
// so the resident's existing "Waitlist offers" preference applies.

export const spotAlertsRouter = Router();

interface SessionRow {
  id: string;
  experienceId: string;
  title: string;
  slug: string | null;
  date: string;
  time: string;
  status: string;
  capacity: number;
  salesClosed: number;
}

async function loadSession(experienceIdOrSlug: string, sessionId: string): Promise<SessionRow | undefined> {
  return (await db
    .prepare(
      `SELECT es.id, e.id as experienceId, e.title, e.slug, es.date, es.time, es.status, COALESCE(es.capacity, e.capacity) as capacity,
              (es.sales_close_at IS NOT NULL AND es.sales_close_at <= NOW()) as salesClosed
       FROM experience_sessions es JOIN experiences e ON e.id = es.experience_id
       WHERE es.id = ? AND (e.id = ? OR e.slug = ?) AND e.status = 'approved' AND ${orgActiveSql("e.vendor_id")}`
    )
    .get(sessionId, experienceIdOrSlug, experienceIdOrSlug)) as SessionRow | undefined;
}

/** Places left by checkout's own rule (held places count as taken). */
export async function placesLeft(sessionId: string, capacity: number): Promise<number> {
  const { n } = (await db.prepare(`SELECT COALESCE(SUM(party_size), 0) as n FROM experience_bookings WHERE session_id = ? AND ${occupiesCapacitySql()}`).get(sessionId)) as { n: number | string };
  return Math.max(0, capacity - Number(n));
}

function bookable(s: SessionRow): boolean {
  return s.status === "scheduled" && !Number(s.salesClosed) && startIsInFuture(s.date, s.time);
}

const limiter = simpleRateLimit({ windowMs: 15 * 60 * 1000, max: 30 });

spotAlertsRouter.get("/spot-alerts/mine", requireResident, requireFeature("experience.spot_alerts"), async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT a.session_id as sessionId, e.id as experienceId, e.slug, e.title, es.date, es.time, a.notified_at as notifiedAt
       FROM experience_spot_alerts a JOIN experience_sessions es ON es.id = a.session_id JOIN experiences e ON e.id = es.experience_id
       WHERE a.resident_id = ? AND a.cancelled_at IS NULL AND a.expires_at > NOW() ORDER BY es.date, es.time`
    )
    .all(req.resident!.id);
  res.json(rows);
});

spotAlertsRouter.post("/:id/sessions/:sessionId/spot-alert", requireResident, requireFeature("experience.spot_alerts"), limiter, async (req, res) => {
  const s = await loadSession(req.params.id, req.params.sessionId);
  if (!s) return res.status(404).json({ error: "Departure not found" });
  if (!bookable(s)) return res.status(409).json({ error: "This departure can't be booked any more" });
  if ((await placesLeft(s.id, s.capacity)) > 0) return res.status(409).json({ error: "There are places on this departure — you can book now", placesAvailable: true });
  const booked = await db
    .prepare(`SELECT 1 FROM experience_bookings WHERE session_id = ? AND resident_id = ? AND ${occupiesCapacitySql()} LIMIT 1`)
    .get(s.id, req.resident!.id);
  if (booked) return res.status(409).json({ error: "You already have a place on this departure" });
  const [h, m] = s.time.split(":").map(Number);
  const expiresAt = irelandWallTimeToUtc(s.date, h, m || 0);
  // Re-subscribing after a notice or a cancel starts a fresh alert.
  await db
    .prepare(
      `INSERT INTO experience_spot_alerts (session_id, resident_id, expires_at) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE notified_at = NULL, cancelled_at = NULL, expires_at = VALUES(expires_at), created_at = NOW()`
    )
    .run(s.id, req.resident!.id, expiresAt);
  res.status(201).json({ ok: true, sessionId: s.id });
});

spotAlertsRouter.delete("/:id/sessions/:sessionId/spot-alert", requireResident, requireFeature("experience.spot_alerts"), async (req, res) => {
  await db
    .prepare(`UPDATE experience_spot_alerts SET cancelled_at = NOW() WHERE session_id = ? AND resident_id = ? AND cancelled_at IS NULL`)
    .run(req.params.sessionId, req.resident!.id);
  res.json({ ok: true });
});

/** Tells everyone waiting on a departure that now has a place — once each.
 * Restart-safe: driven by stored rows, safe to run on a timer and after a
 * cancellation. Returns how many were told (for tests and logs). */
export async function sweepSpotAlerts(onlySessionId?: string): Promise<number> {
  if (!(await featureOn("experience.spot_alerts"))) return 0;
  const sessions = (await db
    .prepare(
      `SELECT DISTINCT a.session_id as id FROM experience_spot_alerts a
       WHERE a.notified_at IS NULL AND a.cancelled_at IS NULL AND a.expires_at > NOW() ${onlySessionId ? "AND a.session_id = ?" : ""} LIMIT 200`
    )
    .all(...(onlySessionId ? [onlySessionId] : []))) as { id: string }[];
  let told = 0;
  for (const { id } of sessions) {
    const exp = (await db.prepare(`SELECT experience_id as experienceId FROM experience_sessions WHERE id = ?`).get(id)) as { experienceId: string } | undefined;
    if (!exp) continue;
    const s = await loadSession(exp.experienceId, id);
    if (!s || !bookable(s) || (await placesLeft(s.id, s.capacity)) === 0) continue;
    const waiting = (await db
      .prepare(`SELECT id, resident_id as residentId FROM experience_spot_alerts WHERE session_id = ? AND notified_at IS NULL AND cancelled_at IS NULL AND expires_at > NOW()`)
      .all(id)) as { id: number; residentId: string }[];
    for (const w of waiting) {
      // Conditional, so two sweeps at once can't both send.
      const r = await db.prepare(`UPDATE experience_spot_alerts SET notified_at = NOW() WHERE id = ? AND notified_at IS NULL AND cancelled_at IS NULL`).run(w.id);
      if (r.changes !== 1) continue;
      await notifyResident({
        residentId: w.residentId,
        kind: "waitlist",
        title: `A place opened: ${s.title}`,
        body: `${s.date} at ${s.time}. It isn't held for you — book soon if you'd like it.`,
        listingType: "experience",
        listingId: s.slug ?? s.experienceId,
        ref: s.id,
      });
      told++;
    }
  }
  return told;
}
