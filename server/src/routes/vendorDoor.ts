import { Router, type Request, type Response } from "express";
import { checkinOnly, hasPlatformRole } from "../auth.js";
import { writeAudit } from "../audit.js";
import { db } from "../db/index.js";
import { irelandTodayIso } from "../irelandTime.js";
import { checkinOn } from "../participation/options.js";
import {
  CheckinError,
  DOOR_ROSTER_ROLES,
  admitVerdict,
  checkIn,
  doorBookingByRef,
  doorBookings,
  doorScope,
  doorViews,
  loadDoorSession,
  undoCheckIn,
  type DoorSession,
} from "../participation/checkin.js";

// Participation Phase 2 — the door API (/api/vendor/door/*), the only partner
// API the check-in-only role can reach (auth.ts requireVendor allow-list).
// Every route re-decides scope from the database (participation/checkin.ts
// doorScope) and answers without amounts, email or phone. Off (404) while
// participation.checkin is off.

export const vendorDoorRouter = Router();

vendorDoorRouter.use(async (_req, res, next) => {
  if (!(await checkinOn())) return res.status(404).json({ error: "Door check-in isn't available yet" });
  next();
});

/** The sessions this person can check in for, today and the next 7 days. */
vendorDoorRouter.get("/", async (req, res) => {
  const user = req.user!;
  const today = irelandTodayIso();
  const until = new Date(Date.parse(`${today}T12:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
  const ids = req.vendorIds!;
  let rows: Record<string, unknown>[];
  if (checkinOnly(user)) {
    rows = (await db
      .prepare(
        `SELECT DISTINCT es.id AS sessionId, e.id AS experienceId, e.title, e.kind, es.date, es.time, es.status
         FROM listing_staff_assignments a
         JOIN experiences e ON e.id = a.listing_id
         JOIN experience_sessions es ON es.experience_id = e.id AND (a.session_id IS NULL OR a.session_id = es.id)
         WHERE a.user_id = ? AND a.org_id = ? AND a.listing_type = 'experience' AND a.duty = 'checkin' AND a.revoked_at IS NULL
           AND e.vendor_id IN (${ids.map(() => "?").join(", ")}) AND es.date BETWEEN ? AND ?
         ORDER BY es.date, es.time`
      )
      .all(user.id, user.orgId ?? "", ...ids, today, until)) as Record<string, unknown>[];
  } else if (hasPlatformRole(user, ...DOOR_ROSTER_ROLES)) {
    rows = (await db
      .prepare(
        `SELECT es.id AS sessionId, e.id AS experienceId, e.title, e.kind, es.date, es.time, es.status
         FROM experience_sessions es JOIN experiences e ON e.id = es.experience_id
         WHERE e.vendor_id IN (${ids.map(() => "?").join(", ")}) AND es.date BETWEEN ? AND ?
           AND EXISTS (SELECT 1 FROM experience_bookings eb WHERE eb.session_id = es.id AND eb.payment_status = 'paid' AND eb.status != 'cancelled')
         ORDER BY es.date, es.time`
      )
      .all(...ids, today, until)) as Record<string, unknown>[];
  } else {
    return res.status(403).json({ error: "Your role can't check people in" });
  }
  res.json({ today, sessions: rows.map((r) => ({ ...r, isToday: r.date === today })) });
});

async function scoped(req: Request, res: Response): Promise<DoorSession | null> {
  const session = await loadDoorSession(req.params.sessionId);
  const scope = await doorScope(req.user!, req.vendorIds!, session);
  if (!scope.ok) {
    res.status(scope.status).json({ error: scope.error });
    return null;
  }
  return session;
}

function sessionJson(s: DoorSession) {
  return { sessionId: s.sessionId, experienceId: s.experienceId, title: s.title, kind: s.kind, date: s.date, time: s.time, status: s.status, isToday: s.date === irelandTodayIso() };
}

vendorDoorRouter.get("/sessions/:sessionId", async (req, res) => {
  const session = await scoped(req, res);
  if (!session) return;
  const bookings = await doorViews(await doorBookings(session.sessionId), session);
  const people = bookings.reduce((n, b) => n + b.people.length, 0);
  const arrived = bookings.reduce((n, b) => n + b.checkedIn, 0);
  res.json({ session: sessionJson(session), counts: { bookings: bookings.length, people, checkedIn: arrived, notArrived: people - arrived }, bookings });
});

/** A scanned pass or a typed reference. Any reason to refuse comes back with the booking, so staff see why. */
vendorDoorRouter.post("/sessions/:sessionId/lookup", async (req, res) => {
  const session = await scoped(req, res);
  if (!session) return;
  const code = typeof req.body?.code === "string" ? req.body.code.trim().toUpperCase() : "";
  if (!/^EX-[A-Z0-9-]{3,40}$/.test(code)) return res.status(400).json({ error: "That isn't a HelloCircle event pass", reason: "not_a_pass" });
  const row = await doorBookingByRef(code, session.experienceId);
  // Another listing's (or another organisation's) booking: never say whose.
  if (!row) return res.status(404).json({ error: "This pass isn't for this event", reason: "other_listing" });
  const [view] = await doorViews([row], session);
  res.json({ booking: view, verdict: admitVerdict(row, session) });
});

vendorDoorRouter.post("/sessions/:sessionId/checkins", async (req, res) => {
  const session = await scoped(req, res);
  if (!session) return;
  const { ref, attendeeNos, method } = (req.body ?? {}) as { ref?: unknown; attendeeNos?: unknown; method?: unknown };
  if (typeof ref !== "string" || !ref) return res.status(400).json({ error: "Which booking?" });
  if (!Array.isArray(attendeeNos) || attendeeNos.length === 0 || attendeeNos.length > 200 || !attendeeNos.every((n) => Number.isInteger(n) && n >= 1)) {
    return res.status(400).json({ error: "Choose who is arriving" });
  }
  try {
    const results = await checkIn({ ref: ref.toUpperCase(), session, attendeeNos: attendeeNos as number[], method: method === "qr" ? "qr" : "manual", userId: req.user!.id });
    const fresh = results.filter((r) => r.result === "checked_in").map((r) => r.attendeeNo);
    if (fresh.length) {
      await writeAudit({ actorUserId: req.user!.id, action: "experience_booking.checked_in", objectType: "experience_booking", objectId: ref.toUpperCase(), newValue: { sessionId: session.sessionId, attendeeNos: fresh, method: method === "qr" ? "qr" : "manual" } });
    }
    const row = await doorBookingByRef(ref.toUpperCase(), session.experienceId);
    const [booking] = row ? await doorViews([row], session) : [null];
    res.json({ results, booking });
  } catch (e) {
    if (e instanceof CheckinError) return res.status(e.status).json({ error: e.message, reason: e.reason });
    throw e;
  }
});

vendorDoorRouter.delete("/sessions/:sessionId/checkins/:ref/:attendeeNo", async (req, res) => {
  const session = await scoped(req, res);
  if (!session) return;
  const ref = req.params.ref.toUpperCase();
  const attendeeNo = Number(req.params.attendeeNo);
  const row = await doorBookingByRef(ref, session.experienceId);
  if (!row || row.sessionId !== session.sessionId || !Number.isInteger(attendeeNo)) return res.status(404).json({ error: "Not found" });
  if (!(await undoCheckIn({ ref, attendeeNo }))) return res.status(404).json({ error: "That person wasn't checked in" });
  await writeAudit({ actorUserId: req.user!.id, action: "experience_booking.checkin_undone", objectType: "experience_booking", objectId: ref, newValue: { sessionId: session.sessionId, attendeeNo } });
  const [booking] = await doorViews([row], session);
  res.json({ ok: true, booking });
});
