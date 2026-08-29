import crypto from "node:crypto";
import { Router } from "express";
import { logEvent } from "../analytics.js";
import { computeCapacity } from "../capacity.js";
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
  image_url: string;
  what_we_do: string | null;
  who_can_join: string | null;
  circle_values: string | null;
}

/** Organiser-only actions (invite, close, close a poll) — the creator gets
 * role='organiser' at creation (see POST / below); anyone else is 'member'. */
async function isOrganiser(circleId: string, residentId: string): Promise<boolean> {
  const row = (await db.prepare(`SELECT role FROM circle_members WHERE circle_id = ? AND resident_id = ?`).get(circleId, residentId)) as
    | { role: string }
    | undefined;
  return row?.role === "organiser";
}

interface NextPlan {
  id: string;
  date: string;
  time: string;
  joined: number;
  capacity: number;
  spotsLeft: number;
}

// Circle discovery redesign — "what's happening next" is the single most
// important discovery signal a Circle card can show (see Circles.tsx's own
// hero copy). Circles have no first-class plan relationship (see this
// file's own "Circles (NEXT)" comment below); this reuses the exact same
// activity-label match GET /:id/upcoming already does, just capped to the
// one soonest row instead of ten, and shaped like a Game so the card can
// use the same spots-left urgency language as Games.tsx.
async function nextPlanFor(activityLabel: string): Promise<NextPlan | null> {
  if (!activityLabel) return null;
  const today = new Date().toISOString().slice(0, 10);
  const row = (await db
    .prepare(
      `SELECT g.id, g.date, g.time, g.capacity,
              (SELECT COUNT(*) FROM game_participants gp WHERE gp.game_id = g.id AND gp.status = 'joined') as joined
       FROM games g
       WHERE g.status IN ('open', 'pending_participants') AND g.date >= ? AND g.activity_label = ?
       ORDER BY g.date, g.time LIMIT 1`
    )
    .get(today, activityLabel)) as { id: string; date: string; time: string; capacity: number; joined: number } | undefined;
  if (!row) return null;
  return { id: row.id, date: row.date, time: row.time, joined: row.joined, capacity: row.capacity, spotsLeft: computeCapacity(row.capacity, row.joined).spotsLeft ?? 0 };
}

// Loose calendar-month count of open games matching this Circle's activity
// — a participation-health signal (spec's "plans this month") rather than
// member count. Same activity-label-match caveat as nextPlanFor: this counts
// every matching game platform-wide, not just ones this Circle's own
// members organised, since Circles don't have a first-class plan link.
async function plansThisMonthFor(activityLabel: string): Promise<number> {
  if (!activityLabel) return 0;
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
  const { n } = (await db
    .prepare(`SELECT COUNT(*) as n FROM games WHERE status IN ('open', 'pending_participants') AND activity_label = ? AND date >= ? AND date < ?`)
    .get(activityLabel, start, end)) as { n: number };
  return n;
}

