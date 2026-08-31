import { Router } from "express";
import { assertPlatformRole, requirePlatformRole } from "../auth.js";
import { writeAudit } from "../audit.js";
import { db } from "../db/index.js";
import { sendMail } from "../email.js";
import { notifyCancellation } from "../notifications.js";
import { inClause, ownsCentre, ownsClub } from "./vendorHelpers.js";
import { irelandTodayIso } from "../irelandTime.js";

// Day-to-day operational surface: read-only bookings/registrations
// visibility, notifications, schedule/today, club waitlist, targeted
// messaging, attendance check-in — split out of the original single
// vendor.ts (see CLAUDE.md). Mounted under vendorRouter in vendor.ts,
// which applies requireVendor/attachVendorIds first.

export const vendorOperationsRouter = Router();

// --- read-only visibility into bookings/registrations for own listings -----

vendorOperationsRouter.get("/bookings", async (req, res) => {
  const ids = req.vendorIds!;
  const rows = await db
    .prepare(
      `SELECT b.ref, b.date, b.time, b.duration, b.event_type as eventType, b.guests, b.name, b.email, b.phone,
              b.notes, b.total_cents as totalCents, b.created_at as createdAt, b.status, b.payment_status as paymentStatus,
              c.name as centreName, r.name as roomName
       FROM bookings b
       JOIN centres c ON c.id = b.centre_id
       LEFT JOIN rooms r ON r.id = b.room_id AND r.centre_id = b.centre_id
       WHERE c.vendor_id IN (${inClause(ids)}) AND b.payment_status = 'paid'
       ORDER BY b.created_at DESC`
    )
    .all(...ids);
  res.json(rows);
});

/** Vendor-authorized cancel — status-only, same contract as the resident-facing
 * cancel in bookings.ts: no Stripe refund call, refunds are handled off-platform.
 * Unlike the resident-facing route, this is ownership-gated by req.vendorIds
 * (the vendor's own org), not by client_id/email, and has no cancellation-cutoff
 * check — a venue manager can cancel their own booking at any time. */
vendorOperationsRouter.post("/bookings/:ref/cancel", requirePlatformRole("centre_manager"), async (req, res) => {
  const ids = req.vendorIds!;
  const row = (await db
    .prepare(
      `SELECT b.ref, b.date, b.time, b.duration, b.guests, b.status, b.name, b.email,
              b.centre_id as centreId, c.name as centreName, c.vendor_id as vendorId
       FROM bookings b JOIN centres c ON c.id = b.centre_id
       WHERE b.ref = ? AND c.vendor_id IN (${inClause(ids)})`
    )
    .get(req.params.ref, ...ids)) as
    | { ref: string; date: string; time: string; duration: number; guests: number; status: string; name: string; email: string; centreId: string; centreName: string; vendorId: string | null }
    | undefined;
  if (!row) return res.status(404).json({ error: "Booking not found" });
  if (row.status === "cancelled") return res.status(409).json({ error: "This booking is already cancelled" });

  await db.prepare(`UPDATE bookings SET status = 'cancelled' WHERE ref = ?`).run(row.ref);

  await writeAudit({
    actorUserId: req.user!.id,
    action: "booking.cancelled_by_vendor",
    objectType: "booking",
    objectId: row.ref,
    previousValue: { status: row.status },
    newValue: { status: "cancelled" },
  });

  notifyCancellation({
    kind: "booking",
    listingType: "centre",
    listingId: row.centreId,
    listingName: row.centreName,
    vendorId: row.vendorId,
    guestName: row.name,
    guestEmail: row.email,
    ref: row.ref,
    detailsText: `${row.date} at ${row.time} · ${row.duration}h · ${row.guests} guests`,
  }).catch((e) => console.error("[notifications] vendor booking cancellation notify failed:", e));

  res.json({ ok: true });
});

vendorOperationsRouter.get("/registrations", async (req, res) => {
  const ids = req.vendorIds!;
  const rows = await db
    .prepare(
      `SELECT r.ref, r.team, r.child_first as childFirst, r.child_last as childLast, r.dob,
              r.g_first as gFirst, r.g_last as gLast, r.email, r.phone, r.trial, r.total_cents as totalCents,
              r.created_at as createdAt, r.status, c.name as clubName, c.sport
       FROM registrations r
       JOIN clubs c ON c.id = r.club_id
       WHERE c.vendor_id IN (${inClause(ids)}) AND r.payment_status = 'paid'
       ORDER BY r.created_at DESC`
    )
    .all(...ids);
  res.json(rows);
});

// --- notifications (new bookings/registrations on the vendor's own listings) -
// Deliberately kept personal (recipient_id = you), not org-scoped — this is
// your own notification inbox, not a listing resource; see notifications.ts
// for how recipient_id is chosen when a booking/registration is created.

vendorOperationsRouter.get("/notifications", async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT id, kind, title, body, listing_type as listingType, listing_id as listingId, ref, \`read\`, created_at as createdAt
       FROM notifications WHERE recipient_id = ? ORDER BY created_at DESC`
    )
    .all(req.user!.id);
  res.json(rows);
});

