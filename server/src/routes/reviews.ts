import { Router } from "express";
import { requireAdmin } from "../auth.js";
import { db } from "../db/index.js";
import { getCentre, getClub } from "../db/queries.js";
import { BadRequestError, clientIdFrom } from "../util.js";
import type { Review } from "../types.js";

export const reviewsRouter = Router();

// Host & Activity reviews (master-prompt punch list #3) — extends this
// already-moderated system (rating/comment/admin hide-unhide) to 2 more
// listing types rather than building a parallel one. Centre/club stay
// client-id-eligible (a booking/registration doesn't require an account);
// game/host reviews are necessarily resident-id-eligible instead, since
// joining a Game has always required a signed-in resident (requireResident
// on games.ts's own join route) — see isEligibleToReview()'s branch below.
type ReviewListingType = "centre" | "club" | "game" | "host" | "experience" | "program";

interface ReviewRow {
  id: number;
  listing_type: ReviewListingType;
  listing_id: string;
  name: string;
  rating: number;
  comment: string;
  created_at: string;
  vendor_reply: string | null;
  vendor_reply_at: string | null;
}

function toReview(row: ReviewRow): Review {
  return {
    id: row.id,
    listingType: row.listing_type,
    listingId: row.listing_id,
    name: row.name,
    rating: row.rating,
    comment: row.comment,
    createdAt: row.created_at,
    vendorReply: row.vendor_reply,
    vendorRepliedAt: row.vendor_reply_at,
  };
}

async function listingExists(listingType: string, listingId: string): Promise<boolean> {
  if (listingType === "centre") return !!(await getCentre(listingId));
  if (listingType === "club") return !!(await getClub(listingId));
  if (listingType === "game") return !!(await db.prepare(`SELECT 1 FROM games WHERE id = ?`).get(listingId));
  // Host reviews only ever resolve for a verified host — same gate
  // GET /residents/:id/host-profile already applies.
  if (listingType === "host") return !!(await db.prepare(`SELECT 1 FROM residents WHERE id = ? AND host_status = 'verified'`).get(listingId));
  if (listingType === "experience") return !!(await db.prepare(`SELECT 1 FROM experiences WHERE id = ?`).get(listingId));
  if (listingType === "program") return !!(await db.prepare(`SELECT 1 FROM programs WHERE id = ?`).get(listingId));
  return false;
}

async function isEligibleToReview(clientId: string, residentId: string | null, listingType: string, listingId: string): Promise<boolean> {
  if (listingType === "centre") {
    // Resident Experience Polish — previously any booking row at all made a
    // centre reviewable, including a future-dated, cancelled, or never-paid
    // one. Now matches the same real-past-participation bar game/host/
    // experience already use: paid, not cancelled, and the booked date has
    // actually passed. Cancelling only flips `status` (payment_status stays
    // 'paid' — refunds are handled off-platform, see bookings.ts's cancel
    // route), so both checks are needed, not just payment_status.
    const row = await db
      .prepare(`SELECT 1 FROM bookings WHERE client_id = ? AND centre_id = ? AND payment_status = 'paid' AND status != 'cancelled' AND date < CURDATE() LIMIT 1`)
      .get(clientId, listingId);
    return !!row;
  }
  if (listingType === "club") {
    // A registration has no single dated occurrence to wait out (ongoing
    // membership, not a booked slot — same distinction drawn throughout
    // this codebase, e.g. vendorOperations.ts's /today endpoint), so there's
    // no "date < CURDATE()" equivalent to require here — but paid and not
    // cancelled is still required, closing the same gap centre had.
    const row = await db
      .prepare(`SELECT 1 FROM registrations WHERE client_id = ? AND club_id = ? AND payment_status = 'paid' AND status != 'cancelled' LIMIT 1`)
      .get(clientId, listingId);
    return !!row;
  }
  if (listingType === "game") {
    if (!residentId) return false;
    const row = await db
      .prepare(
        `SELECT 1 FROM game_participants gp JOIN games g ON g.id = gp.game_id
         WHERE gp.resident_id = ? AND gp.game_id = ? AND gp.status = 'joined' AND g.date < CURDATE() LIMIT 1`
      )
      .get(residentId, listingId);
    return !!row;
  }
  if (listingType === "host") {
    if (!residentId) return false;
    // Eligible once this resident has actually joined a past Game hosted
    // by listingId — reviewing "the host," not any one specific game.
    const row = await db
      .prepare(
        `SELECT 1 FROM game_participants gp JOIN games g ON g.id = gp.game_id
         WHERE gp.resident_id = ? AND gp.status = 'joined' AND g.host_resident_id = ? AND g.date < CURDATE() LIMIT 1`
      )
      .get(residentId, listingId);
    return !!row;
  }
  if (listingType === "experience") {
    // client_id-eligible like centre/club, not resident-only like game/host
    // — an Experience booking is the same guest-form-no-account-required
    // shape as a centre booking, not a resident-authenticated Game join.
    const row = await db
      .prepare(
        `SELECT 1 FROM experience_bookings eb JOIN experience_sessions es ON es.id = eb.session_id
         WHERE eb.client_id = ? AND eb.experience_id = ? AND eb.payment_status = 'paid' AND es.date < CURDATE() LIMIT 1`
      )
      .get(clientId, listingId);
    return !!row;
  }
  if (listingType === "program") {
    // Resident Experience Polish — Changeset 3. client_id-eligible like
    // centre/club/experience (program enrollment is guest-form-no-account
    // checkout, same as those). "Meaningful participation" for an ongoing,
    // multi-session enrollment means at least one real session has actually
    // happened yet — not merely enrolled — same bar as hasPastSession on
    // GET /programs/enrollments/mine.
    const row = await db
      .prepare(
        `SELECT 1 FROM program_enrollments pe
         WHERE pe.client_id = ? AND pe.program_id = ? AND pe.payment_status = 'paid' AND pe.status != 'cancelled'
           AND EXISTS (SELECT 1 FROM program_sessions ps WHERE ps.program_id = pe.program_id AND ps.status != 'cancelled' AND ps.date < CURDATE())
         LIMIT 1`
      )
      .get(clientId, listingId);
    return !!row;
  }
  return false;
}

