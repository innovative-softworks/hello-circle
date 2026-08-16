import { Router } from "express";
import { db } from "../db/index.js";
import { requireResident } from "../residents.js";

export const favouritesRouter = Router();
favouritesRouter.use(requireResident);

favouritesRouter.get("/", async (req, res) => {
  const rows = await db
    .prepare(`SELECT listing_type as listingType, listing_id as listingId FROM favourites WHERE resident_id = ?`)
    .all(req.resident!.id);
  res.json(rows);
});

favouritesRouter.post("/", async (req, res) => {
  const { listingType, listingId } = req.body as { listingType?: "centre" | "club"; listingId?: string };
  if (!listingType || !listingId || !["centre", "club"].includes(listingType)) {
    return res.status(400).json({ error: "listingType and listingId are required" });
  }
  await db
    .prepare(`INSERT IGNORE INTO favourites (resident_id, listing_type, listing_id) VALUES (?, ?, ?)`)
    .run(req.resident!.id, listingType, listingId);
  res.status(201).json({ ok: true });
});

favouritesRouter.delete("/", async (req, res) => {
  const { listingType, listingId } = req.body as { listingType?: "centre" | "club"; listingId?: string };
  if (!listingType || !listingId) return res.status(400).json({ error: "listingType and listingId are required" });
  await db
    .prepare(`DELETE FROM favourites WHERE resident_id = ? AND listing_type = ? AND listing_id = ?`)
    .run(req.resident!.id, listingType, listingId);
  res.json({ ok: true });
});
