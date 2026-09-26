import { Router, type Request, type Response } from "express";
import { orgVendorIds } from "../auth.js";
import { db } from "../db/index.js";
import { ASSUMED_DURATION_MINUTES } from "../db/queries.js";
import { irelandTodayIso, irelandWallTimeToUtc } from "../irelandTime.js";

export const chatRouter = Router();

// Participation Chat — polling, not WebSocket (no real-time layer exists
// anywhere else in this stack, and current traffic doesn't justify one).
// One table (chat_messages), five kinds of conversation:
//   game              — temporary: opens 24h before, archives a few hours after
//   circle            — persistent, members only
//   experience_session — one per departure, same window as a game
//   program           — everyone enrolled, read-only once the program has ended
//   club              — everyone registered, persistent
// Membership is derived live from each participation table (never copied
// onto chat_messages). Residents match by account or by the email they
// booked with, so a booking made before signing in still counts.
//
// The provider behind an experience/program/club can read and post in its
// chats as the "Host" (a vendor session, org-scoped via orgVendorIds). Club
// chats are between account holders — parents/guardians and adult members
// — never the children a registration may be for, and the host is always
// present; every message can be reported.

const CHAT_OPENS_BEFORE_MS = 24 * 60 * 60 * 1000;
const CHAT_ARCHIVES_AFTER_MS = 6 * 60 * 60 * 1000;
const PROGRAM_READONLY_AFTER_DAYS = 2;
const MAX_MESSAGE_LENGTH = 2000;

export const SCOPE_TYPES = ["game", "circle", "experience_session", "program", "club"] as const;
export type ScopeType = (typeof SCOPE_TYPES)[number];
const isScopeType = (v: string): v is ScopeType => (SCOPE_TYPES as readonly string[]).includes(v);

type Actor =
  | { kind: "resident"; id: string; email: string; name: string }
  | { kind: "host"; userId: string; vendorIds: string[]; name: string };

const readerKey = (a: Actor) => (a.kind === "resident" ? `r:${a.id}` : `u:${a.userId}`);

interface MembershipCheck {
  allowed: boolean;
  canPost: boolean;
  postBlockedReason?: string;
  opensAt?: string;
  archivesAt?: string;
}

function windowCheck(date: string, time: string, durationMinutes: number, cancelled: boolean, what: string): MembershipCheck {
  const [hour, minute] = time.split(":").map(Number);
  const start = irelandWallTimeToUtc(date, hour, minute);
  const opensAt = new Date(start.getTime() - CHAT_OPENS_BEFORE_MS);
  const archivesAt = new Date(start.getTime() + durationMinutes * 60000 + CHAT_ARCHIVES_AFTER_MS);
  const now = Date.now();
  const times = { opensAt: opensAt.toISOString(), archivesAt: archivesAt.toISOString() };
  if (cancelled) return { allowed: true, canPost: false, postBlockedReason: `This ${what} was cancelled.` };
  if (now < opensAt.getTime()) return { allowed: true, canPost: false, postBlockedReason: `Chat opens 24 hours before the ${what}.`, ...times };
  if (now > archivesAt.getTime()) return { allowed: true, canPost: false, postBlockedReason: "This chat has been archived.", ...times };
  return { allowed: true, canPost: true, ...times };
}

const NOT_ALLOWED: MembershipCheck = { allowed: false, canPost: false };

// --- membership per scope --------------------------------------------------

async function checkGame(gameId: string, actor: Actor): Promise<MembershipCheck | null> {
  const row = (await db.prepare(`SELECT host_resident_id, date, time, status FROM games WHERE id = ?`).get(gameId)) as
    | { host_resident_id: string; date: string; time: string; status: string }
    | undefined;
  if (!row) return null;
  if (actor.kind !== "resident") return NOT_ALLOWED;
  const isParticipant =
    row.host_resident_id === actor.id ||
    !!(await db.prepare(`SELECT id FROM game_participants WHERE game_id = ? AND resident_id = ? AND status = 'joined'`).get(gameId, actor.id));
  if (!isParticipant) return NOT_ALLOWED;
  return windowCheck(row.date, row.time, ASSUMED_DURATION_MINUTES.game, row.status === "cancelled", "session");
}