vendorOperationsRouter.post("/notifications/:id/read", async (req, res) => {
  const info = await db.prepare(`UPDATE notifications SET \`read\` = 1 WHERE id = ? AND recipient_id = ?`).run(req.params.id, req.user!.id);
  if (info.changes === 0) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
});

// --- Schedule / Today's Operations (Phase B) --------------------------
// Aggregates the vendor's own program_sessions — the one genuinely new,
// generic "session" concept — for a given date range. Deliberately does
// NOT also try to fold in centre-hire bookings or club registrations onto
// the same calendar shape; those stay in their own existing screens (see
// plan doc: not migrating old flows onto the new model).

vendorOperationsRouter.get("/schedule", async (req, res) => {
  const ids = req.vendorIds!;
  const from = typeof req.query.from === "string" ? req.query.from : irelandTodayIso();
  const days = Math.min(Number(req.query.days) || 30, 90);
  const rows = await db
    .prepare(
      `SELECT ps.id, ps.date, ps.time, ps.duration_minutes as durationMinutes, ps.capacity, p.title, p.id as programId,
              (SELECT COUNT(*) FROM program_enrollments pe WHERE pe.program_id = p.id AND pe.payment_status = 'paid' AND pe.status != 'cancelled') as enrolled
       FROM program_sessions ps JOIN programs p ON p.id = ps.program_id
       WHERE p.vendor_id IN (${inClause(ids)}) AND ps.status != 'cancelled' AND ps.date >= ? AND ps.date <= DATE_ADD(?, INTERVAL ? DAY)
       ORDER BY ps.date, ps.time`
    )
    .all(...ids, from, from, days);
  res.json(rows);
});

// --- "Today" summary for the dashboard Overview tab -------------------
// Unlike /schedule above (deliberately program-sessions-only), this
// endpoint exists specifically to answer "what's happening today across
// my whole business" — today's paid hall bookings, plus today's recurring
// club sessions (day-of-week match, not a specific booked date the way
// hall hire is). Registrations aren't included: a registration is a
// one-time sign-up with no scheduled "today," unlike a booking or a
// recurring session.
vendorOperationsRouter.get("/today", async (req, res) => {
  const ids = req.vendorIds!;
  const today = irelandTodayIso();
  // Derived from the Ireland-correct `today` string (noon UTC to stay clear
  // of any date-shift), not a raw `new Date().getDay()` — the latter is the
  // server process's own local/UTC day, wrong for the same BST midnight-hour
  // window irelandTodayIso() exists to fix.
  const dayOfWeek = new Date(`${today}T12:00:00Z`).getUTCDay();
  const bookings = await db
    .prepare(
      `SELECT b.ref, b.time, b.duration, b.guests, b.name, c.name as centreName
       FROM bookings b JOIN centres c ON c.id = b.centre_id
       WHERE c.vendor_id IN (${inClause(ids)}) AND b.date = ? AND b.payment_status = 'paid' AND b.status != 'cancelled'
       ORDER BY b.time`
    )
    .all(...ids, today);
  const clubSessions = await db
    .prepare(
      `SELECT cs.id, cs.time, cs.label, cs.capacity, cs.instructor_name as instructorName, c.name as clubName
       FROM club_sessions cs JOIN clubs c ON c.id = cs.club_id
       WHERE c.vendor_id IN (${inClause(ids)}) AND cs.day_of_week = ? AND cs.active = 1
       ORDER BY cs.time`
    )
    .all(...ids, dayOfWeek);
  res.json({ bookings, clubSessions });
});

// --- club waitlist visibility (Tier 3 — was genuinely missing, not just
// missing UI: no route here saw a club's waitlist at all until now) --------

vendorOperationsRouter.get("/clubs/:id/waitlist", async (req, res) => {
  if (!(await ownsClub(req.vendorIds!, req.params.id))) return res.status(403).json({ error: "Not your listing" });
  const rows = await db
    .prepare(
      `SELECT id, name, email, status, created_at as createdAt, offer_expires_at as offerExpiresAt
       FROM waitlist_entries WHERE listing_type = 'club' AND listing_id = ? AND status IN ('waiting', 'offered') ORDER BY id`
    )
    .all(req.params.id);
  res.json(rows);
});

// --- targeted communications (NEXT) ---------------------------------------
// Distinct from the automatic booking/registration notifications above — a
// vendor-authored message to everyone with a paid booking/registration on
// one of their own listings. Deliberately email-only (no in-app inbox for
// this yet) to keep this a small, self-contained addition. Org-scoped like
// the rest of these vendor* files: any org member can see the org's sent
// messages.

interface MessageInput {
  listingType: "centre" | "club";
  listingId: string;
  subject: string;
  body: string;
}

