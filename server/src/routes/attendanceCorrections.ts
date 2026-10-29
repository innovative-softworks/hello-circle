import { Router, type Request, type Response } from "express";
import { scheduleReviewInvitation } from "../myLifePlans.js";
import { flagReviewsAfterAttendanceChange } from "../reviewAttendanceFlags.js";
import { requireAdminPermission } from "../adminPermissions.js";
import { writeAudit } from "../audit.js";
import { hasPlatformRole, orgVendorIds } from "../auth.js";
import { db } from "../db/index.js";
import { irelandTodayIso } from "../irelandTime.js";
import { notifyResident } from "../notifications.js";
import { requireResident } from "../residents.js";
import { BadRequestError, clientIdFrom } from "../util.js";

// Trust & Retention batch 1 — attendance corrections, and Session hosts
// recording who came.
//
// Reviews (reviewEligibility.ts) rest on attendance, so a wrong record has to
// be fixable. A participant asks for a correction on one of their own past,
// uncancelled places that is marked as a no-show or has no record; the
// organiser who owns it (the partner's organisation, or the Session host)
// accepts — which writes attendance as present, source 'correction' — or
// declines with a note the participant sees. A declined request can be taken
// to HelloCircle through the complaints process; support admins can decide
// any request (adminAttendanceRouter). One open request per place (open_key).
// Nothing here touches payments.

export const CORRECTION_KINDS = ["booking", "registration", "experience", "program_session", "game"] as const;
type CorrectionKind = (typeof CORRECTION_KINDS)[number];
const isKind = (v: unknown): v is CorrectionKind => typeof v === "string" && (CORRECTION_KINDS as readonly string[]).includes(v);

const NOTE_MIN = 10;
const NOTE_MAX = 1500;

interface Place {
  /** The attendance-table key for this place. */
  attendanceKind: string;
  attendanceRef: string;
  date: string;
  label: string;
  ownerVendorId: string | null;
  ownerHostResidentId: string | null;
  /** Which partner role may record attendance for it. */
  role: string;
}

/** Finds the participant's own past, uncancelled place, or null. */
async function ownPlace(kind: CorrectionKind, ref: string, clientId: string | null, residentId: string | null, email: string | null = null): Promise<Place | null> {
  const today = irelandTodayIso();
  const own = (alias: string) => {
    const parts: string[] = [];
    const params: string[] = [];
    if (clientId) (parts.push(`${alias}.client_id = ?`), params.push(clientId));
    if (residentId) (parts.push(`${alias}.resident_id = ?`), params.push(residentId));
    // A magic-link-verified email owns the bookings made under it (as in "My bookings").
    if (email) (parts.push(`LOWER(${alias}.email) = LOWER(?)`), params.push(email));
    return { sql: parts.length ? `(${parts.join(" OR ")})` : "1 = 0", params };
  };
  type R = { date: string; label: string; vendorId: string | null } | undefined;
  if (kind === "booking") {
    const o = own("b");
    const r = (await db
      .prepare(`SELECT b.date, c.name as label, c.vendor_id as vendorId FROM bookings b JOIN centres c ON c.id = b.centre_id WHERE b.ref = ? AND ${o.sql} AND b.status != 'cancelled' AND b.payment_status = 'paid' AND b.date < ?`)
      .get(ref, ...o.params, today)) as R;
    return r ? { attendanceKind: "booking", attendanceRef: ref, date: r.date, label: r.label, ownerVendorId: r.vendorId, ownerHostResidentId: null, role: "centre_manager" } : null;
  }
  if (kind === "registration") {
    const o = own("r");
    const r = (await db
      .prepare(`SELECT DATE_FORMAT(r.created_at, '%Y-%m-%d') as date, c.name as label, c.vendor_id as vendorId FROM registrations r JOIN clubs c ON c.id = r.club_id WHERE r.ref = ? AND ${o.sql} AND r.status != 'cancelled' AND r.payment_status = 'paid'`)
      .get(ref, ...o.params)) as R;
    return r ? { attendanceKind: "registration", attendanceRef: ref, date: r.date, label: r.label, ownerVendorId: r.vendorId, ownerHostResidentId: null, role: "facility_manager" } : null;
  }
  if (kind === "experience") {
    const o = own("eb");
    const r = (await db
      .prepare(
        `SELECT es.date, e.title as label, e.vendor_id as vendorId FROM experience_bookings eb JOIN experience_sessions es ON es.id = eb.session_id JOIN experiences e ON e.id = eb.experience_id
         WHERE eb.ref = ? AND ${o.sql} AND COALESCE(eb.status, '') != 'cancelled' AND es.status != 'cancelled' AND eb.payment_status = 'paid' AND es.date < ?`
      )
      .get(ref, ...o.params, today)) as R;
    return r ? { attendanceKind: "experience", attendanceRef: ref, date: r.date, label: r.label, ownerVendorId: r.vendorId, ownerHostResidentId: null, role: "facility_manager" } : null;
  }
  if (kind === "program_session") {
    // ref = "<sessionId>:<enrollmentId>", the same key the programme register uses.
    const [sessionId, enrollmentId] = ref.split(":");
    if (!sessionId || !enrollmentId) return null;
    const o = own("pe");
    const r = (await db
      .prepare(
        `SELECT ps.date, p.title as label, p.vendor_id as vendorId FROM program_enrollments pe JOIN program_sessions ps ON ps.program_id = pe.program_id AND ps.id = ? JOIN programs p ON p.id = pe.program_id
         WHERE pe.id = ? AND ${o.sql} AND pe.status != 'cancelled' AND pe.payment_status = 'paid' AND ps.status != 'cancelled' AND ps.date < ?`
      )
      .get(sessionId, enrollmentId, ...o.params, today)) as R;
    return r ? { attendanceKind: "program_session", attendanceRef: ref, date: r.date, label: r.label, ownerVendorId: r.vendorId, ownerHostResidentId: null, role: "facility_manager" } : null;
  }
  // game: ref = game id; a place belongs to one signed-in resident.
  if (!residentId) return null;
  const g = (await db
    .prepare(
      `SELECT g.date, g.activity_label as label, g.host_resident_id as hostId FROM game_participants gp JOIN games g ON g.id = gp.game_id
       WHERE g.id = ? AND gp.resident_id = ? AND gp.status = 'joined' AND g.status != 'cancelled' AND g.date < ? AND g.host_resident_id != gp.resident_id`
    )
    .get(ref, residentId, today)) as { date: string; label: string; hostId: string } | undefined;
  return g ? { attendanceKind: "game", attendanceRef: `${ref}:${residentId}`, date: g.date, label: g.label, ownerVendorId: null, ownerHostResidentId: g.hostId, role: "" } : null;
}

