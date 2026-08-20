import { Router } from "express";
import { db } from "../db/index.js";
import { requireResident } from "../residents.js";

export const favouritesRouter = Router();
favouritesRouter.use(requireResident);

// Interest → Participation states (implementation plan Phase 6). A saved
// listing starts 'interested' and can move to 'planning' (resident signals
// stronger intent) or 'joined' (a real transaction confirmed — see
// upgradeFavouriteStatus below). Never auto-downgraded.
const STATUSES = ["interested", "planning", "joined"] as const;
type FavouriteStatus = (typeof STATUSES)[number];

// Matches client/src/favorites.ts's FavoriteKind — the client-local
// (signed-out) favourites already covered all 5 kinds; the server only
// covered centre/club until this phase.
const LISTING_TYPES = ["centre", "club", "game", "program_session", "club_session"] as const;
type ListingType = (typeof LISTING_TYPES)[number];

favouritesRouter.get("/", async (req, res) => {
  const rows = await db
    .prepare(`SELECT listing_type as listingType, listing_id as listingId, status FROM favourites WHERE resident_id = ?`)
    .all(req.resident!.id);
  res.json(rows);
});

favouritesRouter.post("/", async (req, res) => {
  const { listingType, listingId, status } = req.body as { listingType?: ListingType; listingId?: string; status?: FavouriteStatus };
  if (!listingType || !listingId || !LISTING_TYPES.includes(listingType)) {
    return res.status(400).json({ error: "listingType and listingId are required" });
  }
  if (status && !STATUSES.includes(status)) return res.status(400).json({ error: "Invalid status" });
  await db
    .prepare(
      `INSERT INTO favourites (resident_id, listing_type, listing_id, status) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE status = VALUES(status)`
    )
    .run(req.resident!.id, listingType, listingId, status ?? "interested");
  res.status(201).json({ ok: true });
});

favouritesRouter.put("/status", async (req, res) => {
  const { listingType, listingId, status } = req.body as { listingType?: ListingType; listingId?: string; status?: FavouriteStatus };
  if (!listingType || !listingId || !status || !STATUSES.includes(status)) {
    return res.status(400).json({ error: "listingType, listingId and a valid status are required" });
  }
  await db
    .prepare(`UPDATE favourites SET status = ? WHERE resident_id = ? AND listing_type = ? AND listing_id = ?`)
    .run(status, req.resident!.id, listingType, listingId);
  res.json({ ok: true });
});

favouritesRouter.delete("/", async (req, res) => {
  const { listingType, listingId } = req.body as { listingType?: string; listingId?: string };
  if (!listingType || !listingId) return res.status(400).json({ error: "listingType and listingId are required" });
  await db
    .prepare(`DELETE FROM favourites WHERE resident_id = ? AND listing_type = ? AND listing_id = ?`)
    .run(req.resident!.id, listingType, listingId);
  res.json({ ok: true });
});

/** Called from a real booking/registration/game-join confirmation (cash-
 * immediate and Stripe-webhook paths alike) to move a matching favourite
 * from 'interested'/'planning' to 'joined' — the actual "interest becomes
 * participation" mechanic. A no-op if the resident never favourited this
 * listing (doesn't create one) or it's already 'joined'. */
export async function upgradeFavouriteStatus(residentId: string, listingType: ListingType, listingId: string): Promise<void> {
  await db
    .prepare(`UPDATE favourites SET status = 'joined' WHERE resident_id = ? AND listing_type = ? AND listing_id = ? AND status != 'joined'`)
    .run(residentId, listingType, listingId);
}
