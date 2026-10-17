import { writeAudit } from "./audit.js";
import { consentHistory, currentConsents } from "./consent.js";
import { db } from "./db/index.js";
import { sendMail } from "./email.js";

// OG-29 — a queue for privacy requests (access, correction, erasure,
// objection). Decision-independent foundation only:
//   - Nothing here deletes or anonymises data. Completing an erasure request
//     records what was decided and tells the person; the deletion itself waits
//     on D-07 (resident suspension/deletion rules) and on retention periods,
//     which DEC-14 leaves unchosen. No retention job runs.
//   - An access request is answered with the person's own self-serve export
//     (GET /residents/me/export) plus whatever the admin writes back.

export const PRIVACY_KINDS = ["access", "correction", "erasure", "objection"] as const;
export type PrivacyKind = (typeof PRIVACY_KINDS)[number];
export const PRIVACY_STATUSES = ["received", "in_progress", "completed", "refused"] as const;
export type PrivacyStatus = (typeof PRIVACY_STATUSES)[number];

const KIND_LABEL: Record<PrivacyKind, string> = { access: "a copy of your data", correction: "a correction to your data", erasure: "deletion of your data", objection: "an objection to how your data is used" };

export class PrivacyError extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message);
  }
}

export async function submitPrivacyRequest(resident: { id: string; email: string }, kind: unknown, details: unknown) {
  if (!PRIVACY_KINDS.includes(kind as PrivacyKind)) throw new PrivacyError("Choose what you're asking for");
  const text = typeof details === "string" ? details.trim().slice(0, 2000) : "";
  const open = (await db
    .prepare(`SELECT id FROM privacy_requests WHERE resident_id = ? AND kind = ? AND status IN ('received', 'in_progress')`)
    .get(resident.id, kind)) as { id: number } | undefined;
  if (open) throw new PrivacyError("You already have an open request of this kind — we'll reply to it", 409);
  const r = await db.prepare(`INSERT INTO privacy_requests (resident_id, email, kind, details) VALUES (?, ?, ?, ?)`).run(resident.id, resident.email, kind, text);
  await sendMail({
    to: resident.email,
    subject: "We've received your privacy request",
    text: `We've received your request for ${KIND_LABEL[kind as PrivacyKind]}. We'll reply to this email address. Reference: PR-${r.lastInsertRowid}.`,
  }).catch(() => {});
  return { id: Number(r.lastInsertRowid) };
}

export async function myPrivacyRequests(residentId: string) {
  return db
    .prepare(`SELECT id, kind, status, details, response, created_at as createdAt, updated_at as updatedAt FROM privacy_requests WHERE resident_id = ? ORDER BY id DESC`)
    .all(residentId);
}

export async function listPrivacyRequests(status?: string) {
  const where = status && PRIVACY_STATUSES.includes(status as PrivacyStatus) ? `WHERE p.status = ?` : status === "open" ? `WHERE p.status IN ('received', 'in_progress')` : "";
  const args = where.includes("?") ? [status] : [];
  return db
    .prepare(
      `SELECT p.id, p.kind, p.status, p.email, p.resident_id as residentId, COALESCE(r.name, '') as name, p.created_at as createdAt, p.updated_at as updatedAt
       FROM privacy_requests p LEFT JOIN residents r ON r.id = p.resident_id ${where} ORDER BY p.status IN ('received', 'in_progress') DESC, p.id DESC LIMIT 200`
    )
    .all(...args);
}

export async function privacyRequestDetail(id: number) {
  const row = (await db
    .prepare(
      `SELECT p.id, p.kind, p.status, p.email, p.details, p.response, p.handled_by as handledBy, p.resident_id as residentId, COALESCE(r.name, '') as name,
              p.created_at as createdAt, p.updated_at as updatedAt
       FROM privacy_requests p LEFT JOIN residents r ON r.id = p.resident_id WHERE p.id = ?`
    )
    .get(id)) as { residentId: string | null } | undefined;
  if (!row) throw new PrivacyError("Request not found", 404);
  const consents = row.residentId ? await currentConsents({ type: "resident", id: row.residentId }) : null;
  return { ...row, consents };
}

export async function updatePrivacyRequest(id: number, actorUserId: string, status: unknown, response: unknown) {
  if (!PRIVACY_STATUSES.includes(status as PrivacyStatus) || status === "received") throw new PrivacyError("Choose in progress, completed or refused");
  const text = typeof response === "string" ? response.trim().slice(0, 2000) : "";
  if ((status === "completed" || status === "refused") && text.length < 10) throw new PrivacyError("Write the reply the person will get (at least 10 characters)");
  const before = (await db.prepare(`SELECT status, email, kind FROM privacy_requests WHERE id = ?`).get(id)) as { status: string; email: string; kind: PrivacyKind } | undefined;
  if (!before) throw new PrivacyError("Request not found", 404);
  if (before.status === "completed" || before.status === "refused") throw new PrivacyError("This request is already closed", 409);
  await db.prepare(`UPDATE privacy_requests SET status = ?, response = COALESCE(NULLIF(?, ''), response), handled_by = ? WHERE id = ?`).run(status, text, actorUserId, id);
  await writeAudit({ actorUserId, action: "privacy_request.updated", objectType: "privacy_request", objectId: String(id), previousValue: { status: before.status }, newValue: { status } });
  if (status === "completed" || status === "refused") {
    await sendMail({
      to: before.email,
      subject: "About your privacy request",
      text: `Your request for ${KIND_LABEL[before.kind]} (reference PR-${id}) has been ${status === "completed" ? "completed" : "declined"}.\n\n${text}`,
    }).catch(() => {});
  }
}

/** OG-31 — consent records for whoever holds this email (resident and/or partner account). */
export async function consentsForEmail(email: string) {
  const resident = (await db.prepare(`SELECT id, name FROM residents WHERE LOWER(email) = LOWER(?)`).get(email)) as { id: string; name: string } | undefined;
  const user = (await db.prepare(`SELECT id, name, role FROM users WHERE LOWER(email) = LOWER(?)`).get(email)) as { id: string; name: string; role: string } | undefined;
  const subjects = [];
  if (resident) subjects.push({ kind: "resident" as const, name: resident.name, current: await currentConsents({ type: "resident", id: resident.id }), history: await consentHistory({ type: "resident", id: resident.id }) });
  if (user) subjects.push({ kind: user.role === "admin" ? ("admin" as const) : ("partner" as const), name: user.name, current: await currentConsents({ type: "user", id: user.id }), history: await consentHistory({ type: "user", id: user.id }) });
  return subjects;
}