async function checkCircle(circleId: string, actor: Actor): Promise<MembershipCheck | null> {
  const circle = (await db.prepare(`SELECT status FROM circles WHERE id = ?`).get(circleId)) as { status: string } | undefined;
  if (!circle) return null;
  if (actor.kind !== "resident") return NOT_ALLOWED;
  const isMember = !!(await db.prepare(`SELECT id FROM circle_members WHERE circle_id = ? AND resident_id = ?`).get(circleId, actor.id));
  if (!isMember) return NOT_ALLOWED;
  // A closed Circle is read-only history, not deleted.
  if (circle.status === "closed") return { allowed: true, canPost: false, postBlockedReason: "This Circle is closed — chat is read-only now." };
  return { allowed: true, canPost: true };
}

async function checkExperienceSession(sessionId: string, actor: Actor): Promise<MembershipCheck | null> {
  const row = (await db
    .prepare(
      `SELECT es.date, es.time, es.status, e.vendor_id as vendorId, e.duration_minutes as duration
       FROM experience_sessions es JOIN experiences e ON e.id = es.experience_id WHERE es.id = ?`
    )
    .get(sessionId)) as { date: string; time: string; status: string; vendorId: string; duration: number } | undefined;
  if (!row) return null;
  if (actor.kind === "host") {
    if (!actor.vendorIds.includes(row.vendorId)) return NOT_ALLOWED;
  } else {
    const booked = await db
      .prepare(
        `SELECT 1 FROM experience_bookings WHERE session_id = ? AND payment_status = 'paid' AND status != 'cancelled'
           AND (resident_id = ? OR LOWER(email) = LOWER(?)) LIMIT 1`
      )
      .get(sessionId, actor.id, actor.email);
    if (!booked) return NOT_ALLOWED;
  }
  return windowCheck(row.date, row.time, row.duration || 120, row.status === "cancelled", "session");
}

async function checkProgram(programId: string, actor: Actor): Promise<MembershipCheck | null> {
  const p = (await db
    .prepare(
      `SELECT p.vendor_id as vendorId, p.status,
              (SELECT MAX(ps.date) FROM program_sessions ps WHERE ps.program_id = p.id AND ps.status != 'cancelled') as lastDate
       FROM programs p WHERE p.id = ?`
    )
    .get(programId)) as { vendorId: string; status: string; lastDate: string | null } | undefined;
  if (!p) return null;
  if (actor.kind === "host") {
    if (!actor.vendorIds.includes(p.vendorId)) return NOT_ALLOWED;
  } else {
    const enrolled = await db
      .prepare(
        `SELECT 1 FROM program_enrollments WHERE program_id = ? AND payment_status = 'paid' AND status != 'cancelled'
           AND (resident_id = ? OR LOWER(email) = LOWER(?)) LIMIT 1`
      )
      .get(programId, actor.id, actor.email);
    if (!enrolled) return NOT_ALLOWED;
  }
  if (p.status === "archived") return { allowed: true, canPost: false, postBlockedReason: "This program has been archived — chat is read-only now." };
  if (p.lastDate) {
    const cutoff = new Date(`${p.lastDate}T12:00:00Z`);
    cutoff.setUTCDate(cutoff.getUTCDate() + PROGRAM_READONLY_AFTER_DAYS);
    if (cutoff.toISOString().slice(0, 10) < irelandTodayIso()) return { allowed: true, canPost: false, postBlockedReason: "This program has finished — chat is read-only now." };
  }
  return { allowed: true, canPost: true };
}

async function checkClub(clubId: string, actor: Actor): Promise<MembershipCheck | null> {
  const c = (await db.prepare(`SELECT vendor_id as vendorId, status FROM clubs WHERE id = ?`).get(clubId)) as { vendorId: string | null; status: string } | undefined;
  if (!c) return null;
  if (actor.kind === "host") {
    if (!c.vendorId || !actor.vendorIds.includes(c.vendorId)) return NOT_ALLOWED;
  } else {
    const registered = await db
      .prepare(
        `SELECT 1 FROM registrations WHERE club_id = ? AND payment_status = 'paid' AND status != 'cancelled'
           AND (resident_id = ? OR LOWER(email) = LOWER(?)) LIMIT 1`
      )
      .get(clubId, actor.id, actor.email);
    if (!registered) return NOT_ALLOWED;
  }
  if (c.status !== "approved") return { allowed: true, canPost: false, postBlockedReason: "This club isn't active right now — chat is read-only." };
  return { allowed: true, canPost: true };
}

