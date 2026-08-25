import crypto from "node:crypto";
import { Router } from "express";
import { db } from "../db/index.js";
import { getCircleSuggestions } from "../db/queries.js";
import { requireResident } from "../residents.js";
import { generateSlug } from "../slugify.js";

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
  status: string;
  slug: string | null;
}

/** Organiser-only actions (invite, close, close a poll) — the creator gets
 * role='organiser' at creation (see POST / below); anyone else is 'member'. */
async function isOrganiser(circleId: string, residentId: string): Promise<boolean> {
  const row = (await db.prepare(`SELECT role FROM circle_members WHERE circle_id = ? AND resident_id = ?`).get(circleId, residentId)) as
    | { role: string }
    | undefined;
  return row?.role === "organiser";
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
    status: row.status,
    slug: row.slug,
  };
}

// Circles (NEXT) — a persistent group anchored to recurring participation
// (upcoming games/sessions), deliberately not a generic social feed: no
// posts/likes/followers, just membership + what's coming up.
circlesRouter.get("/", async (req, res) => {
  const county = typeof req.query.county === "string" ? req.query.county : undefined;
  const rows = (county
    ? await db.prepare(`SELECT * FROM circles WHERE county = ? AND status = 'active' ORDER BY name`).all(county)
    : await db.prepare(`SELECT * FROM circles WHERE status = 'active' ORDER BY name`).all()) as CircleRow[];
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

// Slugs (master-prompt punch list #1) — resolves by slug first, falls back
// to the raw id, so an old bookmarked/shared UUID link keeps working
// forever. Every sub-resource route below (join/invite/upcoming/polls/…)
// stays id-only — the client always uses the resolved `circle.id` from
// this response for those, never the raw URL param, once this has loaded.
circlesRouter.get("/:id", async (req, res) => {
  const row = (await db.prepare(`SELECT * FROM circles WHERE slug = ? OR id = ?`).get(req.params.id, req.params.id)) as CircleRow | undefined;
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
  const slug = await generateSlug("circles", b.name);
  await db.transaction(async (tx) => {
    await tx
      .prepare(`INSERT INTO circles (id, name, activity_label, area, county, about, centre_id, created_by_resident_id, slug) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, b.name, b.activityLabel ?? "", b.area ?? "", b.county ?? "", b.about ?? "", b.centreId ?? null, req.resident!.id, slug);
    await tx.prepare(`INSERT INTO circle_members (circle_id, resident_id, role) VALUES (?, ?, 'organiser')`).run(id, req.resident!.id);
  });
  res.status(201).json({ id, slug });
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

// --- Circle settings: Close Circle (IA spec §10) ---------------------------

circlesRouter.put("/:id/status", requireResident, async (req, res) => {
  const { status } = req.body as { status?: string };
  if (status !== "closed" && status !== "active") return res.status(400).json({ error: "status must be active or closed" });
  if (!(await isOrganiser(req.params.id, req.resident!.id))) return res.status(403).json({ error: "Only the organiser can change this" });
  await db.prepare(`UPDATE circles SET status = ? WHERE id = ?`).run(status, req.params.id);
  res.json({ ok: true });
});

// --- Circle Invitations (IA spec §10) ---------------------------------------
// A distinct invite-then-accept path alongside the existing instant
// self-serve POST /:id/join, which stays unchanged — Circles remain
// publicly joinable. This is for an organiser explicitly asking a specific
// resident (matches Journey 5's "ask familiar participants for consent").

circlesRouter.post("/:id/invite", requireResident, async (req, res) => {
  const { residentId } = req.body as { residentId?: string };
  if (!residentId) return res.status(400).json({ error: "residentId is required" });
  if (!(await isOrganiser(req.params.id, req.resident!.id))) return res.status(403).json({ error: "Only the organiser can invite" });
  const alreadyMember = await db.prepare(`SELECT 1 FROM circle_members WHERE circle_id = ? AND resident_id = ?`).get(req.params.id, residentId);
  if (alreadyMember) return res.status(409).json({ error: "Already a member" });
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO circle_invites (id, circle_id, resident_id, invited_by_resident_id) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE status = 'pending', invited_by_resident_id = VALUES(invited_by_resident_id), created_at = NOW()`
    )
    .run(id, req.params.id, residentId, req.resident!.id);
  res.status(201).json({ ok: true });
});

// "/invitations/mine" is two path segments, so it never collides with the
// single-segment "/:id" route above regardless of registration order.
circlesRouter.get("/invitations/mine", requireResident, async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT ci.id, ci.circle_id as circleId, c.name as circleName, c.activity_label as activityLabel, u.name as invitedByName, ci.created_at as createdAt
       FROM circle_invites ci JOIN circles c ON c.id = ci.circle_id JOIN residents u ON u.id = ci.invited_by_resident_id
       WHERE ci.resident_id = ? AND ci.status = 'pending' ORDER BY ci.created_at DESC`
    )
    .all(req.resident!.id);
  res.json(rows);
});

circlesRouter.post("/invitations/:id/respond", requireResident, async (req, res) => {
  const { accept } = req.body as { accept?: boolean };
  const invite = (await db.prepare(`SELECT circle_id as circleId, resident_id as residentId, status FROM circle_invites WHERE id = ?`).get(req.params.id)) as
    | { circleId: string; residentId: string; status: string }
    | undefined;
  if (!invite || invite.residentId !== req.resident!.id) return res.status(404).json({ error: "Invitation not found" });
  if (invite.status !== "pending") return res.status(409).json({ error: "This invitation has already been answered" });

  await db.transaction(async (tx) => {
    await tx.prepare(`UPDATE circle_invites SET status = ? WHERE id = ?`).run(accept ? "accepted" : "declined", req.params.id);
    if (accept) await tx.prepare(`INSERT IGNORE INTO circle_members (circle_id, resident_id) VALUES (?, ?)`).run(invite.circleId, req.resident!.id);
  });
  res.json({ ok: true });
});

// --- Circle planning / availability poll (IA spec §10) ---------------------
// Members propose date/time options; others vote for every option they're
// available for (multi-select, not single-choice). The spec's "recommended
// option" is derived from vote counts on the client, not stored.

circlesRouter.get("/:id/polls", async (req, res) => {
  const polls = (await db.prepare(`SELECT id, question, created_by_resident_id as createdByResidentId, status, created_at as createdAt FROM circle_polls WHERE circle_id = ? ORDER BY created_at DESC`).all(req.params.id)) as {
    id: string;
    question: string;
    createdByResidentId: string;
    status: string;
    createdAt: string;
  }[];
  const result = await Promise.all(
    polls.map(async (poll) => {
      const options = (await db
        .prepare(
          `SELECT o.id, o.date, o.time, (SELECT COUNT(*) FROM circle_poll_votes v WHERE v.option_id = o.id) as voteCount,
                  EXISTS(SELECT 1 FROM circle_poll_votes v WHERE v.option_id = o.id AND v.resident_id = ?) as votedByMe
           FROM circle_poll_options o WHERE o.poll_id = ? ORDER BY o.sort_order`
        )
        .all(req.resident?.id ?? "", poll.id)) as { id: number; date: string; time: string; voteCount: number; votedByMe: number }[];
      return { ...poll, options: options.map((o) => ({ ...o, votedByMe: !!o.votedByMe })) };
    })
  );
  res.json(result);
});

circlesRouter.post("/:id/polls", requireResident, async (req, res) => {
  const { question, options } = req.body as { question?: string; options?: { date: string; time?: string }[] };
  if (!question || !options || options.length === 0) return res.status(400).json({ error: "A question and at least one date option are required" });
  const id = crypto.randomUUID();
  await db.transaction(async (tx) => {
    await tx.prepare(`INSERT INTO circle_polls (id, circle_id, question, created_by_resident_id) VALUES (?, ?, ?, ?)`).run(id, req.params.id, question, req.resident!.id);
    for (const [i, o] of options.entries()) {
      await tx.prepare(`INSERT INTO circle_poll_options (poll_id, date, time, sort_order) VALUES (?, ?, ?, ?)`).run(id, o.date, o.time ?? "", i);
    }
  });
  res.status(201).json({ id });
});

circlesRouter.post("/:id/polls/:pollId/options/:optionId/vote", requireResident, async (req, res) => {
  const option = await db.prepare(`SELECT id FROM circle_poll_options WHERE id = ? AND poll_id = ?`).get(req.params.optionId, req.params.pollId);
  if (!option) return res.status(404).json({ error: "Option not found" });
  const existing = await db.prepare(`SELECT 1 FROM circle_poll_votes WHERE poll_id = ? AND option_id = ? AND resident_id = ?`).get(req.params.pollId, req.params.optionId, req.resident!.id);
  if (existing) {
    await db.prepare(`DELETE FROM circle_poll_votes WHERE poll_id = ? AND option_id = ? AND resident_id = ?`).run(req.params.pollId, req.params.optionId, req.resident!.id);
  } else {
    await db.prepare(`INSERT INTO circle_poll_votes (poll_id, option_id, resident_id) VALUES (?, ?, ?)`).run(req.params.pollId, req.params.optionId, req.resident!.id);
  }
  res.json({ ok: true });
});

circlesRouter.post("/:id/polls/:pollId/close", requireResident, async (req, res) => {
  if (!(await isOrganiser(req.params.id, req.resident!.id))) return res.status(403).json({ error: "Only the organiser can close a poll" });
  await db.prepare(`UPDATE circle_polls SET status = 'closed' WHERE id = ? AND circle_id = ?`).run(req.params.pollId, req.params.id);
  res.json({ ok: true });
});