vendorOperationsRouter.post("/messages", requirePlatformRole("communications"), async (req, res) => {
  const b = req.body as MessageInput;
  if (!b.listingType || !b.listingId || !b.subject || !b.body) return res.status(400).json({ error: "Missing required fields" });
  const owns = b.listingType === "centre" ? await ownsCentre(req.vendorIds!, b.listingId) : await ownsClub(req.vendorIds!, b.listingId);
  if (!owns) return res.status(403).json({ error: "Not your listing" });

  const recipients = (
    b.listingType === "centre"
      ? await db.prepare(`SELECT DISTINCT email FROM bookings WHERE centre_id = ? AND payment_status = 'paid' AND status != 'cancelled'`).all(b.listingId)
      : await db.prepare(`SELECT DISTINCT email FROM registrations WHERE club_id = ? AND payment_status = 'paid' AND status != 'cancelled'`).all(b.listingId)
  ) as { email: string }[];

  await db
    .prepare(`INSERT INTO vendor_messages (vendor_id, listing_type, listing_id, subject, body) VALUES (?, ?, ?, ?, ?)`)
    .run(req.user!.id, b.listingType, b.listingId, b.subject, b.body);

  for (const r of recipients) {
    await sendMail({ to: r.email, subject: b.subject, text: b.body }).catch((e) => console.error("[vendor messages] send failed:", e));
  }

  res.status(201).json({ ok: true, recipientCount: recipients.length });
});

vendorOperationsRouter.get("/messages", async (req, res) => {
  const ids = req.vendorIds!;
  const rows = await db
    .prepare(
      `SELECT id, listing_type as listingType, listing_id as listingId, subject, body, created_at as createdAt
       FROM vendor_messages WHERE vendor_id IN (${inClause(ids)}) ORDER BY created_at DESC`
    )
    .all(...ids);
  res.json(rows);
});

// --- attendance check-in (FUTURE, best-effort) ----------------------------
// Manual: staff look up a booking/registration ref and mark it — no
// hardware/QR-scanning integration (see plan doc "Not yet" section).

async function checkinListingVendorId(kind: "booking" | "registration", ref: string): Promise<string | null> {
  const table = kind === "booking" ? "bookings" : "registrations";
  const listingCol = kind === "booking" ? "centre_id" : "club_id";
  const listingTable = kind === "booking" ? "centres" : "clubs";
  const row = (await db
    .prepare(`SELECT l.vendor_id as vendorId FROM ${table} t JOIN ${listingTable} l ON l.id = t.${listingCol} WHERE t.ref = ?`)
    .get(ref)) as { vendorId: string | null } | undefined;
  return row?.vendorId ?? null;
}

vendorOperationsRouter.post("/checkin/:kind/:ref", async (req, res) => {
  const { kind, ref } = req.params as { kind: "booking" | "registration"; ref: string };
  if (kind !== "booking" && kind !== "registration") return res.status(400).json({ error: "kind must be booking or registration" });
  // A booking is centre-side, a registration is club-side — same role split
  // as everywhere else, and known directly from the URL, no lookup needed.
  if (!assertPlatformRole(req, res, kind === "booking" ? "centre_manager" : "facility_manager")) return;

  const table = kind === "booking" ? "bookings" : "registrations";
  const listingCol = kind === "booking" ? "centre_id" : "club_id";
  const listingTable = kind === "booking" ? "centres" : "clubs";
  const row = (await db
    .prepare(`SELECT t.${listingCol} as listingId, l.vendor_id as vendorId, t.payment_status as paymentStatus FROM ${table} t JOIN ${listingTable} l ON l.id = t.${listingCol} WHERE t.ref = ?`)
    .get(ref)) as { listingId: string; vendorId: string | null; paymentStatus: string } | undefined;
  if (!row) return res.status(404).json({ error: "Not found" });
  if (!row.vendorId || !req.vendorIds!.includes(row.vendorId)) return res.status(403).json({ error: "Not your listing" });
  if (row.paymentStatus !== "paid") return res.status(409).json({ error: "This isn't a paid booking/registration" });

  await db
    .prepare(`INSERT INTO attendance (kind, ref, checked_in_by) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE checked_in_at = NOW(), checked_in_by = VALUES(checked_in_by)`)
    .run(kind, ref, req.user!.id);
  res.json({ ok: true });
});

vendorOperationsRouter.get("/checkin/:kind/:ref", async (req, res) => {
  const { kind, ref } = req.params as { kind: "booking" | "registration"; ref: string };
  if (kind !== "booking" && kind !== "registration") return res.status(400).json({ error: "kind must be booking or registration" });
  // Previously had no ownership check at all — any approved vendor could
  // query any ref's check-in status system-wide. Fixed alongside the
  // org-scoping pass since it's the same "who can see this ref" question.
  const vendorId = await checkinListingVendorId(kind, ref);
  if (!vendorId || !req.vendorIds!.includes(vendorId)) return res.status(403).json({ error: "Not your listing" });
  // Also had no role check at all (unlike its POST sibling) — an invited
  // staff member with any platform_role, e.g. finance, could read another
  // team's check-in status. Same role split as the POST handler above.
  if (!assertPlatformRole(req, res, kind === "booking" ? "centre_manager" : "facility_manager")) return;
  const row = await db.prepare(`SELECT checked_in_at as checkedInAt FROM attendance WHERE kind = ? AND ref = ?`).get(kind, ref);
  res.json({ checkedIn: !!row, checkedInAt: (row as { checkedInAt: string } | undefined)?.checkedInAt ?? null });
});