async function checkScope(scopeType: ScopeType, scopeId: string, actor: Actor): Promise<MembershipCheck | null> {
  switch (scopeType) {
    case "game":
      return checkGame(scopeId, actor);
    case "circle":
      return checkCircle(scopeId, actor);
    case "experience_session":
      return checkExperienceSession(scopeId, actor);
    case "program":
      return checkProgram(scopeId, actor);
    case "club":
      return checkClub(scopeId, actor);
  }
}

// --- who's asking ------------------------------------------------------------

async function hostActor(req: Request): Promise<Actor | null> {
  const u = req.user;
  if (!u || u.role !== "vendor" || u.status !== "approved") return null;
  return { kind: "host", userId: u.id, vendorIds: await orgVendorIds(u), name: u.businessName || u.name };
}

function residentActor(req: Request): Actor | null {
  const r = req.resident;
  return r ? { kind: "resident", id: r.id, email: r.email, name: r.name } : null;
}

/** A browser can hold both a resident and a vendor session (HelloCircle
 * Manage). Try the resident first, then the host; the first one allowed in
 * wins. 401 when neither session exists. */
async function resolve(req: Request, res: Response, scopeType: ScopeType, scopeId: string): Promise<{ actor: Actor; membership: MembershipCheck } | null> {
  const candidates = [residentActor(req), await hostActor(req)].filter((a): a is Actor => !!a);
  if (!candidates.length) {
    res.status(401).json({ error: "Sign in to chat" });
    return null;
  }
  let found = false;
  for (const actor of candidates) {
    const membership = await checkScope(scopeType, scopeId, actor);
    if (!membership) continue;
    found = true;
    if (membership.allowed) return { actor, membership };
  }
  res.status(found ? 403 : 404).json({ error: found ? "You're not part of this conversation" : "Not found" });
  return null;
}

// --- messages ------------------------------------------------------------------

async function loadMessages(scopeType: ScopeType, scopeId: string, actor: Actor, after: number) {
  // Mutual blocks only apply between residents; host messages always show.
  const viewerId = actor.kind === "resident" ? actor.id : "";
  const rows = (await db
    .prepare(
      `SELECT cm.id, cm.resident_id as residentId, cm.author_user_id as authorUserId,
              COALESCE(NULLIF(u.business_name, ''), u.name, r.name) as residentName, cm.body, cm.created_at as createdAt
       FROM chat_messages cm
       LEFT JOIN residents r ON r.id = cm.resident_id
       LEFT JOIN users u ON u.id = cm.author_user_id
       WHERE cm.scope_type = ? AND cm.scope_id = ? AND cm.id > ?
         AND (cm.author_user_id IS NOT NULL OR cm.resident_id NOT IN (
           SELECT blocked_resident_id FROM blocked_residents WHERE blocker_resident_id = ?
           UNION
           SELECT blocker_resident_id FROM blocked_residents WHERE blocked_resident_id = ?
         ))
       ORDER BY cm.id ASC LIMIT 200`
    )
    .all(scopeType, scopeId, after, viewerId, viewerId)) as {
    id: number; residentId: string; authorUserId: string | null; residentName: string | null; body: string; createdAt: string;
  }[];
  return rows.map((m) => ({
    id: m.id,
    residentId: m.residentId,
    residentName: m.residentName || (m.authorUserId ? "Host" : "A resident"),
    body: m.body,
    createdAt: m.createdAt,
    authorType: m.authorUserId ? "host" : "resident",
    isMine: actor.kind === "resident" ? !m.authorUserId && m.residentId === actor.id : m.authorUserId === actor.userId,
  }));
}