/** Listing name, date and booking name for an organiser's view of a request. */
async function describePlace(kind: string, ref: string): Promise<{ placeLabel: string | null; placeDate: string | null; bookedBy: string | null }> {
  type D = { placeLabel: string | null; placeDate: string | null; bookedBy: string | null } | undefined;
  const one = async (sql: string, ...p: unknown[]) => ((await db.prepare(sql).get(...p)) as D) ?? { placeLabel: null, placeDate: null, bookedBy: null };
  if (kind === "booking") return one(`SELECT c.name as placeLabel, b.date as placeDate, b.name as bookedBy FROM bookings b JOIN centres c ON c.id = b.centre_id WHERE b.ref = ?`, ref);
  if (kind === "registration") return one(`SELECT c.name as placeLabel, NULL as placeDate, TRIM(CONCAT(r.child_first, ' ', r.child_last)) as bookedBy FROM registrations r JOIN clubs c ON c.id = r.club_id WHERE r.ref = ?`, ref);
  if (kind === "experience") return one(`SELECT e.title as placeLabel, es.date as placeDate, eb.participant_name as bookedBy FROM experience_bookings eb JOIN experiences e ON e.id = eb.experience_id JOIN experience_sessions es ON es.id = eb.session_id WHERE eb.ref = ?`, ref);
  if (kind === "program_session") {
    const [sid, eid] = ref.split(":");
    return one(`SELECT p.title as placeLabel, ps.date as placeDate, pe.participant_name as bookedBy FROM program_sessions ps JOIN programs p ON p.id = ps.program_id JOIN program_enrollments pe ON pe.id = ? WHERE ps.id = ?`, eid, sid);
  }
  if (kind === "game") {
    const [gid, rid] = ref.split(":");
    return one(`SELECT g.activity_label as placeLabel, g.date as placeDate, r.name as bookedBy FROM games g JOIN residents r ON r.id = ? WHERE g.id = ?`, rid, gid);
  }
  return { placeLabel: null, placeDate: null, bookedBy: null };
}

async function recordedStatus(kind: string, ref: string): Promise<string | null> {
  const a = (await db.prepare(`SELECT status FROM attendance WHERE kind = ? AND ref = ?`).get(kind, ref)) as { status: string } | undefined;
  return a?.status ?? null;
}

async function writePresent(kind: string, ref: string, by: string, source: string, status = "present") {
  await db
    .prepare(
      `INSERT INTO attendance (kind, ref, checked_in_by, status, source) VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE checked_in_at = NOW(), checked_in_by = VALUES(checked_in_by), status = VALUES(status), source = VALUES(source)`
    )
    .run(kind, ref, by, status, source);
}

function participant(req: Request): { clientId: string | null; residentId: string | null } {
  let clientId: string | null = null;
  try {
    clientId = clientIdFrom(req);
  } catch (e) {
    if (!(e instanceof BadRequestError)) throw e;
  }
  return { clientId, residentId: req.resident?.id ?? null };
}

const PUBLIC_FIELDS = `id, kind, ref, note, status, decision_note as decisionNote, decided_at as decidedAt, created_at as createdAt`;

export const attendanceRouter = Router();

