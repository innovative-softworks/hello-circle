import { Router } from "express";
import { requireAdmin } from "../auth.js";
import { db } from "../db/index.js";
import { getCentre, getClub } from "../db/queries.js";
import { BadRequestError, clientIdFrom } from "../util.js";
import type { Review } from "../types.js";

export const reviewsRouter = Router();

interface ReviewRow {
  id: number;
  listing_type: "centre" | "club";
  listing_id: string;
  name: string;
  rating: number;
  comment: string;
  created_at: string;
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
  };
}

async function listingExists(listingType: string, listingId: string): Promise<boolean> {
  if (listingType === "centre") return !!(await getCentre(listingId));
  if (listingType === "club") return !!(await getClub(listingId));
  return false;
}

// Reviews are restricted to guests who actually booked (centre) or
// registered (club) at that specific listing — matched by their client id.
async function hasStayed(clientId: string, listingType: string, listingId: string): Promise<boolean> {
  if (listingType === "centre") {
    const row = await db.prepare(`SELECT 1 FROM bookings WHERE client_id = ? AND centre_id = ? LIMIT 1`).get(clientId, listingId);
    return !!row;
  }
  if (listingType === "club") {
    const row = await db.prepare(`SELECT 1 FROM registrations WHERE client_id = ? AND club_id = ? LIMIT 1`).get(clientId, listingId);
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
  res.json({ eligible: await hasStayed(clientId, listingType, listingId) });
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
    listingType?: "centre" | "club";
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
  if (!(await hasStayed(clientId, listingType, listingId))) {
    return res.status(403).json({
      error: listingType === "centre"
        ? "You can only review a centre after booking it."
        : "You can only review a club after registering with it.",
    });
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