async function markRead(scopeType: ScopeType, scopeId: string, actor: Actor) {
  await db
    .prepare(
      `INSERT INTO chat_reads (reader_key, scope_type, scope_id, last_read_id)
       SELECT ?, ?, ?, COALESCE(MAX(id), 0) FROM chat_messages WHERE scope_type = ? AND scope_id = ?
       ON DUPLICATE KEY UPDATE last_read_id = GREATEST(last_read_id, VALUES(last_read_id)), updated_at = NOW()`
    )
    .run(readerKey(actor), scopeType, scopeId, scopeType, scopeId);
}

chatRouter.get("/:scopeType/:scopeId/messages", async (req, res) => {
  const { scopeType, scopeId } = req.params;
  if (!isScopeType(scopeType)) return res.status(400).json({ error: "Unknown chat scope" });
  const resolved = await resolve(req, res, scopeType, scopeId);
  if (!resolved) return;
  const after = typeof req.query.after === "string" ? parseInt(req.query.after, 10) : 0;
  const messages = await loadMessages(scopeType, scopeId, resolved.actor, Number.isFinite(after) ? after : 0);
  await markRead(scopeType, scopeId, resolved.actor);
  const m = resolved.membership;
  res.json({
    messages,
    canPost: m.canPost,
    postBlockedReason: m.postBlockedReason,
    opensAt: m.opensAt,
    archivesAt: m.archivesAt,
    viewerRole: resolved.actor.kind,
  });
});

chatRouter.post("/:scopeType/:scopeId/messages", async (req, res) => {
  const { scopeType, scopeId } = req.params;
  if (!isScopeType(scopeType)) return res.status(400).json({ error: "Unknown chat scope" });
  const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
  if (!body) return res.status(400).json({ error: "Message can't be empty" });
  if (body.length > MAX_MESSAGE_LENGTH) return res.status(400).json({ error: `Message is too long (max ${MAX_MESSAGE_LENGTH} characters)` });

  const resolved = await resolve(req, res, scopeType, scopeId);
  if (!resolved) return;
  if (!resolved.membership.canPost) return res.status(409).json({ error: resolved.membership.postBlockedReason || "This chat isn't open right now" });
  const { actor } = resolved;

  const info = await db
    .prepare(`INSERT INTO chat_messages (scope_type, scope_id, resident_id, author_user_id, body) VALUES (?, ?, ?, ?, ?)`)
    .run(scopeType, scopeId, actor.kind === "resident" ? actor.id : "", actor.kind === "host" ? actor.userId : null, body);
  await markRead(scopeType, scopeId, actor);

  res.status(201).json({
    id: info.lastInsertRowid,
    residentId: actor.kind === "resident" ? actor.id : "",
    residentName: actor.name,
    body,
    createdAt: new Date().toISOString(),
    authorType: actor.kind,
    isMine: true,
  });
});

// Report a message (safeguarding — especially club chats). Only someone who
// can see the conversation can report in it. Lands in the existing reports
// queue admins already review.
chatRouter.post("/messages/:id/report", async (req, res) => {
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 1000) : "";
  if (!reason) return res.status(400).json({ error: "Tell us what's wrong" });
  const msg = (await db.prepare(`SELECT scope_type as scopeType, scope_id as scopeId FROM chat_messages WHERE id = ?`).get(req.params.id)) as
    | { scopeType: string; scopeId: string }
    | undefined;
  if (!msg || !isScopeType(msg.scopeType)) return res.status(404).json({ error: "Message not found" });
  const resolved = await resolve(req, res, msg.scopeType, msg.scopeId);
  if (!resolved) return;
  await db
    .prepare(`INSERT INTO reports (target_type, target_id, reporter_client_id, reason) VALUES ('chat_message', ?, ?, ?)`)
    .run(req.params.id, readerKey(resolved.actor), reason);
  res.status(201).json({ ok: true });
});

// --- inbox ------------------------------------------------------------------------

interface InboxScope {
  scopeType: ScopeType;
  scopeId: string;
  /** The listing the chat belongs to (the experience for a departure, else the scope itself). */
  listingId: string;
  title: string;
  subtitle: string;
  href: string;
}

