import { Router } from "express";
import { db } from "../db/index.js";
import { ASSUMED_DURATION_MINUTES } from "../db/queries.js";
import { irelandWallTimeToUtc } from "../irelandTime.js";
import { requireResident } from "../residents.js";

export const chatRouter = Router();
chatRouter.use(requireResident);

// Participation Chat (implementation plan Phase 11) — the one
// differentiator needing genuinely new infrastructure (no WebSocket/
// real-time layer exists anywhere else in this stack). Deliberately
// polling, not socket.io: current traffic doesn't justify an always-on
// connection layer, matching the plan doc's own stated recommendation.
// Two scopes, one table (chat_messages): 'game' (temporary — opens 24h
// before the game, archives some hours after) and 'circle' (persistent,
// no window). Membership is derived live from game_participants/
// circle_members, not duplicated onto chat_messages itself.

const CHAT_OPENS_BEFORE_MS = 24 * 60 * 60 * 1000;
const CHAT_ARCHIVES_AFTER_MS = 6 * 60 * 60 * 1000;
const MAX_MESSAGE_LENGTH = 2000;

type ScopeType = "game" | "circle";

interface MembershipCheck {
  allowed: boolean;
  canPost: boolean;
  postBlockedReason?: string;
  opensAt?: string;
  archivesAt?: string;
}

async function checkGameMembership(gameId: string, residentId: string): Promise<MembershipCheck | null> {
  const row = (await db.prepare(`SELECT host_resident_id, date, time, status FROM games WHERE id = ?`).get(gameId)) as
    | { host_resident_id: string; date: string; time: string; status: string }
    | undefined;
  if (!row) return null;

  const isHost = row.host_resident_id === residentId;
  const isParticipant = isHost || !!(await db.prepare(`SELECT id FROM game_participants WHERE game_id = ? AND resident_id = ? AND status = 'joined'`).get(gameId, residentId));
  if (!isParticipant) return { allowed: false, canPost: false };

  const [hour, minute] = row.time.split(":").map(Number);
  const start = irelandWallTimeToUtc(row.date, hour, minute);
  const opensAt = new Date(start.getTime() - CHAT_OPENS_BEFORE_MS);
  const archivesAt = new Date(start.getTime() + ASSUMED_DURATION_MINUTES.game * 60000 + CHAT_ARCHIVES_AFTER_MS);
  const now = Date.now();

  if (row.status === "cancelled") return { allowed: true, canPost: false, postBlockedReason: "This session was cancelled." };
  if (now < opensAt.getTime()) return { allowed: true, canPost: false, postBlockedReason: "Chat opens 24 hours before the session.", opensAt: opensAt.toISOString(), archivesAt: archivesAt.toISOString() };
  if (now > archivesAt.getTime()) return { allowed: true, canPost: false, postBlockedReason: "This chat has been archived.", opensAt: opensAt.toISOString(), archivesAt: archivesAt.toISOString() };
  return { allowed: true, canPost: true, opensAt: opensAt.toISOString(), archivesAt: archivesAt.toISOString() };
}

async function checkCircleMembership(circleId: string, residentId: string): Promise<MembershipCheck | null> {
  const exists = await db.prepare(`SELECT id FROM circles WHERE id = ?`).get(circleId);
  if (!exists) return null;
  const isMember = !!(await db.prepare(`SELECT id FROM circle_members WHERE circle_id = ? AND resident_id = ?`).get(circleId, residentId));
  if (!isMember) return { allowed: false, canPost: false };
  return { allowed: true, canPost: true };
}

async function checkMembership(scopeType: ScopeType, scopeId: string, residentId: string): Promise<MembershipCheck | null> {
  return scopeType === "game" ? checkGameMembership(scopeId, residentId) : checkCircleMembership(scopeId, residentId);
}

chatRouter.get("/:scopeType/:scopeId/messages", async (req, res) => {
  const scopeType = req.params.scopeType as ScopeType;
  if (scopeType !== "game" && scopeType !== "circle") return res.status(400).json({ error: "Unknown chat scope" });

  const membership = await checkMembership(scopeType, req.params.scopeId, req.resident!.id);
  if (!membership) return res.status(404).json({ error: "Not found" });
  if (!membership.allowed) return res.status(403).json({ error: "You're not part of this conversation" });

  const after = typeof req.query.after === "string" ? parseInt(req.query.after, 10) : 0;
  // Mutual-block filter (post-audit hardening pass) — checkGameMembership/
  // checkCircleMembership only check the requester's own participation, not
  // the other party, so blocking is enforced here at read time instead:
  // hide messages from anyone the viewer has blocked or been blocked by.
  const viewerId = req.resident!.id;
  const rows = await db
    .prepare(
      `SELECT cm.id, cm.resident_id as residentId, r.name as residentName, cm.body, cm.created_at as createdAt
       FROM chat_messages cm JOIN residents r ON r.id = cm.resident_id
       WHERE cm.scope_type = ? AND cm.scope_id = ? AND cm.id > ?
         AND cm.resident_id NOT IN (
           SELECT blocked_resident_id FROM blocked_residents WHERE blocker_resident_id = ?
           UNION
           SELECT blocker_resident_id FROM blocked_residents WHERE blocked_resident_id = ?
         )
       ORDER BY cm.id ASC LIMIT 200`
    )
    .all(scopeType, req.params.scopeId, Number.isFinite(after) ? after : 0, viewerId, viewerId);

  res.json({
    messages: rows,
    canPost: membership.canPost,
    postBlockedReason: membership.postBlockedReason,
    opensAt: membership.opensAt,
    archivesAt: membership.archivesAt,
  });
});

chatRouter.post("/:scopeType/:scopeId/messages", async (req, res) => {
  const scopeType = req.params.scopeType as ScopeType;
  if (scopeType !== "game" && scopeType !== "circle") return res.status(400).json({ error: "Unknown chat scope" });

  const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
  if (!body) return res.status(400).json({ error: "Message can't be empty" });
  if (body.length > MAX_MESSAGE_LENGTH) return res.status(400).json({ error: `Message is too long (max ${MAX_MESSAGE_LENGTH} characters)` });

  const membership = await checkMembership(scopeType, req.params.scopeId, req.resident!.id);
  if (!membership) return res.status(404).json({ error: "Not found" });
  if (!membership.allowed) return res.status(403).json({ error: "You're not part of this conversation" });
  if (!membership.canPost) return res.status(409).json({ error: membership.postBlockedReason || "This chat isn't open right now" });

  const info = await db
    .prepare(`INSERT INTO chat_messages (scope_type, scope_id, resident_id, body) VALUES (?, ?, ?, ?)`)
    .run(scopeType, req.params.scopeId, req.resident!.id, body);

  res.status(201).json({
    id: info.lastInsertRowid,
    residentId: req.resident!.id,
    residentName: req.resident!.name,
    body,
    createdAt: new Date().toISOString(),
  });
});
