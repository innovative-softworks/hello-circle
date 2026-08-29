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
const LISTING_TYPES = ["centre", "club", "game", "program_session", "club_session", "experience"] as const;
type ListingType = (typeof LISTING_TYPES)[number];

type FavouriteRow = { listingType: ListingType; listingId: string; status: FavouriteStatus };

/** Batches by listing_type (one query per type present, not per row) to
 * attach the display name/image/context line My Life's "Saved" panel needs —
 * the favourites table itself only ever carried listingType/listingId/status.
 * program_session/club_session go one level up to their parent
 * program/club for the name, since neither session table has its own title
 * worth showing standalone. Best-effort: a listing that's since been
 * deleted just falls back to the generic type label client-side (no name
 * attached), same as before this enrichment existed. */
async function attachListingDetails(rows: FavouriteRow[]) {
  const byType = new Map<ListingType, string[]>();
  for (const r of rows) byType.set(r.listingType, [...(byType.get(r.listingType) ?? []), r.listingId]);

  const details = new Map<string, { name: string; imageUrl: string | null; subtitle: string | null }>();
  const key = (t: ListingType, id: string) => `${t}:${id}`;

  await Promise.all(
    Array.from(byType.entries()).map(async ([type, ids]) => {
      const placeholders = ids.map(() => "?").join(",");
      if (type === "centre" || type === "club") {
        const table = type === "centre" ? "centres" : "clubs";
        const listingRows = (await db.prepare(`SELECT id, name, image_url as imageUrl FROM ${table} WHERE id IN (${placeholders})`).all(...ids)) as {
          id: string; name: string; imageUrl: string | null;
        }[];
        for (const l of listingRows) details.set(key(type, l.id), { name: l.name, imageUrl: l.imageUrl, subtitle: null });
      } else if (type === "game") {
        const listingRows = (await db
          .prepare(`SELECT id, activity_label as name, image_url as imageUrl, date, time FROM games WHERE id IN (${placeholders})`)
          .all(...ids)) as { id: string; name: string; imageUrl: string | null; date: string; time: string }[];
        for (const l of listingRows) details.set(key(type, l.id), { name: l.name, imageUrl: l.imageUrl, subtitle: `${l.date} · ${l.time}` });
      } else if (type === "experience") {
        const listingRows = (await db.prepare(`SELECT id, title as name, image_url as imageUrl FROM experiences WHERE id IN (${placeholders})`).all(...ids)) as {
          id: string; name: string; imageUrl: string | null;
        }[];
        for (const l of listingRows) details.set(key(type, l.id), { name: l.name, imageUrl: l.imageUrl, subtitle: null });
      } else if (type === "program_session") {
        const listingRows = (await db
          .prepare(
            `SELECT ps.id, p.title as name, p.image_url as imageUrl, ps.date, ps.time
             FROM program_sessions ps JOIN programs p ON p.id = ps.program_id
             WHERE ps.id IN (${placeholders})`
          )
          .all(...ids)) as { id: string; name: string; imageUrl: string | null; date: string; time: string }[];
        for (const l of listingRows) details.set(key(type, l.id), { name: l.name, imageUrl: l.imageUrl, subtitle: `${l.date} · ${l.time}` });
      } else if (type === "club_session") {
        const listingRows = (await db
          .prepare(
            `SELECT cs.id, COALESCE(cs.label, c.name) as name, COALESCE(cs.image_url, c.image_url) as imageUrl, cs.day_of_week as dayOfWeek, cs.time
             FROM club_sessions cs JOIN clubs c ON c.id = cs.club_id
             WHERE cs.id IN (${placeholders})`
          )
          .all(...ids)) as { id: string; name: string; imageUrl: string | null; dayOfWeek: number; time: string }[];
        for (const l of listingRows) {
          const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][l.dayOfWeek] ?? "";
          details.set(key(type, l.id), { name: l.name, imageUrl: l.imageUrl, subtitle: `${day} · ${l.time}` });
        }
      }
    })
  );

  return rows.map((r) => ({ ...r, ...(details.get(key(r.listingType, r.listingId)) ?? { name: null, imageUrl: null, subtitle: null }) }));
}

favouritesRouter.get("/", async (req, res) => {
  const rows = (await db
    .prepare(`SELECT listing_type as listingType, listing_id as listingId, status FROM favourites WHERE resident_id = ?`)
    .all(req.resident!.id)) as FavouriteRow[];
  res.json(await attachListingDetails(rows));
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
