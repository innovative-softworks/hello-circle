import { heldRefsFor, shortenReviewHolds } from "../payments/paymentReview.js";
import { assertCapability } from "../capabilities.js";
import { flagReviewsAfterAttendanceChange, isAbsence } from "../reviewAttendanceFlags.js";
import { cancelProgramEnrollmentAsProvider } from "../hallBookingCancel.js";
import { assertCreatorStillMember } from "../orgStatus.js";
import crypto from "node:crypto";
import { logEvent } from "../analytics.js";
import { matchProgramSupply } from "../participationIntents.js";
import { Router } from "express";
import { assertPlatformRole, requirePlatformRole } from "../auth.js";
import { writeAudit } from "../audit.js";
import { refundPaidOnce } from "../checkoutService.js";
import { db } from "../db/index.js";
import { notifyRefund, notifyResident } from "../notifications.js";
import { irelandTodayIso } from "../irelandTime.js";
import { ROSTER_ROLES, inClause, ownsListing } from "./vendorHelpers.js";
import { notifyCentreFollowers, notifyVendorFollowers } from "./follows.js";
import { toProgramJson, type ProgramRow } from "./programs.js";
import { noticeListingCancelled } from "../circlePlanNotices.js";

// Programs, sessions, attendance (Phase B) — split out of the original
// single vendor.ts (see CLAUDE.md). See server/src/db/index.ts's
// programs/program_sessions/program_enrollments comments for the model.
// Deliberately independent of centre-hire and club-registration — this is
// new activity types only, not a migration. Mounted under vendorRouter in
// vendor.ts, which applies requireVendor/attachVendorIds first.

export const vendorProgramsRouter = Router();

interface ProgramInput {
  listingType: "centre" | "club";
  listingId: string;
  title: string;
  description: string;
  ageRange?: string;
  imageUrl?: string;
  priceCents?: number;
  capacity?: number | null;
  category?: string;
  skillLevel?: string;
  equipment?: string[];
  instructorName?: string;
  guardianRules?: string;
  safeguardingInfo?: string;
}

const PROGRAM_STATUSES = ["draft", "published", "paused", "archived"];
const ATTENDANCE_STATUSES = ["present", "absent", "late", "cancelled", "no_show"];

vendorProgramsRouter.get("/programs", async (req, res) => {
  const ids = req.vendorIds!;
  const rows = await db
    .prepare(
      `SELECT id, listing_type as listingType, listing_id as listingId, title, status, price_cents as priceCents, capacity, created_at as createdAt
       FROM programs WHERE vendor_id IN (${inClause(ids)}) ORDER BY created_at DESC`
    )
    .all(...ids);
  res.json(rows);
});

