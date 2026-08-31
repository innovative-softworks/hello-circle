import { Router } from "express";
import { createCheckoutSession, pricingLineItems } from "../checkoutService.js";
import { db } from "../db/index.js";
import { notifyNewBookingOrRegistration } from "../notifications.js";
import { computePricing } from "../pricing.js";
import { BadRequestError, clientIdFrom, generateRef, isValidEmail } from "../util.js";

export const programsRouter = Router();

// Programs (Phase B — Gate 1 from the plan doc). A generalised multi-session
// activity — deliberately NOT a migration of centre-hire or club-registration,
// which keep working exactly as they do today. See server/src/db/index.ts's
// programs/program_sessions/program_enrollments comments for the full
// rationale.

export interface ProgramRow {
  id: string;
  listing_type: "centre" | "club";
  listing_id: string;
  vendor_id: string;
  title: string;
  description: string;
  age_range: string;
  image_url: string;
  price_cents: number;
  capacity: number | null;
  status: string;
  created_at: string;
  category: string;
  skill_level: string;
  equipment: string | null;
  instructor_name: string;
  guardian_rules: string | null;
  safeguarding_info: string | null;
}

export async function toProgramJson(row: ProgramRow) {
  // rooms.id is only unique per-centre (PRIMARY KEY (centre_id, id)) — a
  // room_id-only join can match another centre's room that happens to
  // share the same id. A program session's room only ever belongs to its
  // own centre-attached program (vendorPrograms.ts rejects a roomId on a
  // club-attached one), so scope by row.listing_id when applicable; ''
  // never matches a real centre_id, so a club-attached program's (always
  // room_id-less) sessions are unaffected.
  const sessions = await db
    .prepare(
      `SELECT ps.id, ps.date, ps.time, ps.duration_minutes as durationMinutes, ps.capacity, ps.status,
              ps.instructor_name as instructorName, ps.room_id as roomId, r.name as roomName
       FROM program_sessions ps LEFT JOIN rooms r ON r.id = ps.room_id AND r.centre_id = ?
       WHERE ps.program_id = ? AND ps.status != 'cancelled' ORDER BY ps.date, ps.time`
    )
    .all(row.listing_type === "centre" ? row.listing_id : "", row.id);
  const { n: enrolled } = (await db
    .prepare(`SELECT COUNT(*) as n FROM program_enrollments WHERE program_id = ? AND payment_status = 'paid' AND status != 'cancelled'`)
    .get(row.id)) as { n: number };
  const listingTable = row.listing_type === "centre" ? "centres" : "clubs";
  const listing = (await db.prepare(`SELECT name FROM ${listingTable} WHERE id = ?`).get(row.listing_id)) as { name: string } | undefined;
  return {
    id: row.id,
    listingType: row.listing_type,
    listingId: row.listing_id,
    listingName: listing?.name ?? "",
    title: row.title,
    description: row.description,
    ageRange: row.age_range,
    imageUrl: row.image_url,
    priceCents: row.price_cents,
    capacity: row.capacity,
    enrolled,
    spotsLeft: row.capacity !== null ? Math.max(0, row.capacity - enrolled) : null,
    status: row.status,
    sessions,
    createdAt: row.created_at,
    category: row.category,
    skillLevel: row.skill_level,
    equipment: row.equipment ? row.equipment.split(",").filter(Boolean) : [],
    instructorName: row.instructor_name,
    /** Community program detail (IA spec §5) — both optional, vendor-set. */
    guardianRules: row.guardian_rules ?? "",
    safeguardingInfo: row.safeguarding_info ?? "",
  };
}

programsRouter.get("/", async (req, res) => {
  const { listingType, listingId } = req.query as { listingType?: string; listingId?: string };
  if (!listingType || !listingId) return res.status(400).json({ error: "listingType and listingId are required" });
  const rows = (await db
    .prepare(`SELECT * FROM programs WHERE listing_type = ? AND listing_id = ? AND status = 'published' ORDER BY created_at DESC`)
    .all(listingType, listingId)) as ProgramRow[];
  res.json(await Promise.all(rows.map(toProgramJson)));
});

// Same "approved/published only" contract as getApprovedCentre/getApprovedClub
// in db/queries.ts — a draft/paused/archived program has no public detail
// page, matching the list endpoint above. Vendors see every status of their
// own programs via GET /vendor/programs instead, so nothing legitimate reads
// a non-published program through this route.
programsRouter.get("/:id", async (req, res) => {
  const row = (await db.prepare(`SELECT * FROM programs WHERE id = ? AND status = 'published'`).get(req.params.id)) as ProgramRow | undefined;
  if (!row) return res.status(404).json({ error: "Program not found" });
  res.json(await toProgramJson(row));
});

interface EnrollBody {
  participantName: string;
  participantDob?: string;
  email: string;
  phone?: string;
  couponCode?: string;
}