async function residentScopes(a: Extract<Actor, { kind: "resident" }>): Promise<InboxScope[]> {
  const recent = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
  const [games, circles, sessions, programs, clubs] = await Promise.all([
    db
      .prepare(
        `SELECT g.id, g.activity_label as title, g.date, g.time FROM games g
         WHERE g.date >= ? AND (g.host_resident_id = ? OR EXISTS (SELECT 1 FROM game_participants gp WHERE gp.game_id = g.id AND gp.resident_id = ? AND gp.status = 'joined'))`
      )
      .all(recent, a.id, a.id) as Promise<{ id: string; title: string; date: string; time: string }[]>,
    db
      .prepare(`SELECT c.id, c.name as title, c.slug FROM circles c JOIN circle_members cm ON cm.circle_id = c.id WHERE cm.resident_id = ?`)
      .all(a.id) as Promise<{ id: string; title: string; slug: string | null }[]>,
    db
      .prepare(
        `SELECT DISTINCT es.id, e.title, e.slug, e.id as experienceId, es.date, es.time FROM experience_bookings eb
         JOIN experience_sessions es ON es.id = eb.session_id JOIN experiences e ON e.id = eb.experience_id
         WHERE eb.payment_status = 'paid' AND eb.status != 'cancelled' AND es.date >= ? AND (eb.resident_id = ? OR LOWER(eb.email) = LOWER(?))`
      )
      .all(recent, a.id, a.email) as Promise<{ id: string; title: string; slug: string | null; experienceId: string; date: string; time: string }[]>,
    db
      .prepare(
        `SELECT DISTINCT p.id, p.title FROM program_enrollments pe JOIN programs p ON p.id = pe.program_id
         WHERE pe.payment_status = 'paid' AND pe.status != 'cancelled' AND p.status != 'archived' AND (pe.resident_id = ? OR LOWER(pe.email) = LOWER(?))`
      )
      .all(a.id, a.email) as Promise<{ id: string; title: string }[]>,
    db
      .prepare(
        `SELECT DISTINCT c.id, c.name as title, c.slug FROM registrations r JOIN clubs c ON c.id = r.club_id
         WHERE r.payment_status = 'paid' AND r.status != 'cancelled' AND (r.resident_id = ? OR LOWER(r.email) = LOWER(?))`
      )
      .all(a.id, a.email) as Promise<{ id: string; title: string; slug: string | null }[]>,
  ]);
  return [
    ...games.map((g) => ({ scopeType: "game" as const, scopeId: g.id, listingId: g.id, title: g.title, subtitle: `Session · ${g.date} ${g.time}`, href: `/games/${g.id}` })),
    ...circles.map((c) => ({ scopeType: "circle" as const, scopeId: c.id, listingId: c.id, title: c.title, subtitle: "Circle", href: `/circles/${c.slug ?? c.id}` })),
    ...sessions.map((s) => ({ scopeType: "experience_session" as const, scopeId: s.id, listingId: s.experienceId, title: s.title, subtitle: `Departure · ${s.date} ${s.time}`, href: `/experiences/${s.slug ?? s.experienceId}` })),
    ...programs.map((p) => ({ scopeType: "program" as const, scopeId: p.id, listingId: p.id, title: p.title, subtitle: "Program group", href: `/programs/${p.id}` })),
    ...clubs.map((c) => ({ scopeType: "club" as const, scopeId: c.id, listingId: c.id, title: c.title, subtitle: "Club members", href: `/clubs/${c.slug ?? c.id}` })),
  ];
}