vendorProgramsRouter.post("/programs", async (req, res) => {
  const b = req.body as ProgramInput;
  if (!b.listingType || !b.listingId || !b.title || !b.description) return res.status(400).json({ error: "Missing required fields" });
  if (!(await ownsListing(req.vendorIds!, b.listingType, b.listingId))) return res.status(403).json({ error: "Not your listing" });
  // A program's role requirement follows the listing it's attached to — a
  // centre-side program needs centre_manager, a club-side one facility_manager
  // — same split as the direct centres/clubs endpoints in vendorListings.ts.
  if (!assertPlatformRole(req, res, b.listingType === "centre" ? "centre_manager" : "facility_manager")) return;
  // Feature flags (implementation backlog #5) — admin can disable Programs
  // for an org; server-enforced, not just a hidden button client-side.
  // Configuration framework Phase B: the same opt-out flag, now through the capability registry.
  if (!(await assertCapability(req, res, "programs"))) return;

  const id = crypto.randomUUID();
  await db.transaction(async (tx) => {
    // D-08: refuse if the creator was removed from the organisation meanwhile.
    await assertCreatorStillMember(tx, req.user!);
    await tx
    .prepare(
      `INSERT INTO programs (id, listing_type, listing_id, vendor_id, title, description, age_range, image_url, price_cents, capacity, status, category, skill_level, equipment, instructor_name, guardian_rules, safeguarding_info)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      b.listingType,
      b.listingId,
      req.user!.id,
      b.title,
      b.description,
      b.ageRange ?? "",
      b.imageUrl ?? "",
      b.priceCents ?? 0,
      b.capacity ?? null,
      b.category ?? "",
      b.skillLevel ?? "",
      (b.equipment ?? []).join(","),
      b.instructorName ?? "",
      b.guardianRules ?? "",
      b.safeguardingInfo ?? ""
    );
  });
const fromDemand = (req.body as { fromDemand?: string }).fromDemand;
  if (fromDemand) void logEvent("host_created_from_demand", { metadata: { kind: "program", id, clusterKey: fromDemand, userId: req.user!.id } });
    res.status(201).json({ id });
});

/** Ownership + which role a mutation on this program needs, in one lookup —
 * a program's role requirement depends on its listing_type, which isn't
 * known from the URL, so callers that need to gate a write check
 * `requiredRole` after this resolves; read-only call sites just use `owns`. */
async function programOwnership(vendorIds: string[], programId: string): Promise<{ owns: boolean; requiredRole: "centre_manager" | "facility_manager" | null }> {
  const row = (await db.prepare(`SELECT vendor_id, listing_type as listingType FROM programs WHERE id = ?`).get(programId)) as
    | { vendor_id: string; listingType: "centre" | "club" }
    | undefined;
  if (!row) return { owns: false, requiredRole: null };
  return { owns: vendorIds.includes(row.vendor_id), requiredRole: row.listingType === "centre" ? "centre_manager" : "facility_manager" };
}

// Vendor-scoped single-program fetch — unlike GET /programs/:id (public,
// published-only), this returns a program in any status so a vendor can
// open their own draft/paused/archived program's manage view right after
// creating it, before they've published it.
vendorProgramsRouter.get("/programs/:id", async (req, res) => {
  const { owns } = await programOwnership(req.vendorIds!, req.params.id);
  if (!owns) return res.status(403).json({ error: "Not your program" });
  const row = (await db.prepare(`SELECT * FROM programs WHERE id = ?`).get(req.params.id)) as ProgramRow;
  res.json(await toProgramJson(row));
});

vendorProgramsRouter.put("/programs/:id", async (req, res) => {
  const { owns, requiredRole } = await programOwnership(req.vendorIds!, req.params.id);
  if (!owns) return res.status(403).json({ error: "Not your program" });
  if (!assertPlatformRole(req, res, requiredRole!)) return;
  const b = req.body as Partial<ProgramInput> & { status?: string };
  if (b.status !== undefined && !PROGRAM_STATUSES.includes(b.status)) {
    return res.status(400).json({ error: `status must be one of: ${PROGRAM_STATUSES.join(", ")}` });
  }
  const before = (await db.prepare(`SELECT status FROM programs WHERE id = ?`).get(req.params.id)) as { status: string } | undefined;
  await db
    .prepare(
      `UPDATE programs SET title = COALESCE(?, title), description = COALESCE(?, description), age_range = COALESCE(?, age_range),
       image_url = COALESCE(?, image_url), price_cents = COALESCE(?, price_cents), status = COALESCE(?, status),
       category = COALESCE(?, category), skill_level = COALESCE(?, skill_level), equipment = COALESCE(?, equipment),
       instructor_name = COALESCE(?, instructor_name), guardian_rules = COALESCE(?, guardian_rules),
       safeguarding_info = COALESCE(?, safeguarding_info),
       capacity = CASE WHEN ? THEN capacity ELSE ? END
       WHERE id = ?`
    )
    .run(
      b.title,
      b.description,
      b.ageRange,
      b.imageUrl,
      b.priceCents,
      b.status,
      b.category,
      b.skillLevel,
      b.equipment ? b.equipment.join(",") : undefined,
      b.instructorName,
      b.guardianRules,
      b.safeguardingInfo,
      b.capacity === undefined ? 1 : 0,
      b.capacity === undefined ? null : b.capacity,
      req.params.id
    );
  // Release 6 — newly published supply closes the demand loop.
  if (b.status === "published" && before?.status !== "published") await matchProgramSupply(req.params.id);
  res.json({ ok: true });
});

vendorProgramsRouter.delete("/programs/:id", async (req, res) => {
  const { owns, requiredRole } = await programOwnership(req.vendorIds!, req.params.id);
  if (!owns) return res.status(403).json({ error: "Not your program" });
  if (!assertPlatformRole(req, res, requiredRole!)) return;
  const archived = await db.prepare(`UPDATE programs SET status = 'archived' WHERE id = ? AND status != 'archived'`).run(req.params.id);
  if (archived.changes === 1) {
    const p = (await db.prepare(`SELECT title FROM programs WHERE id = ?`).get(req.params.id)) as { title: string } | undefined;
    await noticeListingCancelled("program", req.params.id, { title: p?.title ?? "A programme", what: "this programme" });
  }
  res.json({ ok: true });
});

vendorProgramsRouter.post("/programs/:id/sessions", async (req, res) => {
  const { owns, requiredRole } = await programOwnership(req.vendorIds!, req.params.id);
  if (!owns) return res.status(403).json({ error: "Not your program" });
  if (!assertPlatformRole(req, res, requiredRole!)) return;
  const { date, time, durationMinutes, capacity, instructorName, roomId } = req.body as {
    date?: string;
    time?: string;
    durationMinutes?: number;
    capacity?: number;
    instructorName?: string;
    roomId?: string;
  };
  if (!date || !time) return res.status(400).json({ error: "date and time are required" });
  if (roomId) {
    const program = (await db.prepare(`SELECT listing_type as listingType, listing_id as listingId FROM programs WHERE id = ?`).get(req.params.id)) as
      | { listingType: "centre" | "club"; listingId: string }
      | undefined;
    if (program?.listingType !== "centre") return res.status(400).json({ error: "Only centre-attached programs can assign a room" });
    const room = (await db.prepare(`SELECT id FROM rooms WHERE id = ? AND centre_id = ?`).get(roomId, program.listingId)) as { id: string } | undefined;
    if (!room) return res.status(400).json({ error: "That room doesn't belong to this program's centre" });
  }
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO program_sessions (id, program_id, date, time, duration_minutes, capacity, instructor_name, room_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, req.params.id, date, time, durationMinutes ?? 60, capacity ?? null, instructorName ?? "", roomId ?? null);
  // D-10 — an earlier first session can only shorten a payment-review hold, never extend it.
  await shortenReviewHolds("program", await heldRefsFor("program", req.params.id));

  // Follow feature — same "everything"-only gating as experiences' own new-
  // session notify (a new session on an existing listing, not a new listing
  // going live).
  const program = (await db.prepare(`SELECT vendor_id as vendorId, title, listing_type as listingType, listing_id as listingId FROM programs WHERE id = ?`).get(req.params.id)) as
    | { vendorId: string | null; title: string; listingType: "centre" | "club"; listingId: string }
    | undefined;
  if (program?.vendorId) {
    await notifyVendorFollowers(program.vendorId, { title: "New session added", body: `A new session was added for ${program.title} on ${date}.`, ref: id }, "everything");
  }
  if (program?.listingType === "centre") {
    await notifyCentreFollowers(program.listingId, { title: "New session added", body: `A new session was added for ${program.title} on ${date}.`, ref: id });
  }

  res.status(201).json({ id });
});

vendorProgramsRouter.delete("/programs/:programId/sessions/:sessionId", async (req, res) => {
  const { owns, requiredRole } = await programOwnership(req.vendorIds!, req.params.programId);
  if (!owns) return res.status(403).json({ error: "Not your program" });
  if (!assertPlatformRole(req, res, requiredRole!)) return;
  // Phase 12 (Part 11) — conditional transition: only the request that
  // actually cancels the session notifies; a retry/repeat is a silent no-op.
  const result = await db
    .prepare(`UPDATE program_sessions SET status = 'cancelled' WHERE id = ? AND program_id = ? AND status != 'cancelled'`)
    .run(req.params.sessionId, req.params.programId);
  if (result.changes === 1) {
    await notifySessionCancelled(req.params.programId, req.params.sessionId);
    // Circles 3.0 — only plans for this session (whole-programme plans still stand).
    const p = (await db.prepare(`SELECT title FROM programs WHERE id = ?`).get(req.params.programId)) as { title: string } | undefined;
    await noticeListingCancelled("program", req.params.programId, { sessionId: req.params.sessionId, title: p?.title ?? "A programme session", what: "this session" });
  }
  res.json({ ok: true });
});

/** In-app notice to residents with a live (paid, not cancelled) enrolment in
 * the programme, for an upcoming session only. Names the programme and the
 * date; nothing about other participants. Guests without a resident account
 * have no in-app inbox (email isn't part of this flow — out of scope). */
async function notifySessionCancelled(programId: string, sessionId: string) {
  const session = (await db
    .prepare(`SELECT ps.date, ps.time, p.title FROM program_sessions ps JOIN programs p ON p.id = ps.program_id WHERE ps.id = ? AND ps.program_id = ?`)
    .get(sessionId, programId)) as { date: string; time: string | null; title: string } | undefined;
  if (!session || session.date < irelandTodayIso()) return;
  const residents = (await db
    .prepare(`SELECT DISTINCT resident_id as residentId FROM program_enrollments WHERE program_id = ? AND resident_id IS NOT NULL AND status != 'cancelled' AND payment_status = 'paid'`)
    .all(programId)) as { residentId: string }[];
  for (const r of residents) {
    await notifyResident({
      residentId: r.residentId,
      kind: "program",
      title: `Session cancelled: ${session.title}`,
      body: `The ${session.title} session on ${session.date}${session.time ? ` at ${session.time}` : ""} has been cancelled. Your enrolment for the other sessions is unchanged.`,
      listingType: "program",
      listingId: programId,
      ref: sessionId,
    }).catch((e) => console.error("[notifications] programme session cancellation notify failed:", e));
  }
}

vendorProgramsRouter.get("/programs/:id/enrollments", requirePlatformRole(...ROSTER_ROLES), async (req, res) => {
  const { owns } = await programOwnership(req.vendorIds!, req.params.id);
  if (!owns) return res.status(403).json({ error: "Not your program" });
  const rows = (await db
    .prepare(
      `SELECT id, ref, participant_name as participantName, participant_dob as participantDob, email, phone, total_cents as totalCents, created_at as createdAt, status
       FROM program_enrollments WHERE program_id = ? AND payment_status = 'paid' ORDER BY created_at DESC`
    )
    .all(req.params.id)) as { id: number; status: string }[];
  // Phase O2 — each person's progress from the register: sessions so far,
  // attended, missed, not recorded; and whether the programme has finished
  // (all sessions past). No attendance threshold for "completed" is invented.
  const today = irelandTodayIso();
  const sessions = (await db.prepare(`SELECT id, date FROM program_sessions WHERE program_id = ? AND status <> 'cancelled'`).all(req.params.id)) as { id: string; date: string }[];
  const past = new Set(sessions.filter((x) => x.date < today).map((x) => x.id));
  const marks = (await db
    .prepare(`SELECT a.ref, a.status FROM attendance a JOIN program_sessions ps ON a.ref LIKE CONCAT(ps.id, ':%') WHERE a.kind = 'program_session' AND ps.program_id = ?`)
    .all(req.params.id)) as { ref: string; status: string }[];
  const byEnrolment = new Map<number, { attended: number; missed: number }>();
  for (const m of marks) {
    const [sessionId, enrolmentId] = m.ref.split(":");
    if (!past.has(sessionId)) continue;
    const e = byEnrolment.get(Number(enrolmentId)) ?? { attended: 0, missed: 0 };
    if (m.status === "present" || m.status === "late") e.attended++;
    else if (m.status === "absent" || m.status === "no_show") e.missed++;
    byEnrolment.set(Number(enrolmentId), e);
  }
  const finished = sessions.length > 0 && past.size === sessions.length;
  res.json(
    rows.map((r) => {
      const p = byEnrolment.get(Number(r.id)) ?? { attended: 0, missed: 0 };
      return { ...r, progress: { sessionsTotal: sessions.length, sessionsSoFar: past.size, attended: p.attended, missed: p.missed, notRecorded: Math.max(0, past.size - p.attended - p.missed), finished } };
    })
  );
});

// Per-session attendance (Phase B/Phase 10) — reuses the generic attendance
// table from Tier 3's manual check-in (vendorOperations.ts), keyed by a
// composite ref rather than a new table, since the shape (kind, ref,
// checked_in_at, checked_in_by, status) already fits exactly. `status` is a
// real Present/Absent/Late/Cancelled/No-show value here — distinct from the
// booking/registration check-in flow, which stays a simple binary tap and
// always writes 'present' (see vendorOperations.ts's checkInBooking).
vendorProgramsRouter.post("/program-sessions/:sessionId/attendance/:enrollmentId", async (req, res) => {
  const session = (await db.prepare(`SELECT id, program_id as programId FROM program_sessions WHERE id = ?`).get(req.params.sessionId)) as { id: string; programId: string } | undefined;
  if (!session) return res.status(403).json({ error: "Not your session" });
  const { owns, requiredRole } = await programOwnership(req.vendorIds!, session.programId);
  if (!owns) return res.status(403).json({ error: "Not your session" });
  if (!assertPlatformRole(req, res, requiredRole!)) return;
  const enrollment = await db.prepare(`SELECT id FROM program_enrollments WHERE id = ? AND program_id = ?`).get(req.params.enrollmentId, session.programId) as { id: number } | undefined;
  if (!enrollment) return res.status(404).json({ error: "Enrollment not found" });
  const status = typeof req.body?.status === "string" ? req.body.status : "present";
  if (!ATTENDANCE_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${ATTENDANCE_STATUSES.join(", ")}` });
  }
  const ref = `${session.id}:${enrollment.id}`;
  await db
    .prepare(
      `INSERT INTO attendance (kind, ref, checked_in_by, status) VALUES ('program_session', ?, ?, ?)
       ON DUPLICATE KEY UPDATE checked_in_at = NOW(), checked_in_by = VALUES(checked_in_by), status = VALUES(status)`
    )
    .run(ref, req.user!.id, status);
  // Trust & Retention — a no-show after a review was published flags it for moderation (never hides it).
  if (isAbsence(status)) await flagReviewsAfterAttendanceChange("program_session", ref, "the organiser recorded this session as missed", { id: req.user!.id, kind: "user" });
  res.json({ ok: true });
});