// One enrollment covers every session of the program (matches "8-week
// program, one sign-up"). Row-locked the same way bookings.ts locks a room,
// so two enrollments can't both take the program's last spot.
programsRouter.post("/:id/enroll", async (req, res) => {
  let clientId: string;
  try {
    clientId = clientIdFrom(req);
  } catch (e) {
    if (e instanceof BadRequestError) return res.status(400).json({ error: e.message });
    throw e;
  }
  const body = req.body as EnrollBody;
  if (!body.participantName || !body.email) return res.status(400).json({ error: "Participant name and email are required" });
  if (!isValidEmail(body.email)) return res.status(400).json({ error: "That doesn't look like a valid email address" });

  const program = (await db.prepare(`SELECT * FROM programs WHERE id = ?`).get(req.params.id)) as ProgramRow | undefined;
  if (!program) return res.status(404).json({ error: "Program not found" });
  if (program.status !== "published") return res.status(409).json({ error: "This program is no longer open for enrollment" });

  const ref = generateRef("PR");
  const pricing = computePricing(program.price_cents, 0, 0, null);
  const isFree = pricing.totalCents === 0;

  try {
    await db.transaction(async (tx) => {
      await tx.prepare(`SELECT id FROM programs WHERE id = ? FOR UPDATE`).get(program.id);
      if (program.capacity !== null) {
        const { n: enrolled } = (await tx
          .prepare(`SELECT COUNT(*) as n FROM program_enrollments WHERE program_id = ? AND payment_status = 'paid' AND status != 'cancelled'`)
          .get(program.id)) as { n: number };
        if (enrolled >= program.capacity) throw new Error("PROGRAM_FULL");
      }
      await tx
        .prepare(
          `INSERT INTO program_enrollments (ref, program_id, resident_id, client_id, participant_name, participant_dob, email, phone, total_cents, payment_status, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed')`
        )
        .run(ref, program.id, req.resident?.id ?? null, clientId, body.participantName, body.participantDob ?? "", body.email, body.phone ?? "", pricing.totalCents, isFree ? "paid" : "pending");
    });
  } catch (e) {
    if (e instanceof Error && e.message === "PROGRAM_FULL") return res.status(409).json({ error: "This program is full" });
    throw e;
  }

  const notify = () =>
    notifyNewBookingOrRegistration({
      kind: "registration",
      listingType: program.listing_type,
      listingId: program.listing_id,
      listingName: program.title,
      vendorId: program.vendor_id,
      guestName: body.participantName,
      guestEmail: body.email,
      ref,
      detailsText: `${body.participantName} enrolled in ${program.title} · €${(pricing.totalCents / 100).toFixed(2)}${isFree ? " (free)" : " total"}`,
    }).catch((e) => console.error("[notifications] program enrollment notify failed:", e));

  if (isFree) {
    notify();
    return res.status(201).json({ ref, totalEuro: 0 });
  }

  const result = await createCheckoutSession({
    ref,
    type: "program",
    customerEmail: body.email,
    residentId: req.resident?.id ?? null,
    lineItems: pricingLineItems(pricing, { name: program.title, description: body.participantName }),
  });
  if (!result.ok) {
    await db.prepare(`DELETE FROM program_enrollments WHERE ref = ?`).run(ref);
    return res.status(result.status).json({ error: result.error });
  }

  await db.prepare(`UPDATE program_enrollments SET stripe_session_id = ? WHERE ref = ?`).run(result.session.id, ref);
  res.status(201).json({ ref, url: result.session.url, totalEuro: pricing.totalCents / 100 });
});

// Every program enrollment under this device's client_id or (if signed in)
// this resident's email — same OR-matched ownership pattern as GET /
// on bookings.ts/registrations.ts, since program_enrollments supports pure
// guest checkout the same way those do.
programsRouter.get("/enrollments/mine", async (req, res) => {
  let clientId: string;
  try {
    clientId = clientIdFrom(req);
  } catch (e) {
    if (e instanceof BadRequestError) return res.status(400).json({ error: e.message });
    throw e;
  }
  const rows = await db
    .prepare(
      `SELECT pe.ref, pe.program_id as programId, pe.participant_name as participantName, pe.total_cents as totalCents,
              pe.status, pe.payment_status as paymentStatus, pe.created_at as createdAt,
              p.title, p.image_url as imageUrl, p.listing_type as listingType,
              COALESCE(c.name, cl.name) as listingName
       FROM program_enrollments pe
       JOIN programs p ON p.id = pe.program_id
       LEFT JOIN centres c ON p.listing_type = 'centre' AND c.id = p.listing_id
       LEFT JOIN clubs cl ON p.listing_type = 'club' AND cl.id = p.listing_id
       WHERE (pe.client_id = ? OR (pe.resident_id IS NOT NULL AND pe.resident_id = ?)) AND pe.payment_status = 'paid'
       ORDER BY pe.created_at DESC`
    )
    .all(clientId, req.resident?.id ?? "");
  res.json(rows);
});

programsRouter.get("/enrollments/status/:ref", async (req, res) => {
  let clientId: string;
  try {
    clientId = clientIdFrom(req);
  } catch (e) {
    if (e instanceof BadRequestError) return res.status(400).json({ error: e.message });
    throw e;
  }
  const row = await db
    .prepare(`SELECT ref, payment_status as paymentStatus, total_cents as totalCents FROM program_enrollments WHERE ref = ? AND client_id = ?`)
    .get(req.params.ref, clientId);
  if (!row) return res.status(404).json({ error: "Enrollment not found" });
  res.json(row);
});