async function hostScopes(a: Extract<Actor, { kind: "host" }>): Promise<InboxScope[]> {
  if (!a.vendorIds.length) return [];
  const marks = a.vendorIds.map(() => "?").join(", ");
  const recent = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
  const [sessions, programs, clubs] = await Promise.all([
    db
      .prepare(
        `SELECT es.id, e.title, e.slug, e.id as experienceId, es.date, es.time FROM experience_sessions es JOIN experiences e ON e.id = es.experience_id
         WHERE e.vendor_id IN (${marks}) AND es.date >= ?
           AND EXISTS (SELECT 1 FROM experience_bookings eb WHERE eb.session_id = es.id AND eb.payment_status = 'paid' AND eb.status != 'cancelled')`
      )
      .all(...a.vendorIds, recent) as Promise<{ id: string; title: string; slug: string | null; experienceId: string; date: string; time: string }[]>,
    db
      .prepare(
        `SELECT p.id, p.title FROM programs p WHERE p.vendor_id IN (${marks}) AND p.status != 'archived'
           AND EXISTS (SELECT 1 FROM program_enrollments pe WHERE pe.program_id = p.id AND pe.payment_status = 'paid' AND pe.status != 'cancelled')`
      )
      .all(...a.vendorIds) as Promise<{ id: string; title: string }[]>,
    db
      .prepare(
        `SELECT c.id, c.name as title, c.slug FROM clubs c WHERE c.vendor_id IN (${marks})
           AND EXISTS (SELECT 1 FROM registrations r WHERE r.club_id = c.id AND r.payment_status = 'paid' AND r.status != 'cancelled')`
      )
      .all(...a.vendorIds) as Promise<{ id: string; title: string; slug: string | null }[]>,
  ]);
  return [
    ...sessions.map((s) => ({ scopeType: "experience_session" as const, scopeId: s.id, listingId: s.experienceId, title: s.title, subtitle: `Departure · ${s.date} ${s.time}`, href: `/experiences/${s.slug ?? s.experienceId}` })),
    ...programs.map((p) => ({ scopeType: "program" as const, scopeId: p.id, listingId: p.id, title: p.title, subtitle: "Program group", href: `/programs/${p.id}` })),
    ...clubs.map((c) => ({ scopeType: "club" as const, scopeId: c.id, listingId: c.id, title: c.title, subtitle: "Club members", href: `/clubs/${c.slug ?? c.id}` })),
  ];
}

async function buildInbox(actor: Actor) {
  const scopes = actor.kind === "resident" ? await residentScopes(actor) : await hostScopes(actor);
  const key = readerKey(actor);
  const items = await Promise.all(
    scopes.map(async (s) => {
      const last = (await db
        .prepare(
          `SELECT cm.id, cm.body, cm.created_at as createdAt, COALESCE(NULLIF(u.business_name, ''), u.name, r.name) as authorName
           FROM chat_messages cm LEFT JOIN residents r ON r.id = cm.resident_id LEFT JOIN users u ON u.id = cm.author_user_id
           WHERE cm.scope_type = ? AND cm.scope_id = ? ORDER BY cm.id DESC LIMIT 1`
        )
        .get(s.scopeType, s.scopeId)) as { id: number; body: string; createdAt: string; authorName: string | null } | undefined;
      let unread = 0;
      if (last) {
        const mineClause = actor.kind === "resident" ? "NOT (cm.author_user_id IS NULL AND cm.resident_id = ?)" : "NOT (cm.author_user_id <=> ?)";
        const { n } = (await db
          .prepare(
            `SELECT COUNT(*) as n FROM chat_messages cm
             WHERE cm.scope_type = ? AND cm.scope_id = ? AND ${mineClause}
               AND cm.id > COALESCE((SELECT last_read_id FROM chat_reads WHERE reader_key = ? AND scope_type = ? AND scope_id = ?), 0)`
          )
          .get(s.scopeType, s.scopeId, actor.kind === "resident" ? actor.id : actor.userId, key, s.scopeType, s.scopeId)) as { n: number | string };
        unread = Number(n);
      }
      return { ...s, lastMessage: last ? { body: last.body, authorName: last.authorName ?? "", createdAt: last.createdAt } : null, unread };
    })
  );
  items.sort((a, b) => {
    const at = a.lastMessage?.createdAt ?? "";
    const bt = b.lastMessage?.createdAt ?? "";
    return bt.localeCompare(at);
  });
  return items;
}

/** GET /chat/mine?as=host — every conversation the caller is in, newest
 * activity first, with unread counts. `as=host` asks for the vendor view
 * when a browser holds both sessions. */
chatRouter.get("/mine", async (req, res) => {
  const actor = req.query.as === "host" ? await hostActor(req) : residentActor(req) ?? (await hostActor(req));
  if (!actor) return res.status(401).json({ error: "Sign in to see your chats" });
  const items = await buildInbox(actor);
  res.json({ items, unread: items.reduce((n, i) => n + i.unread, 0), viewerRole: actor.kind });
});