attendanceRouter.post("/corrections", async (req, res) => {
  const who = participant(req);
  if (!who.clientId && !who.residentId) return res.status(400).json({ error: "Missing X-Client-Id header" });
  const { kind, ref, note } = (req.body ?? {}) as { kind?: string; ref?: string; note?: string };
  if (!isKind(kind) || typeof ref !== "string" || !ref || ref.length > 191) return res.status(400).json({ error: "kind and ref are required" });
  const text = typeof note === "string" ? note.trim() : "";
  if (text.length > NOTE_MAX) return res.status(400).json({ error: `Keep the note under ${NOTE_MAX} characters` });
  const place = await ownPlace(kind, ref, who.clientId, who.residentId, req.guestEmail ?? null);
  if (!place) return res.status(404).json({ error: "We couldn't find a past place of yours with that reference" });
  const current = await recordedStatus(place.attendanceKind, place.attendanceRef);
  // A Session place belongs to one person, so a host's present record already
  // confirms them. A booking checked in at the door doesn't say who came, so
  // the holder may still ask to be confirmed personally — once.
  if (await confirmedForPerson(place.attendanceKind, place.attendanceRef, who.clientId, who.residentId)) {
    return res.status(409).json({ error: "The organiser has already confirmed that you attended" });
  }
  try {
    const r = await db
      .prepare(
        `INSERT INTO attendance_corrections (kind, ref, resident_id, client_id, note, owner_vendor_id, owner_host_resident_id, open_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(place.attendanceKind, place.attendanceRef, who.residentId, who.clientId, text || null, place.ownerVendorId, place.ownerHostResidentId, `${place.attendanceKind}:${place.attendanceRef}`);
    const id = Number(r.lastInsertRowid);
    const title = "Someone has asked you to confirm their attendance";
    const state = current === "present" || current === "late" ? "was checked in, but your record doesn't say who came" : current ? "is marked as missed" : "has no attendance record";
    const body = `A participant says they attended ${place.label} on ${place.date}. The booking ${state}. Review it in your workspace.`;
    if (place.ownerVendorId) {
      await db.prepare(`INSERT INTO notifications (recipient_id, kind, title, body, listing_type, listing_id, ref) VALUES (?, 'attendance', ?, ?, 'account', ?, ?)`).run(place.ownerVendorId, title, body, place.ownerVendorId, String(id));
    } else if (place.ownerHostResidentId) {
      await notifyResident({ residentId: place.ownerHostResidentId, kind: "game", title, body, listingType: "game", listingId: ref, ref: String(id) });
    }
    res.status(201).json({ id, status: "open" });
  } catch (e) {
    if ((e as { code?: string }).code === "ER_DUP_ENTRY") return res.status(409).json({ error: "You've already asked for this to be corrected. The organiser will reply." });
    throw e;
  }
});

// --- a participant's own places and where each stands ---------------------------

/** Has the organiser already confirmed this person for this place? */
async function confirmedForPerson(kind: string, ref: string, clientId: string | null, residentId: string | null): Promise<boolean> {
  if (kind === "game") {
    const s = await recordedStatus(kind, ref);
    return s === "present" || s === "late";
  }
  const r = await db
    .prepare(
      `SELECT 1 FROM attendance_corrections WHERE kind = ? AND ref = ? AND status = 'accepted'
         AND ((resident_id IS NOT NULL AND resident_id = ?) OR (client_id IS NOT NULL AND client_id = ?)) LIMIT 1`
    )
    .get(kind, ref, residentId ?? "", clientId ?? "");
  return !!r;
}

/**
 * GET /places/:kind/:ref — for the booking page: each past place the caller
 * holds under this booking (one, or one per past programme session), what the
 * organiser recorded, whether it's confirmed for them, and their request.
 * kind: booking | registration | experience | game | program (enrolment ref).
 */
attendanceRouter.get("/places/:kind/:ref", async (req, res) => {
  const who = participant(req);
  if (!who.clientId && !who.residentId) return res.status(400).json({ error: "Missing X-Client-Id header" });
  const email = req.guestEmail ?? null;
  const { kind, ref } = req.params;
  let refs: { kind: CorrectionKind; ref: string }[] = [];
  if (kind === "program") {
    const own: string[] = [];
    const params: string[] = [];
    if (who.clientId) (own.push("pe.client_id = ?"), params.push(who.clientId));
    if (who.residentId) (own.push("pe.resident_id = ?"), params.push(who.residentId));
    if (email) (own.push("LOWER(pe.email) = LOWER(?)"), params.push(email));
    const sessions = (await db
      .prepare(
        `SELECT ps.id as sessionId, pe.id as enrollmentId FROM program_enrollments pe JOIN program_sessions ps ON ps.program_id = pe.program_id
         WHERE pe.ref = ? AND (${own.join(" OR ")}) AND ps.status != 'cancelled' AND ps.date < ? ORDER BY ps.date DESC, ps.time DESC LIMIT 60`
      )
      .all(ref, ...params, irelandTodayIso())) as { sessionId: string; enrollmentId: number }[];
    refs = sessions.map((s) => ({ kind: "program_session" as const, ref: `${s.sessionId}:${s.enrollmentId}` }));
  } else if (isKind(kind) && kind !== "program_session") {
    refs = [{ kind, ref }];
  } else {
    return res.status(400).json({ error: "Unknown kind" });
  }
  const items = [];
  for (const r of refs) {
    const place = await ownPlace(r.kind, r.ref, who.clientId, who.residentId, email);
    if (!place) continue;
    const recorded = await recordedStatus(place.attendanceKind, place.attendanceRef);
    const confirmed = await confirmedForPerson(place.attendanceKind, place.attendanceRef, who.clientId, who.residentId);
    const request = (await db
      .prepare(
        `SELECT id, status, decision_note as decisionNote, decided_at as decidedAt, created_at as createdAt FROM attendance_corrections
         WHERE kind = ? AND ref = ? AND ((resident_id IS NOT NULL AND resident_id = ?) OR (client_id IS NOT NULL AND client_id = ?)) ORDER BY id DESC LIMIT 1`
      )
      .get(place.attendanceKind, place.attendanceRef, who.residentId ?? "", who.clientId ?? "")) as
      | { id: number; status: string; decisionNote: string | null; decidedAt: string | null; createdAt: string }
      | undefined;
    // A child's club registration: whatever is recorded is the child's
    // attendance, never the account holder's own (no personal review).
    const child =
      r.kind === "registration" &&
      !!(await db.prepare(`SELECT 1 FROM registrations WHERE ref = ? AND registrant_type != 'adult'`).get(r.ref));
    items.push({
      forSomeoneElse: child,
      correctionKind: r.kind,
      requestRef: r.ref,
      label: place.label,
      date: String(place.date).slice(0, 10),
      recorded,
      confirmed,
      request: request ?? null,
      canRequest: !confirmed && request?.status !== "open",
    });
  }
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ items });
});

attendanceRouter.get("/corrections/mine", async (req, res) => {
  const who = participant(req);
  if (!who.clientId && !who.residentId) return res.json([]);
  const parts: string[] = [];
  const params: string[] = [];
  if (who.clientId) (parts.push("client_id = ?"), params.push(who.clientId));
  if (who.residentId) (parts.push("resident_id = ?"), params.push(who.residentId));
  res.json(await db.prepare(`SELECT ${PUBLIC_FIELDS} FROM attendance_corrections WHERE ${parts.join(" OR ")} ORDER BY created_at DESC LIMIT 100`).all(...params));
});

// --- the organiser's side ------------------------------------------------------

/** Who is asking as an organiser: a partner (org-scoped) or a resident host. */
async function organiserScope(req: Request): Promise<{ sql: string; params: string[]; actor: string; actorKind: "user" | "resident" } | null> {
  // A person can hold both a partner and a resident session; ?as=host picks the host side.
  if (req.user?.role === "vendor" && req.user.status === "approved" && req.query.as !== "host") {
    const ids = await orgVendorIds(req.user);
    return { sql: `owner_vendor_id IN (${ids.map(() => "?").join(", ")})`, params: ids, actor: req.user.id, actorKind: "user" };
  }
  if (req.resident) return { sql: "owner_host_resident_id = ?", params: [req.resident.id], actor: req.resident.id, actorKind: "resident" };
  return null;
}

/** The partner role that may record attendance of this kind (same split as front-door check-in). */
const ROLE_FOR_KIND: Record<string, string> = { booking: "centre_manager", registration: "facility_manager", experience: "facility_manager", program_session: "facility_manager" };

attendanceRouter.get("/corrections/owned", async (req, res) => {
  const scope = await organiserScope(req);
  if (!scope) return res.status(401).json({ error: "Sign in to see attendance requests" });
  const rows = (await db
    .prepare(`SELECT ${PUBLIC_FIELDS} FROM attendance_corrections WHERE ${scope.sql} ORDER BY status = 'open' DESC, created_at DESC LIMIT 200`)
    .all(...scope.params)) as { kind: string; ref: string }[];
  // Invited staff only see the kinds their role may record.
  const visible = req.user?.role === "vendor" ? rows.filter((r) => hasPlatformRole(req.user!, ROLE_FOR_KIND[r.kind] ?? "")) : rows;
  // What the organiser needs to check their own register: the listing, the
  // date and the name on the booking (already theirs to see; org-scoped above).
  res.json(await Promise.all(visible.map(async (r) => ({ ...r, ...(await describePlace(r.kind, r.ref)) }))));
});

async function decide(req: Request, res: Response, scope: { sql: string; params: string[]; actor: string; actorKind: "user" | "resident" | "admin" }) {
  const { decision, note } = (req.body ?? {}) as { decision?: string; note?: string };
  if (decision !== "accept" && decision !== "decline") return res.status(400).json({ error: "decision must be accept or decline" });
  const text = typeof note === "string" ? note.trim() : "";
  const min = scope.actorKind === "admin" ? 20 : NOTE_MIN;
  if (decision === "decline" && text.length < min) return res.status(400).json({ error: `Say why (at least ${min} characters) — the participant sees this` });
  const row = (await db.prepare(`SELECT id, kind, ref, status, resident_id as residentId FROM attendance_corrections WHERE id = ? AND ${scope.sql}`).get(req.params.id, ...scope.params)) as
    | { id: number; kind: string; ref: string; status: string; residentId: string | null }
    | undefined;
  if (!row) return res.status(404).json({ error: "Request not found" });
  if (req.user?.role === "vendor" && !hasPlatformRole(req.user, ROLE_FOR_KIND[row.kind] ?? "")) return res.status(403).json({ error: "Not authorized for this role" });
  // Admins may also overturn a declined request (escalated through complaints).
  const from = scope.actorKind === "admin" ? ["open", "declined"] : ["open"];
  const to = decision === "accept" ? "accepted" : "declined";
  const r = await db
    .prepare(
      `UPDATE attendance_corrections SET status = ?, decision_note = ?, decided_by = ?, decided_by_kind = ?, decided_at = NOW(), open_key = NULL
       WHERE id = ? AND status IN (${from.map(() => "?").join(", ")})`
    )
    .run(to, text.slice(0, NOTE_MAX) || null, scope.actor, scope.actorKind, row.id, ...from);
  if (r.changes !== 1) return res.status(409).json({ error: "This request has already been decided" });
  // Accepting confirms the person (the accepted request is that record) and,
  // if the place itself wasn't recorded as attended, records it. An existing
  // door check-in keeps its own source.
  if (decision === "accept") {
    const before = await recordedStatus(row.kind, row.ref);
    if (before !== "present" && before !== "late") await writePresent(row.kind, row.ref, scope.actor, "correction");
    await scheduleReviewInvitation(row.kind, row.ref);
  }
  await writeAudit({
    actorUserId: scope.actor,
    actorKind: scope.actorKind === "resident" ? "resident" : "user",
    action: `attendance_correction.${to}`,
    objectType: "attendance_correction",
    objectId: String(row.id),
    previousValue: { status: row.status },
    newValue: { status: to, kind: row.kind, ref: row.ref },
  });
  if (row.residentId) {
    await notifyResident({
      residentId: row.residentId,
      kind: "moderation",
      title: decision === "accept" ? "Your attendance has been corrected" : "Your attendance correction was declined",
      body: decision === "accept" ? "The organiser has recorded you as attending. You can now leave a review." : `${text}\n\nIf you think this is wrong, you can ask HelloCircle to look at it through the complaints process.`,
      listingType: "account",
      listingId: row.residentId,
      ref: String(row.id),
    });
  }
  res.json({ ok: true, status: to });
}

attendanceRouter.put("/corrections/:id", async (req, res) => {
  const scope = await organiserScope(req);
  if (!scope) return res.status(401).json({ error: "Sign in to decide attendance requests" });
  return decide(req, res, scope);
});

/** A Session host records who came (or didn't). Writes the shared attendance table. */
attendanceRouter.post("/games/:gameId/participants/:residentId", requireResident, async (req, res) => {
  const { status } = (req.body ?? {}) as { status?: string };
  if (status !== "present" && status !== "no_show") return res.status(400).json({ error: "status must be present or no_show" });
  const g = (await db.prepare(`SELECT host_resident_id as hostId, date, status FROM games WHERE id = ?`).get(req.params.gameId)) as { hostId: string; date: string; status: string } | undefined;
  if (!g) return res.status(404).json({ error: "Session not found" });
  if (g.hostId !== req.resident!.id) return res.status(403).json({ error: "Only the host can record attendance" });
  if (g.status === "cancelled") return res.status(409).json({ error: "This Session was cancelled" });
  if (g.date > irelandTodayIso()) return res.status(409).json({ error: "You can record attendance on the day or after" });
  const joined = await db.prepare(`SELECT 1 FROM game_participants WHERE game_id = ? AND resident_id = ? AND status = 'joined'`).get(req.params.gameId, req.params.residentId);
  if (!joined) return res.status(404).json({ error: "That person isn't joined to this Session" });
  await writePresent("game", `${req.params.gameId}:${req.params.residentId}`, req.resident!.id, "host_manual", status);
  if (status === "no_show") await flagReviewsAfterAttendanceChange("game", `${req.params.gameId}:${req.params.residentId}`, "the host recorded a no-show", { id: req.resident!.id, kind: "resident" });
  if (status === "present") await scheduleReviewInvitation("game", `${req.params.gameId}:${req.params.residentId}`);
  res.json({ ok: true, status });
});

// --- organisers confirm named attendees directly ------------------------------
//
// After an occurrence, a partner can confirm that the person who holds a
// booking attended — the only person the data identifies. A group booking's
// other guests are never marked; a booking-level door check-in is shown but
// never treated as this confirmation. The confirmation is the same accepted
// attendance_corrections row a participant's request produces (origin
// 'organiser'), so eligibility, labels and audit work unchanged. A mistake is
// undone with "withdraw" (reason required, audited); any published review is
// then flagged for moderation, never hidden.

const CONFIRM_KINDS = ["booking", "registration", "experience", "program_session"] as const;
type ConfirmKind = (typeof CONFIRM_KINDS)[number];
const CONFIRM_WINDOW_DAYS = 60;

interface OrganiserPlace {
  vendorId: string | null;
  residentId: string | null;
  clientId: string | null;
  date: string | null;
  label: string;
  holderName: string | null;
  holderEmail: string | null;
  partySize: number;
  usable: boolean;
}

/** A past, paid, uncancelled place and who holds it — or null. Registrations: adult (self) registrations only. */
async function organiserPlace(kind: ConfirmKind, ref: string): Promise<OrganiserPlace | null> {
  const today = irelandTodayIso();
  type R = Omit<OrganiserPlace, "usable"> & { usable: number };
  let r: R | undefined;
  if (kind === "booking") {
    r = (await db
      .prepare(
        `SELECT c.vendor_id as vendorId, b.resident_id as residentId, b.client_id as clientId, b.date, c.name as label, b.name as holderName, b.email as holderEmail, 1 as partySize,
                (b.payment_status = 'paid' AND b.status != 'cancelled' AND b.date < ?) as usable
         FROM bookings b JOIN centres c ON c.id = b.centre_id WHERE b.ref = ?`
      )
      .get(today, ref)) as R | undefined;
  } else if (kind === "registration") {
    r = (await db
      .prepare(
        `SELECT c.vendor_id as vendorId, r.resident_id as residentId, r.client_id as clientId, NULL as date, c.name as label, TRIM(CONCAT(r.child_first, ' ', r.child_last)) as holderName, r.email as holderEmail, 1 as partySize,
                (r.payment_status = 'paid' AND r.status != 'cancelled' AND r.registrant_type = 'adult') as usable
         FROM registrations r JOIN clubs c ON c.id = r.club_id WHERE r.ref = ?`
      )
      .get(ref)) as R | undefined;
  } else if (kind === "experience") {
    r = (await db
      .prepare(
        `SELECT e.vendor_id as vendorId, eb.resident_id as residentId, eb.client_id as clientId, es.date, e.title as label, eb.participant_name as holderName, eb.email as holderEmail, eb.party_size as partySize,
                (eb.payment_status = 'paid' AND COALESCE(eb.status, '') != 'cancelled' AND es.status != 'cancelled' AND es.date < ?) as usable
         FROM experience_bookings eb JOIN experiences e ON e.id = eb.experience_id JOIN experience_sessions es ON es.id = eb.session_id WHERE eb.ref = ?`
      )
      .get(today, ref)) as R | undefined;
  } else {
    const [sid, eid] = ref.split(":");
    r = (await db
      .prepare(
        `SELECT p.vendor_id as vendorId, pe.resident_id as residentId, pe.client_id as clientId, ps.date, p.title as label, pe.participant_name as holderName, pe.email as holderEmail, 1 as partySize,
                (pe.payment_status = 'paid' AND pe.status != 'cancelled' AND ps.status != 'cancelled' AND ps.date < ? AND ps.program_id = pe.program_id) as usable
         FROM program_sessions ps JOIN program_enrollments pe ON pe.id = ? JOIN programs p ON p.id = ps.program_id WHERE ps.id = ?`
      )
      .get(today, eid ?? "", sid ?? "")) as R | undefined;
  }
  if (!r) return null;
  return { ...r, date: r.date ? String(r.date).slice(0, 10) : null, partySize: Number(r.partySize) || 1, usable: Number(r.usable) === 1 };
}

async function vendorScopeFor(req: Request, res: Response, kind: string, vendorId: string | null): Promise<boolean> {
  if (!(req.user?.role === "vendor" && req.user.status === "approved")) {
    res.status(401).json({ error: "Partner sign-in required" });
    return false;
  }
  const ids = await orgVendorIds(req.user);
  if (!vendorId || !ids.includes(vendorId)) {
    res.status(404).json({ error: "Booking not found" });
    return false;
  }
  if (!hasPlatformRole(req.user, ROLE_FOR_KIND[kind] ?? "")) {
    res.status(403).json({ error: "Not authorized for this role" });
    return false;
  }
  return true;
}

/** Past attendees (last 60 days) the organisation can confirm, with where each stands. */
attendanceRouter.get("/to-confirm", async (req, res) => {
  if (!(req.user?.role === "vendor" && req.user.status === "approved")) return res.status(401).json({ error: "Partner sign-in required" });
  const ids = await orgVendorIds(req.user);
  const inIds = ids.map(() => "?").join(", ");
  const today = irelandTodayIso();
  const from = new Date(Date.now() - CONFIRM_WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
  const status = (kindExpr: string, refExpr: string) => `
    (SELECT a.status FROM attendance a WHERE a.kind = ${kindExpr} AND a.ref = ${refExpr}) as doorStatus,
    (SELECT c.id FROM attendance_corrections c WHERE c.kind = ${kindExpr} AND c.ref = ${refExpr} AND c.status = 'accepted' ORDER BY c.id DESC LIMIT 1) as confirmationId,
    (SELECT c.origin FROM attendance_corrections c WHERE c.kind = ${kindExpr} AND c.ref = ${refExpr} AND c.status = 'accepted' ORDER BY c.id DESC LIMIT 1) as confirmedBy,
    EXISTS (SELECT 1 FROM attendance_corrections c WHERE c.kind = ${kindExpr} AND c.ref = ${refExpr} AND c.status = 'open') as requestOpen`;
  const rows: Record<string, unknown>[] = [];
  const add = (kind: ConfirmKind, list: Record<string, unknown>[]) => {
    if (!hasPlatformRole(req.user!, ROLE_FOR_KIND[kind])) return;
    for (const r of list) rows.push({ ...r, kind });
  };
  add(
    "booking",
    (await db
      .prepare(
        `SELECT b.ref, c.name as label, b.date, b.name as holderName, 1 as partySize, ${status("'booking'", "b.ref")},
                EXISTS (SELECT 1 FROM reviews rv WHERE rv.occurrence_kind = 'booking' AND rv.occurrence_ref = b.ref) as reviewSubmitted
         FROM bookings b JOIN centres c ON c.id = b.centre_id
         WHERE c.vendor_id IN (${inIds}) AND b.payment_status = 'paid' AND b.status != 'cancelled' AND b.date < ? AND b.date >= ? ORDER BY b.date DESC LIMIT 200`
      )
      .all(...ids, today, from)) as Record<string, unknown>[]
  );
  add(
    "experience",
    (await db
      .prepare(
        `SELECT eb.ref, e.title as label, es.date, eb.participant_name as holderName, eb.party_size as partySize, ${status("'experience'", "eb.ref")},
                EXISTS (SELECT 1 FROM reviews rv WHERE rv.occurrence_kind = 'experience' AND rv.occurrence_ref = eb.ref) as reviewSubmitted
         FROM experience_bookings eb JOIN experiences e ON e.id = eb.experience_id JOIN experience_sessions es ON es.id = eb.session_id
         WHERE e.vendor_id IN (${inIds}) AND eb.payment_status = 'paid' AND COALESCE(eb.status, '') != 'cancelled' AND es.status != 'cancelled' AND es.date < ? AND es.date >= ?
         ORDER BY es.date DESC LIMIT 200`
      )
      .all(...ids, today, from)) as Record<string, unknown>[]
  );
  add(
    "program_session",
    (await db
      .prepare(
        `SELECT CONCAT(ps.id, ':', pe.id) as ref, p.title as label, ps.date, pe.participant_name as holderName, 1 as partySize, ${status("'program_session'", "CONCAT(ps.id, ':', pe.id)")},
                EXISTS (SELECT 1 FROM reviews rv WHERE rv.occurrence_kind = 'enrollment' AND rv.occurrence_ref = pe.ref) as reviewSubmitted
         FROM program_sessions ps JOIN programs p ON p.id = ps.program_id JOIN program_enrollments pe ON pe.program_id = p.id
         WHERE p.vendor_id IN (${inIds}) AND pe.payment_status = 'paid' AND pe.status != 'cancelled' AND ps.status != 'cancelled' AND ps.date < ? AND ps.date >= ?
         ORDER BY ps.date DESC LIMIT 300`
      )
      .all(...ids, today, from)) as Record<string, unknown>[]
  );
  rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  res.setHeader("Cache-Control", "private, no-store");
  res.json(
    rows.map((r) => ({
      kind: r.kind,
      ref: r.ref,
      label: r.label,
      date: String(r.date).slice(0, 10),
      holderName: r.holderName ?? null,
      partySize: Number(r.partySize) || 1,
      doorStatus: r.doorStatus ?? null,
      confirmationId: r.confirmationId ?? null,
      confirmedBy: r.confirmedBy ?? null,
      requestOpen: Number(r.requestOpen) === 1,
      reviewSubmitted: Number(r.reviewSubmitted) === 1,
    }))
  );
});

/** Confirm that the booking's holder attended (not their guests). Accepts an open request if there is one. */
attendanceRouter.post("/confirm", async (req, res) => {
  const { kind, ref } = (req.body ?? {}) as { kind?: string; ref?: string };
  if (!(CONFIRM_KINDS as readonly string[]).includes(kind ?? "") || typeof ref !== "string" || !ref) return res.status(400).json({ error: "kind and ref are required" });
  const k = kind as ConfirmKind;
  const place = await organiserPlace(k, ref);
  if (!(await vendorScopeFor(req, res, k, place?.vendorId ?? null))) return;
  if (!place!.usable) return res.status(409).json({ error: k === "registration" ? "Only an adult's own registration can be confirmed this way" : "Only a past, paid, uncancelled booking can be confirmed" });
  if (!place!.residentId && !place!.clientId) return res.status(409).json({ error: "This booking isn't linked to anyone we can identify" });
  if (await db.prepare(`SELECT 1 FROM attendance_corrections WHERE kind = ? AND ref = ? AND status = 'accepted'`).get(k, ref)) {
    return res.status(409).json({ error: "Already confirmed" });
  }
  const open = (await db.prepare(`SELECT id FROM attendance_corrections WHERE kind = ? AND ref = ? AND status = 'open'`).get(k, ref)) as { id: number } | undefined;
  let id: number;
  if (open) {
    await db
      .prepare(`UPDATE attendance_corrections SET status = 'accepted', decided_by = ?, decided_by_kind = 'user', decided_at = NOW(), open_key = NULL WHERE id = ? AND status = 'open'`)
      .run(req.user!.id, open.id);
    id = open.id;
  } else {
    const r = await db
      .prepare(
        `INSERT INTO attendance_corrections (kind, ref, resident_id, client_id, status, origin, owner_vendor_id, decided_by, decided_by_kind, decided_at)
         VALUES (?, ?, ?, ?, 'accepted', 'organiser', ?, ?, 'user', NOW())`
      )
      .run(k, ref, place!.residentId, place!.clientId, place!.vendorId, req.user!.id);
    id = Number(r.lastInsertRowid);
  }
  const before = await recordedStatus(k, ref);
  if (before !== "present" && before !== "late") await writePresent(k, ref, req.user!.id, "organiser_confirmed");
  await scheduleReviewInvitation(k, ref);
  await writeAudit({ actorUserId: req.user!.id, action: "attendance.organiser_confirmed", objectType: "attendance_correction", objectId: String(id), newValue: { kind: k, ref, partySize: place!.partySize } });
  if (place!.residentId) {
    // In-app only, through the existing notifications pipeline and its preferences.
    await notifyResident({
      residentId: place!.residentId,
      kind: "booking",
      title: `${place!.label}: attendance confirmed`,
      body: `The organiser confirmed you attended${place!.date ? ` on ${place!.date}` : ""}. You can now leave a review from your booking.`,
      listingType: "account",
      listingId: place!.residentId,
      ref: String(id),
    });
  }
  res.status(201).json({ id, status: "accepted" });
});

/** Undo a confirmation made by mistake (reason required). A published review is flagged for moderation, not hidden. */
attendanceRouter.post("/confirm/:id/withdraw", async (req, res) => {
  const note = typeof req.body?.note === "string" ? req.body.note.trim() : "";
  const row = (await db.prepare(`SELECT id, kind, ref, status, owner_vendor_id as ownerVendorId, resident_id as residentId FROM attendance_corrections WHERE id = ?`).get(req.params.id)) as
    | { id: number; kind: string; ref: string; status: string; ownerVendorId: string | null; residentId: string | null }
    | undefined;
  if (!(await vendorScopeFor(req, res, row?.kind ?? "", row?.ownerVendorId ?? null))) return;
  if (note.length < NOTE_MIN) return res.status(400).json({ error: `Say why (at least ${NOTE_MIN} characters) — the participant sees this` });
  const r = await db
    .prepare(`UPDATE attendance_corrections SET status = 'withdrawn', decision_note = ?, decided_by = ?, decided_by_kind = 'user', decided_at = NOW() WHERE id = ? AND status = 'accepted'`)
    .run(note.slice(0, NOTE_MAX), req.user!.id, row!.id);
  if (r.changes !== 1) return res.status(409).json({ error: "Only a confirmed attendance can be withdrawn" });
  await writeAudit({ actorUserId: req.user!.id, action: "attendance.confirmation_withdrawn", objectType: "attendance_correction", objectId: String(row!.id), previousValue: { status: "accepted" }, newValue: { status: "withdrawn" }, reason: note.slice(0, 500) });
  await flagReviewsAfterAttendanceChange(row!.kind, row!.ref, "the organiser withdrew their confirmation", { id: req.user!.id, kind: "user" });
  if (row!.residentId) {
    await notifyResident({
      residentId: row!.residentId,
      kind: "booking",
      title: "An attendance confirmation was withdrawn",
      body: `${note}\n\nIf you think this is wrong, ask the organiser again from your booking, or ask HelloCircle to look at it through the complaints process.`,
      listingType: "account",
      listingId: row!.residentId,
      ref: String(row!.id),
    });
  }
  res.json({ ok: true, status: "withdrawn" });
});


// --- HelloCircle support -------------------------------------------------------

export const adminAttendanceRouter = Router();

adminAttendanceRouter.get("/corrections", requireAdminPermission("complaints.handle"), async (req, res) => {
  const status = typeof req.query.status === "string" && ["open", "accepted", "declined"].includes(req.query.status) ? req.query.status : null;
  res.json(
    await db
      .prepare(
        `SELECT ${PUBLIC_FIELDS}, owner_vendor_id as ownerVendorId, owner_host_resident_id as ownerHostResidentId, decided_by as decidedBy, decided_by_kind as decidedByKind
         FROM attendance_corrections ${status ? "WHERE status = ?" : ""} ORDER BY created_at DESC LIMIT 300`
      )
      .all(...(status ? [status] : []))
  );
});

adminAttendanceRouter.put("/corrections/:id", requireAdminPermission("complaints.handle"), (req, res) => decide(req, res, { sql: "1 = 1", params: [], actor: req.user!.id, actorKind: "admin" }));