// --- enrollment cancel + refund (Phase 0 protect) ---------------------
// Programs previously had no vendor-facing cancel/refund route at all.
// Same shape as vendorOperations.ts's booking/registration cancel+refund —
// status-only cancel (no Stripe call), finance-gated Stripe refund — but
// role-gated by this program's own listing_type via programOwnership()
// (centre_manager or facility_manager) for cancel, same as every other
// program mutation in this file, and the refund route is built with the
// payment_status='paid' idempotency guard from day one (vendorOperations.ts's
// booking/registration refund routes originally shipped without it — see
// that file's Phase 0 fix).

vendorProgramsRouter.post("/programs/:programId/enrollments/:enrollmentId/cancel", async (req, res) => {
  const { owns, requiredRole } = await programOwnership(req.vendorIds!, req.params.programId);
  if (!owns) return res.status(403).json({ error: "Not your program" });
  if (!assertPlatformRole(req, res, requiredRole!)) return;
  const found = (await db.prepare(`SELECT ref FROM program_enrollments WHERE id = ? AND program_id = ?`).get(req.params.enrollmentId, req.params.programId)) as { ref: string } | undefined;
  if (!found) return res.status(404).json({ error: "Enrollment not found" });
  // Shared with HelloCircle admin cancellations (hallBookingCancel.ts).
  const result = await cancelProgramEnrollmentAsProvider({ ref: found.ref, actorUserId: req.user!.id, vendorIds: req.vendorIds!, action: "program_enrollment.cancelled_by_vendor" });
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  res.json({ ok: true, refund: result.refund, ...(result.refundError ? { refundError: result.refundError } : {}) });
});

