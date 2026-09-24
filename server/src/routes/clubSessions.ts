import crypto from "node:crypto";
import { Router } from "express";
import { attachVendorIds, requirePlatformRole, requireVendor } from "../auth.js";
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
  instructor_name: string;
  image_url: string;
  club_image_url: string;
}

async function ownsClub(vendorIds: string[], clubId: string): Promise<boolean> {
  const row = (await db.prepare(`SELECT vendor_id FROM clubs WHERE id = ?`).get(clubId)) as { vendor_id: string | null } | undefined;
  return !!row && !!row.vendor_id && vendorIds.includes(row.vendor_id);
}

// Image Upload Coverage spec, "Club Sessions": "Without an override,
// inherit the Club cover" — imageUrl below is the RESOLVED value for
// display; hasCustomImage tells the editor whether there's actually a
// session-specific asset to replace/remove (removing one falls straight
// back to showing the club's cover, never a broken image).
function toJson(row: SessionRow) {
  return {
    id: row.id,
    clubId: row.club_id,
    dayOfWeek: row.day_of_week,
    time: row.time,
    capacity: row.capacity,
    label: row.label,
    active: !!row.active,
    instructorName: row.instructor_name,
    imageUrl: row.image_url || row.club_image_url || null,
    hasCustomImage: !!row.image_url,
  };
}

// Public read — a club's recurring schedule (NEXT). A registration can
// optionally pick one of these sessions (registrations.ts checkout enforces
// this session's own capacity, row-locked, alongside the club-wide cap) —
// sessions remain opt-in, a club with none configured behaves exactly as
// before.
clubSessionsRouter.get("/", async (req, res) => {
  const clubId = typeof req.query.clubId === "string" ? req.query.clubId : undefined;
  if (!clubId) return res.status(400).json({ error: "clubId is required" });
  const rows = (await db
    .prepare(
      `SELECT cs.*, cl.image_url as club_image_url FROM club_sessions cs JOIN clubs cl ON cl.id = cs.club_id WHERE cs.club_id = ? AND cs.active = 1 ORDER BY cs.day_of_week, cs.time`
    )
    .all(clubId)) as SessionRow[];
  res.json(rows.map(toJson));
});

clubSessionsRouter.post("/", requireVendor, attachVendorIds, requirePlatformRole("facility_manager"), async (req, res) => {
  const b = req.body as { clubId: string; dayOfWeek: number; time: string; capacity?: number; label?: string; instructorName?: string; imageUrl?: string };
  if (!b.clubId || b.dayOfWeek === undefined || !b.time) return res.status(400).json({ error: "clubId, dayOfWeek and time are required" });
  if (!(await ownsClub(req.vendorIds!, b.clubId))) return res.status(403).json({ error: "Not your club" });

  const id = crypto.randomUUID();
  await db
    .prepare(`INSERT INTO club_sessions (id, club_id, day_of_week, time, capacity, label, instructor_name, image_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, b.clubId, b.dayOfWeek, b.time, b.capacity ?? null, b.label ?? "", b.instructorName ?? "", b.imageUrl ?? "");
  res.status(201).json({ id });
});

clubSessionsRouter.put("/:id", requireVendor, attachVendorIds, requirePlatformRole("facility_manager"), async (req, res) => {
  const row = (await db.prepare(`SELECT club_id FROM club_sessions WHERE id = ?`).get(req.params.id)) as { club_id: string } | undefined;
  if (!row || !(await ownsClub(req.vendorIds!, row.club_id))) return res.status(403).json({ error: "Not your session" });
  const b = req.body as Partial<{ dayOfWeek: number; time: string; capacity: number | null; label: string; active: boolean; instructorName: string; imageUrl: string }>;
  await db
    .prepare(
      `UPDATE club_sessions SET day_of_week = COALESCE(?, day_of_week), time = COALESCE(?, time), capacity = COALESCE(?, capacity),
       label = COALESCE(?, label), active = COALESCE(?, active), instructor_name = COALESCE(?, instructor_name), image_url = COALESCE(?, image_url) WHERE id = ?`
    )
    .run(b.dayOfWeek, b.time, b.capacity, b.label, b.active === undefined ? undefined : b.active ? 1 : 0, b.instructorName, b.imageUrl, req.params.id);
  res.json({ ok: true });
});

clubSessionsRouter.delete("/:id", requireVendor, attachVendorIds, requirePlatformRole("facility_manager"), async (req, res) => {
  const row = (await db.prepare(`SELECT club_id FROM club_sessions WHERE id = ?`).get(req.params.id)) as { club_id: string } | undefined;
  if (!row || !(await ownsClub(req.vendorIds!, row.club_id))) return res.status(403).json({ error: "Not your session" });
  await db.prepare(`DELETE FROM club_sessions WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});