async function toCircleJson(row: CircleRow) {
  const { n: members } = (await db.prepare(`SELECT COUNT(*) as n FROM circle_members WHERE circle_id = ?`).get(row.id)) as { n: number };
  // "Host" trust tier (IA spec five-layer audit) — badge-only, same
  // convention as games.ts's toGameJson. Neither the creator's id nor name
  // was exposed on this response before.
  const creator = (await db.prepare(`SELECT name, host_status as hostStatus FROM residents WHERE id = ?`).get(row.created_by_resident_id)) as
    | { name: string; hostStatus: string }
    | undefined;
  const [nextPlan, plansThisMonth] = await Promise.all([nextPlanFor(row.activity_label), plansThisMonthFor(row.activity_label)]);
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
    imageUrl: row.image_url || null,
    nextPlan,
    plansThisMonth,
    whatWeDo: row.what_we_do,
    whoCanJoin: row.who_can_join,
    values: row.circle_values,
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
// "My Life" hub's My Circles cards (§13) need the viewer's own role
// (organiser vs member) per circle — the public list/detail shape from
// toCircleJson deliberately has no such field, since role is relative to
// whoever's asking, not a property of the circle itself. This is the one
// resident-scoped endpoint where "whoever's asking" is unambiguous, so the
// role is joined in here rather than adding a field every other consumer
// of toCircleJson would have to ignore.
circlesRouter.get("/mine", requireResident, async (req, res) => {
  const rows = (await db
    .prepare(
      `SELECT c.*, cm.role as viewer_role FROM circles c
       JOIN circle_members cm ON cm.circle_id = c.id
       WHERE cm.resident_id = ?
       ORDER BY c.name`
    )
    .all(req.resident!.id)) as (CircleRow & { viewer_role: string })[];
  res.json(await Promise.all(rows.map(async (row) => ({ ...(await toCircleJson(row)), myRole: row.viewer_role }))));
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
// Detail-only participation stats (Circle Detail redesign §8/§53) — kept
// out of toCircleJson deliberately: that function backs the public list
// endpoint too, and these are each an extra full-table-scan-ish query that
// only earns its cost once, on a single circle's own detail page, not
// once per row across a 50-circle browse list.
async function detailStatsFor(circleId: string, activityLabel: string) {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);

  if (!activityLabel) {
    const { n: newMembersThisMonth } = (await db
      .prepare(`SELECT COUNT(*) as n FROM circle_members WHERE circle_id = ? AND joined_at >= ?`)
      .get(circleId, monthStart)) as { n: number };
    return { participantsThisMonth: 0, repeatParticipants: 0, newMembersThisMonth };
  }

  const [{ n: participantsThisMonth }, { n: repeatParticipants }, { n: newMembersThisMonth }, showUp] = await Promise.all([
    db
      .prepare(
        `SELECT COUNT(DISTINCT gp.resident_id) as n FROM game_participants gp
         JOIN games g ON g.id = gp.game_id
         WHERE g.activity_label = ? AND gp.status = 'joined' AND g.date >= ? AND g.date < ?`
      )
      .get(activityLabel, monthStart, monthEnd) as Promise<{ n: number }>,
    db
      .prepare(
        `SELECT COUNT(*) as n FROM (
           SELECT gp.resident_id FROM game_participants gp
           JOIN games g ON g.id = gp.game_id
           WHERE g.activity_label = ? AND gp.status = 'joined'
           GROUP BY gp.resident_id HAVING COUNT(*) > 1
         ) repeats`
      )
      .get(activityLabel) as Promise<{ n: number }>,
    db.prepare(`SELECT COUNT(*) as n FROM circle_members WHERE circle_id = ? AND joined_at >= ?`).get(circleId, monthStart) as Promise<{ n: number }>,
    // Show-up rate — real, derived from self-serve attendance confirmation
    // (game_participants.attended), not a fabricated metric. Only counts
    // rows where attendance was actually confirmed either way; a game
    // nobody's confirmed yet doesn't drag the rate down. Reference concept
    // asked for this exact stat but with a hardcoded 95% — this is the
    // honest version.
    db
      .prepare(
        `SELECT COUNT(*) as confirmed, SUM(gp.attended) as attended FROM game_participants gp
         JOIN games g ON g.id = gp.game_id
         WHERE g.activity_label = ? AND gp.status = 'joined' AND gp.attended IS NOT NULL`
      )
      .get(activityLabel) as Promise<{ confirmed: number; attended: number | null }>,
  ]);
  const showUpRate = showUp.confirmed > 0 ? Math.round(((showUp.attended ?? 0) / showUp.confirmed) * 100) : null;
  return { participantsThisMonth, repeatParticipants, newMembersThisMonth, showUpRate };
}

// "X people you've played with before are members" (§17/§22) — reuses the
// exact co-participation pattern countFamiliarCoParticipants (db/queries.ts)
// already established for Games, scoped to "ever shared a game" instead of
// "shared a game other than this one" since there's no single current game
// here. Only meaningful for a signed-in resident; the route only calls this
// when req.resident is set.
async function familiarMembersFor(circleId: string, residentId: string): Promise<number> {
  const { n } = (await db
    .prepare(
      `SELECT COUNT(DISTINCT cm.resident_id) as n FROM circle_members cm
       JOIN residents r ON r.id = cm.resident_id
       WHERE cm.circle_id = ? AND cm.resident_id != ? AND r.hide_from_familiar_count = 0
         AND NOT EXISTS (
           SELECT 1 FROM blocked_residents br
           WHERE (br.blocker_resident_id = ? AND br.blocked_resident_id = cm.resident_id)
              OR (br.blocker_resident_id = cm.resident_id AND br.blocked_resident_id = ?)
         )
         AND EXISTS (
           SELECT 1 FROM game_participants gp_them
           WHERE gp_them.resident_id = cm.resident_id AND gp_them.status = 'joined'
             AND EXISTS (SELECT 1 FROM game_participants gp_me WHERE gp_me.game_id = gp_them.game_id AND gp_me.resident_id = ? AND gp_me.status = 'joined')
         )`
    )
    .get(circleId, residentId, residentId, residentId, residentId)) as { n: number };
  return n;
}

circlesRouter.get("/:id", async (req, res) => {
  const row = (await db.prepare(`SELECT * FROM circles WHERE slug = ? OR id = ?`).get(req.params.id, req.params.id)) as CircleRow | undefined;
  if (!row) return res.status(404).json({ error: "Circle not found" });
  const json = await toCircleJson(row);
  const stats = await detailStatsFor(row.id, row.activity_label);
  const familiarMembers = req.resident ? await familiarMembersFor(row.id, req.resident.id) : 0;
  res.json({ ...json, ...stats, familiarMembers });
});

const MEMBERS_PREVIEW_LIMIT = 8;

// Members preview — public, name-only (mirrors routes/games.ts's own
// GET /:id/participants and its privacy reasoning exactly: never email/
// phone/exact address, just a name already exposed the same way as
// hostName on every circle response).
// ?full=1 returns every member instead of the preview cap — backs
// CircleMembersSection's "See all" (an expand, not a dead link to a
// members directory page that doesn't exist).
circlesRouter.get("/:id/members", async (req, res) => {
  const circle = (await db.prepare(`SELECT id FROM circles WHERE slug = ? OR id = ?`).get(req.params.id, req.params.id)) as { id: string } | undefined;
  if (!circle) return res.status(404).json({ error: "Circle not found" });
  // Mutual-block filter (post-audit hardening pass) — same rationale as
  // games.ts's /:id/participants. Unauthenticated viewers still get the
  // unfiltered list.
  const viewerId = req.resident?.id ?? null;
  const blockSubquery = `NOT IN (
    SELECT blocked_resident_id FROM blocked_residents WHERE blocker_resident_id = ?
    UNION
    SELECT blocker_resident_id FROM blocked_residents WHERE blocked_resident_id = ?
  )`;
  const countFilter = viewerId ? `AND resident_id ${blockSubquery}` : "";
  const listFilter = viewerId ? `AND cm.resident_id ${blockSubquery}` : "";
  const blockParams = viewerId ? [viewerId, viewerId] : [];
  const { n: total } = (await db
    .prepare(`SELECT COUNT(*) as n FROM circle_members WHERE circle_id = ? ${countFilter}`)
    .get(circle.id, ...blockParams)) as { n: number };
  const limit = req.query.full === "1" ? 2000 : MEMBERS_PREVIEW_LIMIT;
  const rows = (await db
    .prepare(
      `SELECT r.id as residentId, r.name, cm.role FROM circle_members cm
       JOIN residents r ON r.id = cm.resident_id
       WHERE cm.circle_id = ? ${listFilter}
       ORDER BY cm.role = 'organiser' DESC, r.name
       LIMIT ?`
    )
    .all(circle.id, ...blockParams, limit)) as { residentId: string; name: string; role: string }[];
  res.json({ members: rows, total });
});

// Upcoming games tagged to this circle's activity + area — Circles don't
// have their own event/session table; they surface from the existing Games
// model filtered by matching activity label, keeping "what's coming up"
// anchored to real participation instead of a separate events system.
// Shaped for CirclePlanCard.tsx (Circle Detail redesign §10/§11) — enough
// to show location/participation/availability/price without a second
// per-plan fetch, but deliberately not the full toGameJson shape (no host/
// solo-friendly/etc — this is a preview card, GameDetail is where the full
// plan experience lives; clicking through goes there).
circlesRouter.get("/:id/upcoming", async (req, res) => {
  const circle = (await db.prepare(`SELECT * FROM circles WHERE id = ?`).get(req.params.id)) as CircleRow | undefined;
  if (!circle) return res.status(404).json({ error: "Circle not found" });
  const today = new Date().toISOString().slice(0, 10);
  const rows = (await db
    .prepare(
      `SELECT g.id, g.activity_label as activityLabel, g.date, g.time, g.location_text as locationText, g.capacity, g.price_cents as priceCents,
              c.name as centreName,
              (SELECT COUNT(*) FROM game_participants gp WHERE gp.game_id = g.id AND gp.status = 'joined') as joined
       FROM games g LEFT JOIN centres c ON c.id = g.centre_id
       WHERE g.status IN ('open', 'pending_participants') AND g.date >= ? AND g.activity_label = ?
       ORDER BY g.date, g.time LIMIT 10`
    )
    .all(today, circle.activity_label)) as { id: string; activityLabel: string; date: string; time: string; locationText: string; capacity: number; priceCents: number | null; centreName: string | null; joined: number }[];
  res.json(rows.map((r) => ({ ...r, spotsLeft: computeCapacity(r.capacity, r.joined).spotsLeft ?? 0 })));
});

const RECENT_ACTIVITY_LIMIT = 3;

// "Recently in this Circle" (§20) — the last few completed games matching
// this Circle's activity, with a real attendance count. Not a social feed:
// activity-record rows only, derived from game_participants.attended
// (self-serve attendance confirmation, see routes/games.ts). A game with
// nobody's attendance confirmed yet is skipped rather than shown as "0
// attended", which would read as nobody showing up rather than "not yet
// confirmed".
circlesRouter.get("/:id/recent-activity", async (req, res) => {
  const circle = (await db.prepare(`SELECT activity_label FROM circles WHERE slug = ? OR id = ?`).get(req.params.id, req.params.id)) as
    | { activity_label: string }
    | undefined;
  if (!circle) return res.status(404).json({ error: "Circle not found" });
  if (!circle.activity_label) return res.json([]);
  const today = new Date().toISOString().slice(0, 10);
  const rows = (await db
    .prepare(
      `SELECT g.id, g.activity_label as activityLabel, g.date,
              (SELECT COUNT(*) FROM game_participants gp WHERE gp.game_id = g.id AND gp.attended = 1) as attended
       FROM games g
       WHERE g.activity_label = ? AND g.date < ? AND g.status != 'cancelled'
       ORDER BY g.date DESC LIMIT ?`
    )
    .all(circle.activity_label, today, RECENT_ACTIVITY_LIMIT * 3)) as { id: string; activityLabel: string; date: string; attended: number }[];
  res.json(rows.filter((r) => r.attended > 0).slice(0, RECENT_ACTIVITY_LIMIT));
});

const MOMENTS_LIMIT = 4;

// "Moments" (§18) — real photos, not a fabricated upload gallery. Circles
// have no photo table of their own, and every game sharing this Circle's
// activity label carries the *identical* seeded photo (activityImg() in
// seedBig.ts intentionally reuses one image per activity, "every Five-a-
// side Football game looks the same as every other one" — great for list
// cards, useless for a gallery, since it'd just repeat one image N times).
// The venue's own real, distinct gallery (centre_images — every seeded
// centre has several) is the honest source of actual photo variety here;
// falls back to nothing (section hidden) for a Circle with no linked venue.
circlesRouter.get("/:id/moments", async (req, res) => {
  const circle = (await db.prepare(`SELECT centre_id FROM circles WHERE slug = ? OR id = ?`).get(req.params.id, req.params.id)) as
    | { centre_id: string | null }
    | undefined;
  if (!circle) return res.status(404).json({ error: "Circle not found" });
  if (!circle.centre_id) return res.json([]);
  const rows = await db
    .prepare(`SELECT url as imageUrl FROM centre_images WHERE centre_id = ? ORDER BY sort_order LIMIT ?`)
    .all(circle.centre_id, MOMENTS_LIMIT);
  res.json(rows.map((r: { imageUrl: string }, i: number) => ({ id: `${circle.centre_id}-${i}`, imageUrl: r.imageUrl })));
});

// "Circle activity" (§26-28) — a real, period-scoped participation-
// intelligence card, not a social-feed activity log. Deliberately omits
// the reference concept's "photos shared" metric (no such thing is
// tracked anywhere in this app) rather than fabricating a number.
// `period` is real and functional (not a decorative dropdown) — each
// value recomputes against a genuinely different date window.
circlesRouter.get("/:id/activity", async (req, res) => {
  const circle = (await db.prepare(`SELECT id, activity_label FROM circles WHERE slug = ? OR id = ?`).get(req.params.id, req.params.id)) as
    | { id: string; activity_label: string }
    | undefined;
  if (!circle) return res.status(404).json({ error: "Circle not found" });

  const period = req.query.period === "month" ? "month" : "week";
  const now = new Date();
  const start = new Date(now);
  if (period === "week") start.setUTCDate(now.getUTCDate() - 7);
  else start.setUTCMonth(now.getUTCMonth() - 1);
  const startStr = start.toISOString().slice(0, 19).replace("T", " ");
  const startDate = start.toISOString().slice(0, 10);
  const today = now.toISOString().slice(0, 10);

  if (!circle.activity_label) {
    const { n: newMembers } = (await db.prepare(`SELECT COUNT(*) as n FROM circle_members WHERE circle_id = ? AND joined_at >= ?`).get(circle.id, startStr)) as { n: number };
    return res.json({ period, newMembers, plansCreated: 0, participants: 0 });
  }

  const [{ n: newMembers }, { n: plansCreated }, { n: participants }] = await Promise.all([
    db.prepare(`SELECT COUNT(*) as n FROM circle_members WHERE circle_id = ? AND joined_at >= ?`).get(circle.id, startStr) as Promise<{ n: number }>,
    db.prepare(`SELECT COUNT(*) as n FROM games WHERE activity_label = ? AND created_at >= ?`).get(circle.activity_label, startStr) as Promise<{ n: number }>,
    // "Participated" means the plan actually happened — bounded to the
    // past, not open-ended into future bookings, which would double as an
    // upcoming-plans count instead of a real participation signal.
    db
      .prepare(
        `SELECT COUNT(DISTINCT gp.resident_id) as n FROM game_participants gp
         JOIN games g ON g.id = gp.game_id
         WHERE g.activity_label = ? AND gp.status = 'joined' AND g.date >= ? AND g.date <= ?`
      )
      .get(circle.activity_label, startDate, today) as Promise<{ n: number }>,
  ]);
  res.json({ period, newMembers, plansCreated, participants });
});

interface CreateCircleInput {
  name: string;
  activityLabel?: string;
  area?: string;
  county?: string;
  about?: string;
  centreId?: string;
  whatWeDo?: string;
  whoCanJoin?: string;
  values?: string;
}

circlesRouter.post("/", requireResident, async (req, res) => {
  const b = req.body as CreateCircleInput;
  if (!b.name) return res.status(400).json({ error: "A name is required" });
  const id = crypto.randomUUID();
  const slug = await generateSlug("circles", b.name);
  await db.transaction(async (tx) => {
    await tx
      .prepare(
        `INSERT INTO circles (id, name, activity_label, area, county, about, centre_id, created_by_resident_id, slug, what_we_do, who_can_join, circle_values)
         VALUES (@id, @name, @activityLabel, @area, @county, @about, @centreId, @createdByResidentId, @slug, @whatWeDo, @whoCanJoin, @values)`
      )
      .run({
        id,
        name: b.name,
        activityLabel: b.activityLabel ?? "",
        area: b.area ?? "",
        county: b.county ?? "",
        about: b.about ?? "",
        centreId: b.centreId ?? null,
        createdByResidentId: req.resident!.id,
        slug,
        whatWeDo: b.whatWeDo || null,
        whoCanJoin: b.whoCanJoin || null,
        values: b.values || null,
      });
    await tx.prepare(`INSERT INTO circle_members (circle_id, resident_id, role) VALUES (?, ?, 'organiser')`).run(id, req.resident!.id);
  });
  res.status(201).json({ id, slug });
});

circlesRouter.post("/:id/join", requireResident, async (req, res) => {
  await db.prepare(`INSERT IGNORE INTO circle_members (circle_id, resident_id) VALUES (?, ?)`).run(req.params.id, req.resident!.id);
  void logEvent("circle_joined", { residentId: req.resident!.id, metadata: { circleId: req.params.id } });
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
