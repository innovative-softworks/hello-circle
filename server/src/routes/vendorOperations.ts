import { Router } from "express";
import { assertPlatformRole, requirePlatformRole } from "../auth.js";
import { writeAudit } from "../audit.js";
import { issueStripeRefund } from "../checkoutService.js";
import { db } from "../db/index.js";
import { sendMail } from "../email.js";
import { notifyCancellation, notifyRefund, resendConfirmationEmail } from "../notifications.js";
import { inClause, ownsCentre, ownsClub } from "./vendorHelpers.js";
import { irelandTodayIso } from "../irelandTime.js";
import { offerToWaitlistEntry, promoteNextWaitlistEntry } from "../waitlist.js";

// Day-to-day operational surface: read-only bookings/registrations
// visibility, notifications, schedule/today, club waitlist, targeted
// messaging, attendance check-in — split out of the original single
// vendor.ts (see CLAUDE.md). Mounted under vendorRouter in vendor.ts,
// which applies requireVendor/attachVendorIds first.

export const vendorOperationsRouter = Router();

// --- read-only visibility into bookings/registrations for own listings -----

// `?centreId=` (Host Manage spec §8's per-listing workspace) narrows this to
// one centre — used by VendorCentreEditPage.tsx's Bookings sub-tab; the
// unparameterized dashboard-wide caller (VendorBookings.tsx) keeps today's
// across-every-listing behaviour.
vendorOperationsRouter.get("/bookings", async (req, res) => {
  const ids = req.vendorIds!;
  const centreId = typeof req.query.centreId === "string" ? req.query.centreId : undefined;
  const rows = await db
    .prepare(
      `SELECT b.ref, b.date, b.time, b.duration, b.event_type as eventType, b.guests, b.name, b.email, b.phone,
              b.notes, b.total_cents as totalCents, b.created_at as createdAt, b.status, b.payment_status as paymentStatus,
              (b.stripe_session_id IS NOT NULL) as hasStripePayment,
              b.centre_id as centreId, c.name as centreName, r.name as roomName
       FROM bookings b
       JOIN centres c ON c.id = b.centre_id
       LEFT JOIN rooms r ON r.id = b.room_id AND r.centre_id = b.centre_id
       WHERE c.vendor_id IN (${inClause(ids)}) AND b.payment_status IN ('paid', 'refunded') ${centreId ? "AND b.centre_id = ?" : ""}
       ORDER BY b.created_at DESC`
    )
    .all(...ids, ...(centreId ? [centreId] : []));
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

/** Registration equivalent of the booking cancel route above — didn't exist
 * before (only check-in did for registrations; the only prior registration
 * cancel was the guest-facing one in registrations.ts, gated by client-id/
 * email, not usable from the vendor dashboard). Same shape: status-only, no
 * refund call, ownership via req.vendorIds, facility_manager-gated to match
 * the registration check-in role split below. Also promotes the club-wide
 * waitlist on cancel, same as the guest-facing route in registrations.ts —
 * this one previously didn't, which meant a vendor-cancelled registration
 * never freed its spot to whoever was waiting. */
vendorOperationsRouter.post("/registrations/:ref/cancel", requirePlatformRole("facility_manager"), async (req, res) => {
  const ids = req.vendorIds!;
  const row = (await db
    .prepare(
      `SELECT r.ref, r.child_first as childFirst, r.child_last as childLast, r.team, r.status,
              r.g_first as gFirst, r.g_last as gLast, r.email,
              r.club_id as clubId, c.name as clubName, c.vendor_id as vendorId
       FROM registrations r JOIN clubs c ON c.id = r.club_id
       WHERE r.ref = ? AND c.vendor_id IN (${inClause(ids)})`
    )
    .get(req.params.ref, ...ids)) as
    | {
        ref: string;
        childFirst: string;
        childLast: string;
        team: string | null;
        status: string;
        gFirst: string;
        gLast: string;
        email: string;
        clubId: string;
        clubName: string;
        vendorId: string | null;
      }
    | undefined;
  if (!row) return res.status(404).json({ error: "Registration not found" });
  if (row.status === "cancelled") return res.status(409).json({ error: "This registration is already cancelled" });

  await db.prepare(`UPDATE registrations SET status = 'cancelled' WHERE ref = ?`).run(row.ref);

  await writeAudit({
    actorUserId: req.user!.id,
    action: "registration.cancelled_by_vendor",
    objectType: "registration",
    objectId: row.ref,
    previousValue: { status: row.status },
    newValue: { status: "cancelled" },
  });

  notifyCancellation({
    kind: "registration",
    listingType: "club",
    listingId: row.clubId,
    listingName: row.clubName,
    vendorId: row.vendorId,
    guestName: `${row.gFirst} ${row.gLast}`,
    guestEmail: row.email,
    ref: row.ref,
    detailsText: `${row.childFirst} ${row.childLast}${row.team ? ` · ${row.team}` : ""}`,
  }).catch((e) => console.error("[notifications] vendor registration cancellation notify failed:", e));

  promoteNextWaitlistEntry("club", row.clubId, row.clubName);

  res.json({ ok: true });
});

/** "Resend confirmation" (Host Manage spec §10) — didn't exist anywhere;
 * confirmation emails previously sent exactly once, at creation. Rebuilds
 * detailsText fresh from the current row rather than the original
 * (ephemeral, never stored) string — same format the creation handler in
 * bookings.ts uses. */
vendorOperationsRouter.post("/bookings/:ref/resend-confirmation", requirePlatformRole("centre_manager"), async (req, res) => {
  const ids = req.vendorIds!;
  const row = (await db
    .prepare(
      `SELECT b.ref, b.date, b.time, b.duration, b.guests, b.name, b.email, b.status,
              b.centre_id as centreId, c.name as centreName, c.vendor_id as vendorId
       FROM bookings b JOIN centres c ON c.id = b.centre_id
       WHERE b.ref = ? AND c.vendor_id IN (${inClause(ids)})`
    )
    .get(req.params.ref, ...ids)) as
    | { ref: string; date: string; time: string; duration: number; guests: number; name: string; email: string; status: string; centreId: string; centreName: string; vendorId: string | null }
    | undefined;
  if (!row) return res.status(404).json({ error: "Booking not found" });
  if (row.status === "cancelled") return res.status(409).json({ error: "This booking is cancelled — nothing to confirm" });

  resendConfirmationEmail({
    kind: "booking",
    listingType: "centre",
    listingId: row.centreId,
    listingName: row.centreName,
    vendorId: row.vendorId,
    guestName: row.name,
    guestEmail: row.email,
    ref: row.ref,
    detailsText: `${row.date} at ${row.time} · ${row.duration}h · ${row.guests} guests`,
  }).catch((e) => console.error("[notifications] resend booking confirmation failed:", e));

  res.json({ ok: true });
});

vendorOperationsRouter.post("/registrations/:ref/resend-confirmation", requirePlatformRole("facility_manager"), async (req, res) => {
  const ids = req.vendorIds!;
  const row = (await db
    .prepare(
      `SELECT r.ref, r.child_first as childFirst, r.child_last as childLast, r.team, r.status,
              r.g_first as gFirst, r.g_last as gLast, r.email,
              r.club_id as clubId, c.name as clubName, c.vendor_id as vendorId
       FROM registrations r JOIN clubs c ON c.id = r.club_id
       WHERE r.ref = ? AND c.vendor_id IN (${inClause(ids)})`
    )
    .get(req.params.ref, ...ids)) as
    | {
        ref: string;
        childFirst: string;
        childLast: string;
        team: string | null;
        status: string;
        gFirst: string;
        gLast: string;
        email: string;
        clubId: string;
        clubName: string;
        vendorId: string | null;
      }
    | undefined;
  if (!row) return res.status(404).json({ error: "Registration not found" });
  if (row.status === "cancelled") return res.status(409).json({ error: "This registration is cancelled — nothing to confirm" });

  resendConfirmationEmail({
    kind: "registration",
    listingType: "club",
    listingId: row.clubId,
    listingName: row.clubName,
    vendorId: row.vendorId,
    guestName: `${row.gFirst} ${row.gLast}`,
    guestEmail: row.email,
    ref: row.ref,
    detailsText: `${row.childFirst} ${row.childLast}${row.team ? ` · ${row.team}` : ""}`,
  }).catch((e) => console.error("[notifications] resend registration confirmation failed:", e));

  res.json({ ok: true });
});

// --- refunds (Host Manage spec §10/§14) -----------------------------------
// The one thing here that moves real money — didn't exist anywhere before
// (bookings.ts/registrations.ts/games.ts all explicitly document refunds as
// "handled off-platform"). Gated by the finance role, distinct from the
// operational centre_manager/facility_manager cancel gate above. A cash
// booking has no Stripe charge to refund (stripe_session_id is only set on
// a paid-online booking) — 400s with a clear message instead of silently
// no-op'ing. issueStripeRefund itself now lives in checkoutService.ts,
// shared with vendorPrograms.ts/vendorExperiences.ts's refund routes
// (Phase 0 protect) rather than duplicated per resource.

vendorOperationsRouter.post("/bookings/:ref/refund", requirePlatformRole("finance"), async (req, res) => {
  const ids = req.vendorIds!;
  const row = (await db
    .prepare(
      `SELECT b.ref, b.date, b.time, b.duration, b.guests, b.name, b.email, b.payment_status as paymentStatus, b.stripe_session_id as stripeSessionId,
              b.centre_id as centreId, c.name as centreName, c.vendor_id as vendorId
       FROM bookings b JOIN centres c ON c.id = b.centre_id
       WHERE b.ref = ? AND c.vendor_id IN (${inClause(ids)})`
    )
    .get(req.params.ref, ...ids)) as
    | { ref: string; date: string; time: string; duration: number; guests: number; name: string; email: string; paymentStatus: string; stripeSessionId: string | null; centreId: string; centreName: string; vendorId: string | null }
    | undefined;
  if (!row) return res.status(404).json({ error: "Booking not found" });
  if (row.paymentStatus === "refunded") return res.status(409).json({ error: "This booking has already been refunded" });
  if (row.paymentStatus !== "paid") return res.status(400).json({ error: "Only a paid booking can be refunded" });
  if (!row.stripeSessionId) return res.status(400).json({ error: "This was a cash booking — refund the guest directly, not through Stripe" });

  const result = await issueStripeRefund(row.stripeSessionId);
  if (!result.ok) return res.status(502).json({ error: result.error });

  // Guarded on payment_status='paid', same .changes idempotency idiom the
  // Stripe webhook's confirm* functions use — without it, two concurrent
  // refund requests could both pass the earlier SELECT-time check and both
  // call Stripe, double-refunding. changes===0 here means we lost the race
  // (already refunded by a concurrent request), so skip the notify/audit —
  // the request that won already sent them.
  const updateResult = await db.prepare(`UPDATE bookings SET payment_status = 'refunded' WHERE ref = ? AND payment_status = 'paid'`).run(row.ref);
  if (updateResult.changes === 0) {
    return res.status(409).json({ error: "This booking has already been refunded" });
  }
  await writeAudit({
    actorUserId: req.user!.id,
    action: "booking.refunded_by_vendor",
    objectType: "booking",
    objectId: row.ref,
    previousValue: { paymentStatus: row.paymentStatus },
    newValue: { paymentStatus: "refunded", amountCents: result.amountCents },
  });

  notifyRefund({
    kind: "booking",
    listingType: "centre",
    listingId: row.centreId,
    listingName: row.centreName,
    vendorId: row.vendorId,
    guestName: row.name,
    guestEmail: row.email,
    ref: row.ref,
    detailsText: `${row.date} at ${row.time} · ${row.duration}h · ${row.guests} guests`,
    refundedCents: result.amountCents,
  }).catch((e) => console.error("[notifications] booking refund notify failed:", e));

  res.json({ ok: true });
});

vendorOperationsRouter.post("/registrations/:ref/refund", requirePlatformRole("finance"), async (req, res) => {
  const ids = req.vendorIds!;
  const row = (await db
    .prepare(
      `SELECT r.ref, r.child_first as childFirst, r.child_last as childLast, r.team, r.payment_status as paymentStatus, r.stripe_session_id as stripeSessionId,
              r.g_first as gFirst, r.g_last as gLast, r.email,
              r.club_id as clubId, c.name as clubName, c.vendor_id as vendorId
       FROM registrations r JOIN clubs c ON c.id = r.club_id
       WHERE r.ref = ? AND c.vendor_id IN (${inClause(ids)})`
    )
    .get(req.params.ref, ...ids)) as
    | {
        ref: string;
        childFirst: string;
        childLast: string;
        team: string | null;
        paymentStatus: string;
        stripeSessionId: string | null;
        gFirst: string;
        gLast: string;
        email: string;
        clubId: string;
        clubName: string;
        vendorId: string | null;
      }
    | undefined;
  if (!row) return res.status(404).json({ error: "Registration not found" });
  if (row.paymentStatus === "refunded") return res.status(409).json({ error: "This registration has already been refunded" });
  if (row.paymentStatus !== "paid") return res.status(400).json({ error: "Only a paid registration can be refunded" });
  if (!row.stripeSessionId) return res.status(400).json({ error: "This was a cash registration — refund the guest directly, not through Stripe" });

  const result = await issueStripeRefund(row.stripeSessionId);
  if (!result.ok) return res.status(502).json({ error: result.error });

  // Same payment_status='paid'-guarded idempotency check as the booking
  // refund route above — see that route's comment for why.
  const updateResult = await db.prepare(`UPDATE registrations SET payment_status = 'refunded' WHERE ref = ? AND payment_status = 'paid'`).run(row.ref);
  if (updateResult.changes === 0) {
    return res.status(409).json({ error: "This registration has already been refunded" });
  }
  await writeAudit({
    actorUserId: req.user!.id,
    action: "registration.refunded_by_vendor",
    objectType: "registration",
    objectId: row.ref,
    previousValue: { paymentStatus: row.paymentStatus },
    newValue: { paymentStatus: "refunded", amountCents: result.amountCents },
  });

  notifyRefund({
    kind: "registration",
    listingType: "club",
    listingId: row.clubId,
    listingName: row.clubName,
    vendorId: row.vendorId,
    guestName: `${row.gFirst} ${row.gLast}`,
    guestEmail: row.email,
    ref: row.ref,
    detailsText: `${row.childFirst} ${row.childLast}${row.team ? ` · ${row.team}` : ""}`,
    refundedCents: result.amountCents,
  }).catch((e) => console.error("[notifications] registration refund notify failed:", e));

  res.json({ ok: true });
});

// `?clubId=` — same per-listing narrowing as GET /bookings above, used by
// VendorClubEditPage.tsx's Registrations sub-tab.
vendorOperationsRouter.get("/registrations", async (req, res) => {
  const ids = req.vendorIds!;
  const clubId = typeof req.query.clubId === "string" ? req.query.clubId : undefined;
  const rows = await db
    .prepare(
      `SELECT r.ref, r.team, r.child_first as childFirst, r.child_last as childLast, r.dob,
              r.g_first as gFirst, r.g_last as gLast, r.email, r.phone, r.trial, r.total_cents as totalCents,
              r.created_at as createdAt, r.status, r.payment_status as paymentStatus,
              (r.stripe_session_id IS NOT NULL) as hasStripePayment,
              r.club_id as clubId, c.name as clubName, c.sport
       FROM registrations r
       JOIN clubs c ON c.id = r.club_id
       WHERE c.vendor_id IN (${inClause(ids)}) AND r.payment_status IN ('paid', 'refunded') ${clubId ? "AND r.club_id = ?" : ""}
       ORDER BY r.created_at DESC`
    )
    .all(...ids, ...(clubId ? [clubId] : []));
  res.json(rows);
});

/** Club "Participants" (Host Manage spec §11) — a centre's equivalent would
 * be identical to its Bookings list (one-off guest per booking, no roster
 * concept in the schema), so this only exists for clubs, where registrations
 * genuinely group into something new: a roster by child, not a flat list of
 * sign-ups. */
vendorOperationsRouter.get("/clubs/:id/participants", async (req, res) => {
  if (!(await ownsClub(req.vendorIds!, req.params.id))) return res.status(403).json({ error: "Not your listing" });
  const rows = (await db
    .prepare(
      `SELECT child_first as childFirst, child_last as childLast, team, status, total_cents as totalCents, created_at as createdAt
       FROM registrations WHERE club_id = ? AND payment_status = 'paid' ORDER BY child_last, child_first, created_at DESC`
    )
    .all(req.params.id)) as { childFirst: string; childLast: string; team: string; status: string; totalCents: number; createdAt: string }[];

  const byChild = new Map<string, { childFirst: string; childLast: string; teams: Set<string>; registrations: number; active: boolean; lastRegisteredAt: string }>();
  for (const r of rows) {
    const key = `${r.childFirst}::${r.childLast}`;
    const existing = byChild.get(key);
    if (existing) {
      existing.teams.add(r.team);
      existing.registrations += 1;
      existing.active = existing.active || r.status !== "cancelled";
      if (r.createdAt > existing.lastRegisteredAt) existing.lastRegisteredAt = r.createdAt;
    } else {
      byChild.set(key, { childFirst: r.childFirst, childLast: r.childLast, teams: new Set([r.team]), registrations: 1, active: r.status !== "cancelled", lastRegisteredAt: r.createdAt });
    }
  }
  res.json([...byChild.values()].map((c) => ({ ...c, teams: [...c.teams] })));
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

/** Host Manage spec §15 — the only vendor waitlist action before this was
 * read-only visibility above; this lets a vendor invite a *specific*
 * waiting person instead of only ever automatic earliest-first promotion. */
vendorOperationsRouter.post("/clubs/:id/waitlist/:entryId/offer", requirePlatformRole("facility_manager"), async (req, res) => {
  if (!(await ownsClub(req.vendorIds!, req.params.id))) return res.status(403).json({ error: "Not your listing" });
  const club = (await db.prepare(`SELECT name FROM clubs WHERE id = ?`).get(req.params.id)) as { name: string } | undefined;
  if (!club) return res.status(404).json({ error: "Club not found" });
  const result = await offerToWaitlistEntry(Number(req.params.entryId), "club", req.params.id, club.name);
  if (!result.ok) return res.status(409).json({ error: result.error });
  res.json({ ok: true });
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

// --- reviews reply (Host Manage spec §16) ---------------------------------
// No vendor-facing reviews surface existed before — reviews.ts only ever
// supported guest post + admin hide/unhide. This adds read + a reply,
// scoped to the vendor's own centres/clubs (game/host reviews have no
// vendor to reply, so they're excluded from this list entirely).

vendorOperationsRouter.get("/reviews", async (req, res) => {
  const ids = req.vendorIds!;
  const rows = await db
    .prepare(
      `SELECT r.id, r.listing_type as listingType, r.listing_id as listingId, r.name, r.rating, r.comment,
              r.created_at as createdAt, r.vendor_reply as vendorReply, r.vendor_reply_at as vendorRepliedAt,
              COALESCE(c.name, cl.name) as listingName
       FROM reviews r
       LEFT JOIN centres c ON r.listing_type = 'centre' AND c.id = r.listing_id
       LEFT JOIN clubs cl ON r.listing_type = 'club' AND cl.id = r.listing_id
       WHERE r.hidden = 0 AND r.listing_type IN ('centre', 'club')
         AND ((r.listing_type = 'centre' AND c.vendor_id IN (${inClause(ids)}))
           OR (r.listing_type = 'club' AND cl.vendor_id IN (${inClause(ids)})))
       ORDER BY r.created_at DESC`
    )
    .all(...ids, ...ids);
  res.json(rows);
});

vendorOperationsRouter.post("/reviews/:id/reply", requirePlatformRole("communications"), async (req, res) => {
  const { reply } = req.body as { reply?: string };
  if (!reply || !reply.trim()) return res.status(400).json({ error: "Reply text is required" });
  const ids = req.vendorIds!;
  const row = (await db
    .prepare(
      `SELECT r.id, r.listing_type as listingType, r.listing_id as listingId
       FROM reviews r
       LEFT JOIN centres c ON r.listing_type = 'centre' AND c.id = r.listing_id
       LEFT JOIN clubs cl ON r.listing_type = 'club' AND cl.id = r.listing_id
       WHERE r.id = ? AND ((r.listing_type = 'centre' AND c.vendor_id IN (${inClause(ids)}))
                         OR (r.listing_type = 'club' AND cl.vendor_id IN (${inClause(ids)})))`
    )
    .get(req.params.id, ...ids, ...ids)) as { id: number; listingType: string; listingId: string } | undefined;
  if (!row) return res.status(404).json({ error: "Review not found" });

  await db.prepare(`UPDATE reviews SET vendor_reply = ?, vendor_reply_at = NOW() WHERE id = ?`).run(reply.trim(), row.id);
  res.json({ ok: true });
});

// --- vendor-scoped Offers (Host Manage spec §17) ---------------------------
// Coupons were previously admin/platform-wide only (routes/admin.ts). These
// let a vendor create their own, optionally restricted to one of their own
// listings (`evaluateCoupon` in pricing.ts enforces that restriction at
// checkout) — every existing admin coupon has created_by_vendor_id NULL and
// is untouched by anything here.

interface VendorCouponInput {
  code: string;
  kind: "percent" | "fixed";
  amount: number;
  maxUses?: number;
  expiresAt?: string;
  eligibleListingType?: "centre" | "club";
  eligibleListingId?: string;
}

vendorOperationsRouter.get("/coupons", async (req, res) => {
  const ids = req.vendorIds!;
  const rows = await db
    .prepare(
      `SELECT id, code, kind, amount, max_uses as maxUses, used_count as usedCount, expires_at as expiresAt, active,
              eligible_listing_type as eligibleListingType, eligible_listing_id as eligibleListingId
       FROM coupons WHERE created_by_vendor_id IN (${inClause(ids)}) ORDER BY created_at DESC`
    )
    .all(...ids);
  res.json(rows);
});

vendorOperationsRouter.post("/coupons", requirePlatformRole("finance"), async (req, res) => {
  const b = req.body as VendorCouponInput;
  if (!b.code?.trim() || !b.kind || !b.amount) return res.status(400).json({ error: "code, kind and amount are required" });
  // Must be both-or-neither: evaluateCoupon() in pricing.ts only checks
  // eligible_listing_type/id when eligible_listing_id is actually set, so a
  // row with a type but no id would skip that check entirely and become
  // redeemable against any centre/club platform-wide, not just this
  // vendor's own — the client always sends both together, but nothing
  // stopped a direct API call from sending just one (same class of gap
  // fixed on the Host-coupon routes in games.ts).
  if (!!b.eligibleListingType !== !!b.eligibleListingId) {
    return res.status(400).json({ error: "eligibleListingType and eligibleListingId must be provided together" });
  }
  if (b.eligibleListingId) {
    const owns = b.eligibleListingType === "centre" ? await ownsCentre(req.vendorIds!, b.eligibleListingId) : await ownsClub(req.vendorIds!, b.eligibleListingId);
    if (!owns) return res.status(403).json({ error: "Not your listing" });
  }
  try {
    await db
      .prepare(
        `INSERT INTO coupons (code, kind, amount, max_uses, expires_at, created_by_vendor_id, eligible_listing_type, eligible_listing_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(b.code.trim().toUpperCase(), b.kind, b.amount, b.maxUses ?? null, b.expiresAt ?? null, req.user!.id, b.eligibleListingType ?? null, b.eligibleListingId ?? null);
    res.status(201).json({ ok: true });
  } catch (e) {
    res.status(409).json({ error: e instanceof Error && e.message.includes("Duplicate") ? "That code is already in use" : "Couldn't create the coupon" });
  }
});

vendorOperationsRouter.put("/coupons/:id/active", requirePlatformRole("finance"), async (req, res) => {
  const { active } = req.body as { active?: boolean };
  const ids = req.vendorIds!;
  const info = await db
    .prepare(`UPDATE coupons SET active = ? WHERE id = ? AND created_by_vendor_id IN (${inClause(ids)})`)
    .run(active ? 1 : 0, req.params.id, ...ids);
  if (info.changes === 0) return res.status(404).json({ error: "Coupon not found" });
  res.json({ ok: true });
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
  // Cancellation has no dedicated timestamp column on bookings/registrations
  // themselves (only a current-state `status` flag) — the vendor cancel
  // routes above already write a real one to audit_log, so source it from
  // there rather than fabricating a time the row itself doesn't store.
  const cancelRow = await db
    .prepare(`SELECT created_at as cancelledAt FROM audit_log WHERE object_type = ? AND object_id = ? AND action = ? ORDER BY created_at DESC LIMIT 1`)
    .get(kind, ref, `${kind}.cancelled_by_vendor`);
  res.json({
    checkedIn: !!row,
    checkedInAt: (row as { checkedInAt: string } | undefined)?.checkedInAt ?? null,
    cancelledAt: (cancelRow as { cancelledAt: string } | undefined)?.cancelledAt ?? null,
  });
});
