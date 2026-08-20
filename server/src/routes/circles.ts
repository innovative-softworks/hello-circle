import crypto from "node:crypto";
import { Router } from "express";
import { db } from "../db/index.js";
import { getCircleSuggestions } from "../db/queries.js";
import { requireResident } from "../residents.js";

export const circlesRouter = Router();

interface CircleRow {
  id: string;
  name: string;
  activity_label: string;
  area: string;
  county: string;
  about: string;
  centre_id: string | null;
  created_by_resident_id: string;
  created_at: string;
}

async function toCircleJson(row: CircleRow) {
  const { n: members } = (await db.prepare(`SELECT COUNT(*) as n FROM circle_members WHERE circle_id = ?`).get(row.id)) as { n: number };
  // "Host" trust tier (IA spec five-layer audit) — badge-only, same
  // convention as games.ts's toGameJson. Neither the creator's id nor name
  // was exposed on this response before.
  const creator = (await db.prepare(`SELECT name, host_status as hostStatus FROM residents WHERE id = ?`).get(row.created_by_resident_id)) as
    | { name: string; hostStatus: string }
    | undefined;
  return {
    id: row.id,
    name: row.name,
    activityLabel: row.activity_label,
    area: row.area,
    county: row.county,
    about: row.about,
    centreId: row.centre_id,
    members,
    createdAt: row.created_at,
    createdByResidentId: row.created_by_resident_id,
    hostName: creator?.name ?? "",
    hostVerified: creator?.hostStatus === "verified",
  };
}

// Circles (NEXT) — a persistent group anchored to recurring participation
// (upcoming games/sessions), deliberately not a generic social feed: no
// posts/likes/followers, just membership + what's coming up.
circlesRouter.get("/", async (req, res) => {
  const county = typeof req.query.county === "string" ? req.query.county : undefined;
  const rows = (county
    ? await db.prepare(`SELECT * FROM circles WHERE county = ? ORDER BY name`).all(county)
    : await db.prepare(`SELECT * FROM circles ORDER BY name`).all()) as CircleRow[];
  res.json(await Promise.all(rows.map(toCircleJson)));
});

// Every circle this resident belongs to — distinct from GET / (public
// browse list), which isn't scoped to any one resident.
circlesRouter.get("/mine", requireResident, async (req, res) => {
  const rows = (await db
    .prepare(
      `SELECT c.* FROM circles c
       JOIN circle_members cm ON cm.circle_id = c.id
       WHERE cm.resident_id = ?
       ORDER BY c.name`
    )
    .all(req.resident!.id)) as CircleRow[];
  res.json(await Promise.all(rows.map(toCircleJson)));
});

// Repetition-detection → "Make this a Circle?" (Phase 8) — activities where
// this resident has 2+ people they've each shared 3+ games with, and isn't
// already circled on. Must be registered before /:id below.
circlesRouter.get("/suggestions", requireResident, async (req, res) => {
  res.json(await getCircleSuggestions(req.resident!.id));
});

circlesRouter.get("/:id", async (req, res) => {
  const row = (await db.prepare(`SELECT * FROM circles WHERE id = ?`).get(req.params.id)) as CircleRow | undefined;
  if (!row) return res.status(404).json({ error: "Circle not found" });
  res.json(await toCircleJson(row));
});

// Upcoming games tagged to this circle's activity + area — Circles don't
// have their own event/session table; they surface from the existing Games
// model filtered by matching activity label, keeping "what's coming up"
// anchored to real participation instead of a separate events system.
circlesRouter.get("/:id/upcoming", async (req, res) => {
  const circle = (await db.prepare(`SELECT * FROM circles WHERE id = ?`).get(req.params.id)) as CircleRow | undefined;
  if (!circle) return res.status(404).json({ error: "Circle not found" });
  const today = new Date().toISOString().slice(0, 10);
  const rows = await db
    .prepare(`SELECT id, activity_label as activityLabel, date, time FROM games WHERE status = 'open' AND date >= ? AND activity_label = ? ORDER BY date, time LIMIT 10`)
    .all(today, circle.activity_label);
  res.json(rows);
});

interface CreateCircleInput {
  name: string;
  activityLabel?: string;
  area?: string;
  county?: string;
  about?: string;
  centreId?: string;
}

circlesRouter.post("/", requireResident, async (req, res) => {
  const b = req.body as CreateCircleInput;
  if (!b.name) return res.status(400).json({ error: "A name is required" });
  const id = crypto.randomUUID();
  await db.transaction(async (tx) => {
    await tx
      .prepare(`INSERT INTO circles (id, name, activity_label, area, county, about, centre_id, created_by_resident_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, b.name, b.activityLabel ?? "", b.area ?? "", b.county ?? "", b.about ?? "", b.centreId ?? null, req.resident!.id);
    await tx.prepare(`INSERT INTO circle_members (circle_id, resident_id, role) VALUES (?, ?, 'organiser')`).run(id, req.resident!.id);
  });
  res.status(201).json({ id });
});

circlesRouter.post("/:id/join", requireResident, async (req, res) => {
  await db.prepare(`INSERT IGNORE INTO circle_members (circle_id, resident_id) VALUES (?, ?)`).run(req.params.id, req.resident!.id);
  res.status(201).json({ ok: true });
});

circlesRouter.delete("/:id/join", requireResident, async (req, res) => {
  await db.prepare(`DELETE FROM circle_members WHERE circle_id = ? AND resident_id = ?`).run(req.params.id, req.resident!.id);
  res.json({ ok: true });
});

circlesRouter.get("/:id/membership", requireResident, async (req, res) => {
  const row = await db.prepare(`SELECT role FROM circle_members WHERE circle_id = ? AND resident_id = ?`).get(req.params.id, req.resident!.id);
  res.json({ member: !!row, role: (row as { role: string } | undefined)?.role ?? null });
});