reviewsRouter.get("/", async (req, res) => {
  const { listingType, listingId } = req.query as { listingType?: string; listingId?: string };
  if (!listingType || !listingId) return res.status(400).json({ error: "listingType and listingId are required" });

  const rows = (await db
    .prepare(
      `SELECT * FROM reviews WHERE listing_type = ? AND listing_id = ? AND hidden = 0 ORDER BY created_at DESC`
    )
    .all(listingType, listingId)) as ReviewRow[];
  res.json(rows.map(toReview));
});

reviewsRouter.get("/eligible", async (req, res) => {
  const { listingType, listingId } = req.query as { listingType?: string; listingId?: string };
  if (!listingType || !listingId) return res.status(400).json({ error: "listingType and listingId are required" });
  let clientId: string;
  try {
    clientId = clientIdFrom(req);
  } catch (e) {
    if (e instanceof BadRequestError) return res.status(400).json({ error: e.message });
    throw e;
  }
  res.json({ eligible: await isEligibleToReview(clientId, req.resident?.id ?? null, listingType, listingId) });
});

reviewsRouter.post("/", async (req, res) => {
  let clientId: string;
  try {
    clientId = clientIdFrom(req);
  } catch (e) {
    if (e instanceof BadRequestError) return res.status(400).json({ error: e.message });
    throw e;
  }

  const { listingType, listingId, name, rating, comment } = req.body as {
    listingType?: ReviewListingType;
    listingId?: string;
    name?: string;
    rating?: number;
    comment?: string;
  };

  if (!listingType || !listingId || !name || !rating) {
    return res.status(400).json({ error: "listingType, listingId, name and rating are required" });
  }
  if (rating < 1 || rating > 5) return res.status(400).json({ error: "rating must be between 1 and 5" });
  if (!(await listingExists(listingType, listingId))) return res.status(404).json({ error: "Listing not found" });
  if (!(await isEligibleToReview(clientId, req.resident?.id ?? null, listingType, listingId))) {
    const messages: Record<ReviewListingType, string> = {
      centre: "You can only review a centre after booking it.",
      club: "You can only review a club after registering with it.",
      game: "You can only review a session after actually attending a past one.",
      host: "You can only review a host after playing in one of their past sessions.",
      experience: "You can only review this after a past booking on it.",
      program: "You can only review a program after attending at least one past session.",
    };
    return res.status(403).json({ error: messages[listingType] });
  }

  const info = await db
    .prepare(
      `INSERT INTO reviews (listing_type, listing_id, client_id, name, rating, comment) VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(listingType, listingId, clientId, name, rating, comment ?? "");

  const row = (await db.prepare(`SELECT * FROM reviews WHERE id = ?`).get(info.lastInsertRowid)) as ReviewRow;
  res.status(201).json(toReview(row));
});

reviewsRouter.delete("/:id", requireAdmin, async (req, res) => {
  const info = await db.prepare(`UPDATE reviews SET hidden = 1 WHERE id = ?`).run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Review not found" });
  res.json({ ok: true });
});
