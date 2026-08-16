import crypto from "node:crypto";
import { Router } from "express";
import { requireVendor } from "../auth.js";
import { db } from "../db/index.js";

export const clubSessionsRouter = Router();

interface SessionRow {
  id: string;
  club_id: string;
  day_of_week: number;
  time: string;
  capacity: number | null;
  label: string;
  active: number;
}

async function ownsClub(vendorId: string, clubId: string): Promise<boolean> {
  const row = (await db.prepare(`SELECT vendor_id FROM clubs WHERE id = ?`).get(clubId)) as { vendor_id: string | null } | undefined;
  return !!row && row.vendor_id === vendorId;
}

function toJson(row: SessionRow) {
  return {
    id: row.id,
    clubId: row.club_id,
    dayOfWeek: row.day_of_week,
    time: row.time,
    capacity: row.capacity,
    label: row.label,
    active: !!row.active,
  };
}

// Public read — a club's recurring schedule (NEXT). Not yet wired into
// registrations.ts checkout (a registration still isn't tied to a specific
// session) — this is the read/manage layer only, the seed of turning "flat
// register" into a real per-session schedule in a later pass.
clubSessionsRouter.get("/", async (req, res) => {
  const clubId = typeof req.query.clubId === "string" ? req.query.clubId : undefined;
  if (!clubId) return res.status(400).json({ error: "clubId is required" });
  const rows = (await db.prepare(`SELECT * FROM club_sessions WHERE club_id = ? AND active = 1 ORDER BY day_of_week, time`).all(clubId)) as SessionRow[];
  res.json(rows.map(toJson));
});

clubSessionsRouter.post("/", requireVendor, async (req, res) => {
  const b = req.body as { clubId: string; dayOfWeek: number; time: string; capacity?: number; label?: string };
  if (!b.clubId || b.dayOfWeek === undefined || !b.time) return res.status(400).json({ error: "clubId, dayOfWeek and time are required" });
  if (!(await ownsClub(req.user!.id, b.clubId))) return res.status(403).json({ error: "Not your club" });

  const id = crypto.randomUUID();
  await db
    .prepare(`INSERT INTO club_sessions (id, club_id, day_of_week, time, capacity, label) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, b.clubId, b.dayOfWeek, b.time, b.capacity ?? null, b.label ?? "");
  res.status(201).json({ id });
});

clubSessionsRouter.put("/:id", requireVendor, async (req, res) => {
  const row = (await db.prepare(`SELECT club_id FROM club_sessions WHERE id = ?`).get(req.params.id)) as { club_id: string } | undefined;
  if (!row || !(await ownsClub(req.user!.id, row.club_id))) return res.status(403).json({ error: "Not your session" });
  const b = req.body as Partial<{ dayOfWeek: number; time: string; capacity: number | null; label: string; active: boolean }>;
  await db
    .prepare(
      `UPDATE club_sessions SET day_of_week = COALESCE(?, day_of_week), time = COALESCE(?, time), capacity = COALESCE(?, capacity),
       label = COALESCE(?, label), active = COALESCE(?, active) WHERE id = ?`
    )
    .run(b.dayOfWeek, b.time, b.capacity, b.label, b.active === undefined ? undefined : b.active ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

clubSessionsRouter.delete("/:id", requireVendor, async (req, res) => {
  const row = (await db.prepare(`SELECT club_id FROM club_sessions WHERE id = ?`).get(req.params.id)) as { club_id: string } | undefined;
  if (!row || !(await ownsClub(req.user!.id, row.club_id))) return res.status(403).json({ error: "Not your session" });
  await db.prepare(`DELETE FROM club_sessions WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});
