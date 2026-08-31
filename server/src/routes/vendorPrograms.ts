import crypto from "node:crypto";
import { Router } from "express";
import { assertPlatformRole } from "../auth.js";
import { db } from "../db/index.js";
import { orgFeatureFlags } from "../db/queries.js";
import { inClause, ownsListing } from "./vendorHelpers.js";
import { notifyCentreFollowers, notifyVendorFollowers } from "./follows.js";
import { toProgramJson, type ProgramRow } from "./programs.js";

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
  if (!(await orgFeatureFlags(req.user!.id)).programs) {
    return res.status(403).json({ error: "Programs aren't enabled for your organisation" });
  }

  const id = crypto.randomUUID();
  await db
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
  res.json({ ok: true });
});

vendorProgramsRouter.delete("/programs/:id", async (req, res) => {
  const { owns, requiredRole } = await programOwnership(req.vendorIds!, req.params.id);
  if (!owns) return res.status(403).json({ error: "Not your program" });
  if (!assertPlatformRole(req, res, requiredRole!)) return;
  await db.prepare(`UPDATE programs SET status = 'archived' WHERE id = ?`).run(req.params.id);
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
  await db.prepare(`UPDATE program_sessions SET status = 'cancelled' WHERE id = ? AND program_id = ?`).run(req.params.sessionId, req.params.programId);
  res.json({ ok: true });
});

vendorProgramsRouter.get("/programs/:id/enrollments", async (req, res) => {
  const { owns } = await programOwnership(req.vendorIds!, req.params.id);
  if (!owns) return res.status(403).json({ error: "Not your program" });
  const rows = await db
    .prepare(
      `SELECT id, ref, participant_name as participantName, participant_dob as participantDob, email, phone, total_cents as totalCents, created_at as createdAt, status
       FROM program_enrollments WHERE program_id = ? AND payment_status = 'paid' ORDER BY created_at DESC`
    )
    .all(req.params.id);
  res.json(rows);
});

// Per-session attendance (Phase B/Phase 10) — reuses the generic attendance
// table from Tier 3's manual check-in (vendorOperations.ts), keyed by a
// composite ref rather than a new table, since the shape (kind, ref,
// checked_in_at, checked_in_by, status) already fits exactly. `status` is a
// real Present/Absent/Late/Cancelled/No-show value here — distinct from the
// booking/registration check-in flow, which stays a simple binary tap and
// always writes 'present' (see vendorOperations.ts's checkInBooking).
vendorProgramsRouter.post("/program-sessions/:sessionId/attendance/:enrollmentId", async (req, res) => {
  const session = (await db.prepare(`SELECT program_id as programId FROM program_sessions WHERE id = ?`).get(req.params.sessionId)) as { programId: string } | undefined;
  if (!session) return res.status(403).json({ error: "Not your session" });
  const { owns, requiredRole } = await programOwnership(req.vendorIds!, session.programId);
  if (!owns) return res.status(403).json({ error: "Not your session" });
  if (!assertPlatformRole(req, res, requiredRole!)) return;
  const status = typeof req.body?.status === "string" ? req.body.status : "present";
  if (!ATTENDANCE_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${ATTENDANCE_STATUSES.join(", ")}` });
  }
  const ref = `${req.params.sessionId}:${req.params.enrollmentId}`;
  await db
    .prepare(
      `INSERT INTO attendance (kind, ref, checked_in_by, status) VALUES ('program_session', ?, ?, ?)
       ON DUPLICATE KEY UPDATE checked_in_at = NOW(), checked_in_by = VALUES(checked_in_by), status = VALUES(status)`
    )
    .run(ref, req.user!.id, status);
  res.json({ ok: true });
});

vendorProgramsRouter.get("/programs/:id/sessions/:sessionId/attendance", async (req, res) => {
  const { owns } = await programOwnership(req.vendorIds!, req.params.id);
  if (!owns) return res.status(403).json({ error: "Not your program" });
  const rows = (await db
    .prepare(`SELECT ref, status FROM attendance WHERE kind = 'program_session' AND ref LIKE ?`)
    .all(`${req.params.sessionId}:%`)) as { ref: string; status: string }[];
  res.json(rows.map((r) => ({ enrollmentId: r.ref.split(":")[1], status: r.status })));
});
