import { Router } from "express";
import { db } from "../db/index.js";
import { getApprovedClub, getClub, listClubs } from "../db/queries.js";
import { BadRequestError, clientIdFrom } from "../util.js";

export const clubsRouter = Router();

clubsRouter.get("/", async (req, res) => {
  const county = typeof req.query.county === "string" ? req.query.county : undefined;
  const sport = typeof req.query.sport === "string" ? req.query.sport : undefined;
  res.json(await listClubs(county, sport));
});

clubsRouter.get("/:id", async (req, res) => {
  const club = await getApprovedClub(req.params.id);
  if (!club) return res.status(404).json({ error: "Club not found" });
  res.json(club);
});

// --- waitlist (MVP) --------------------------------------------------------
// Only meaningful once a club has a capacity set (see clubs.capacity) —
// registrations.ts checkout returns 409 "full" once paid registrations
// reach that ceiling, at which point the client offers these instead.

async function paidRegistrationCount(clubId: string): Promise<number> {
  const row = (await db
    .prepare(`SELECT COUNT(*) as n FROM registrations WHERE club_id = ? AND payment_status = 'paid' AND status != 'cancelled'`)
    .get(clubId)) as { n: number };
  return row.n;
}

clubsRouter.get("/:id/waitlist/position", async (req, res) => {
  let clientId: string;
  try {
    clientId = clientIdFrom(req);
  } catch (e) {
    if (e instanceof BadRequestError) return res.status(400).json({ error: e.message });
    throw e;
  }
  const rows = (await db
    .prepare(`SELECT id, client_id as clientId FROM waitlist_entries WHERE listing_type = 'club' AND listing_id = ? AND status = 'waiting' ORDER BY id`)
    .all(req.params.id)) as { id: number; clientId: string }[];
  const idx = rows.findIndex((r) => r.clientId === clientId);
  if (idx === -1) return res.json({ onWaitlist: false });
  res.json({ onWaitlist: true, position: idx + 1, total: rows.length });
});

clubsRouter.post("/:id/waitlist", async (req, res) => {
  let clientId: string;
  try {
    clientId = clientIdFrom(req);
  } catch (e) {
    if (e instanceof BadRequestError) return res.status(400).json({ error: e.message });
    throw e;
  }
  const { name, email } = req.body as { name?: string; email?: string };
  const club = await getClub(req.params.id);
  if (!club) return res.status(404).json({ error: "Club not found" });

  const existing = await db
    .prepare(`SELECT id FROM waitlist_entries WHERE listing_type = 'club' AND listing_id = ? AND client_id = ? AND status = 'waiting'`)
    .get(req.params.id, clientId);
  if (existing) return res.status(409).json({ error: "You're already on the waitlist for this club" });

  await db
    .prepare(`INSERT INTO waitlist_entries (listing_type, listing_id, resident_id, client_id, name, email) VALUES ('club', ?, ?, ?, ?, ?)`)
    .run(req.params.id, req.resident?.id ?? null, clientId, name ?? "", email ?? "");
  res.status(201).json({ ok: true });
});

clubsRouter.delete("/:id/waitlist", async (req, res) => {
  let clientId: string;
  try {
    clientId = clientIdFrom(req);
  } catch (e) {
    if (e instanceof BadRequestError) return res.status(400).json({ error: e.message });
    throw e;
  }
  await db
    .prepare(`UPDATE waitlist_entries SET status = 'left' WHERE listing_type = 'club' AND listing_id = ? AND client_id = ? AND status = 'waiting'`)
    .run(req.params.id, clientId);
  res.json({ ok: true });
});

export { paidRegistrationCount };