vendorProgramsRouter.post("/programs/:programId/enrollments/:enrollmentId/refund", async (req, res) => {
  const { owns } = await programOwnership(req.vendorIds!, req.params.programId);
  if (!owns) return res.status(403).json({ error: "Not your program" });
  if (!assertPlatformRole(req, res, "finance")) return;

  const row = (await db
    .prepare(
      `SELECT pe.ref, pe.payment_status as paymentStatus, pe.stripe_session_id as stripeSessionId, pe.participant_name as participantName, pe.email, pe.resident_id as residentId,
              p.title, p.listing_type as listingType, p.listing_id as listingId, p.vendor_id as vendorId
       FROM program_enrollments pe JOIN programs p ON p.id = pe.program_id
       WHERE pe.id = ? AND pe.program_id = ?`
    )
    .get(req.params.enrollmentId, req.params.programId)) as
    | { ref: string; paymentStatus: string; stripeSessionId: string | null; participantName: string; email: string; residentId: string | null; title: string; listingType: "centre" | "club"; listingId: string; vendorId: string }
    | undefined;
  if (!row) return res.status(404).json({ error: "Enrollment not found" });
  if (row.paymentStatus === "refunded") return res.status(409).json({ error: "This enrollment has already been refunded" });
  if (row.paymentStatus !== "paid") return res.status(400).json({ error: "Only a paid enrollment can be refunded" });
  if (!row.stripeSessionId) return res.status(400).json({ error: "This was a cash enrollment — refund the participant directly, not through Stripe" });

  // HC-QA-051 — lock, re-check, refund and mark refunded in one transaction;
  // concurrent requests get 409 instead of each calling the provider.
  const result = await refundPaidOnce("program_enrollments", "ref = ?", [row.ref], row.stripeSessionId, "This enrollment has already been refunded", { actorUserId: req.user!.id, objectType: "program_enrollment", objectId: row.ref });
  if (!result.ok) return res.status(result.status).json({ error: result.error });

  await writeAudit({
    actorUserId: req.user!.id,
    action: result.reconciled ? "program_enrollment.refund_reconciled_external" : "program_enrollment.refunded_by_vendor",
    objectType: "program_enrollment",
    objectId: row.ref,
    previousValue: { paymentStatus: row.paymentStatus },
    newValue: { paymentStatus: "refunded", amountCents: result.amountCents, source: result.reconciled ? "stripe_external" : "hellocircle" },
  });

  notifyRefund({
    kind: "program",
    listingType: row.listingType,
    listingId: row.listingId,
    listingName: row.title,
    vendorId: row.vendorId,
    guestName: row.participantName,
    guestEmail: row.email,
    ref: row.ref,
    detailsText: row.title,
    refundedCents: result.amountCents,
    residentId: row.residentId,
  }).catch((e) => console.error("[notifications] program enrollment refund notify failed:", e));

  res.json({ ok: true });
});

vendorProgramsRouter.get("/programs/:id/sessions/:sessionId/attendance", async (req, res) => {
  const { owns } = await programOwnership(req.vendorIds!, req.params.id);
  if (!owns) return res.status(403).json({ error: "Not your program" });
  const session = await db.prepare(`SELECT id FROM program_sessions WHERE id = ? AND program_id = ?`).get(req.params.sessionId, req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  const rows = (await db
    .prepare(`SELECT a.ref, a.status FROM program_sessions ps
              JOIN program_enrollments pe ON pe.program_id = ps.program_id
              JOIN attendance a ON a.kind = 'program_session' AND a.ref = CONCAT(ps.id, ':', pe.id)
              WHERE ps.id = ? AND ps.program_id = ?`)
    .all(req.params.sessionId, req.params.id)) as { ref: string; status: string }[];
  res.json(rows.map((r) => ({ enrollmentId: r.ref.split(":")[1], status: r.status })));
});
