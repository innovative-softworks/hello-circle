import crypto from "node:crypto";
import { db } from "../db/index.js";
import { deliverMail } from "../email.js";
import { notifyResident } from "../notifications.js";
import { formQuestionsOn } from "./formAnswers.js";
import { ANSWER_SOURCE } from "./formListings.js";
import { missingRequired, orderByRef, orderPeople, type OrderSource } from "./orderRecords.js";
import { activeQuestions, readAnswersFor } from "./questions.js";

// Phase K (docs/participation-expansion/22) — partner messages to the people
// booked on one of the organisation's own listings. Extends the existing
// vendor_messages (same table, same Messages screen): approved templates,
// server-side audience resolution (never another organisation's people),
// a recipient preview without email addresses, idempotent sends, one
// delivery row per person and channel (in-app for signed-in residents, email
// for everyone), retries, and delivery status. Outside the live production
// environment, email only goes to test domains, so test sends never reach
// real people. Answers, contact details and medical notes are never included.

export type AudienceListingType = "centre" | "club" | "program" | "experience";
export type AudienceFilter = "all" | "checked_in" | "not_checked_in" | "waiting_answers";
export interface AudienceSpec {
  listingType: AudienceListingType;
  listingId: string;
  /** An experience/event session or a programme session (optional). */
  sessionId?: string | null;
  /** A hall booking date (optional, YYYY-MM-DD). */
  date?: string | null;
  filter?: AudienceFilter;
}
export interface Recipient {
  key: string;
  source: OrderSource;
  ref: string;
  name: string;
  email: string;
  residentId: string | null;
}

export const MESSAGE_TEMPLATES = [
  { key: "event_update", label: "Update about your booking", subject: "Update: {listing}", body: "Hello {name},\n\nA quick update about {listing}{when}:\n\n[Write your update here]\n\nSee you there." },
  { key: "schedule_change", label: "Schedule change", subject: "Change of time: {listing}", body: "Hello {name},\n\nPlease note a change to {listing}{when}:\n\n[New time or date, and what it means for you]\n\nIf this doesn't suit, you can manage your booking in My Life." },
  { key: "arrival", label: "Venue and arrival information", subject: "Getting there: {listing}", body: "Hello {name},\n\nHow to find us for {listing}{when}:\n\n[Address, entrance, parking or public transport]\n\nPlease arrive a few minutes early." },
  { key: "equipment", label: "What to bring", subject: "What to bring: {listing}", body: "Hello {name},\n\nFor {listing}{when}, please bring:\n\n[List]\n\nThanks!" },
  { key: "checkin", label: "Check-in instructions", subject: "Checking in: {listing}", body: "Hello {name},\n\nWhen you arrive for {listing}{when}, show the pass from your booking page in My Life at the door and we'll check you in.\n\n[Anything else about arrival]" },
  { key: "thank_you", label: "Thank you", subject: "Thank you for coming to {listing}", body: "Hello {name},\n\nThank you for joining us at {listing}. We hope you enjoyed it.\n\n[Anything you'd like to add]" },
  { key: "feedback", label: "Feedback request", subject: "How was {listing}?", body: "Hello {name},\n\nWe'd love to hear how {listing} went for you. You can leave a review from your booking page in My Life.\n\nThank you!" },
  { key: "custom", label: "Your own message", subject: "", body: "" },
] as const;
export type TemplateKey = (typeof MESSAGE_TEMPLATES)[number]["key"];
export const isTemplateKey = (v: unknown): v is TemplateKey => typeof v === "string" && MESSAGE_TEMPLATES.some((t) => t.key === v);

const MAX_RECIPIENTS = 2000;
export const MAX_ATTEMPTS = 3;

/** Production only: everywhere else (dev, test, staging) partner email goes to test domains only. */
export function isLiveEnvironment(): boolean {
  return process.env.NODE_ENV === "production" && process.env.APP_ENV !== "staging";
}
export function emailAllowedHere(email: string): boolean {
  if (isLiveEnvironment()) return true;
  const domains = (process.env.MESSAGE_TEST_ALLOWED_DOMAINS ?? "example.test,example.com").split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);
  const at = email.toLowerCase().split("@")[1] ?? "";
  return domains.some((d) => at === d || at.endsWith(`.${d}`));
}

const keyOf = (email: string, residentId: string | null) => (residentId ? `r:${residentId}` : `e:${crypto.createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 40)}`);
const ids = (n: number) => Array.from({ length: n }, () => "?").join(", ");

/** The listing, when one of `vendorIds` owns it; with its title. */
export async function ownedListing(vendorIds: string[], spec: AudienceSpec): Promise<{ title: string; vendorId: string } | null> {
  const table = { centre: ["centres", "name"], club: ["clubs", "name"], program: ["programs", "title"], experience: ["experiences", "title"] }[spec.listingType];
  if (!table) return null;
  const row = (await db.prepare(`SELECT ${table[1]} AS title, vendor_id AS vendorId FROM ${table[0]} WHERE id = ?`).get(spec.listingId)) as { title: string; vendorId: string } | undefined;
  return row && vendorIds.includes(row.vendorId) ? row : null;
}

/**
 * Everyone with a confirmed (paid, not cancelled) booking on the listing,
 * narrowed by session/date and attendance or answers. One recipient per
 * person (the same email or resident once), whatever how many orders.
 * The caller has already checked the organisation owns the listing.
 */
export async function resolveAudience(spec: AudienceSpec): Promise<Recipient[]> {
  type Row = { ref: string; name: string; email: string; residentId: string | null; checked: number };
  let source: OrderSource;
  let rows: Row[];
  if (spec.listingType === "centre") {
    source = "booking";
    rows = (await db
      .prepare(
        `SELECT b.ref, b.name, b.email, b.resident_id AS residentId, EXISTS (SELECT 1 FROM attendance a WHERE a.kind = 'booking' AND a.ref = b.ref AND a.status <> 'no_show') AS checked
         FROM bookings b WHERE b.centre_id = ? AND b.payment_status = 'paid' AND b.status <> 'cancelled'${spec.date ? " AND b.date = ?" : ""} ORDER BY b.date, b.time LIMIT ${MAX_RECIPIENTS}`
      )
      .all(...(spec.date ? [spec.listingId, spec.date] : [spec.listingId]))) as Row[];
  } else if (spec.listingType === "club") {
    source = "registration";
    rows = (await db
      .prepare(
        `SELECT r.ref, r.g_first AS name, r.email, r.resident_id AS residentId, EXISTS (SELECT 1 FROM attendance a WHERE a.kind = 'registration' AND a.ref = r.ref AND a.status <> 'no_show') AS checked
         FROM registrations r WHERE r.club_id = ? AND r.payment_status = 'paid' AND r.status <> 'cancelled' ORDER BY r.created_at LIMIT ${MAX_RECIPIENTS}`
      )
      .all(spec.listingId)) as Row[];
  } else if (spec.listingType === "program") {
    source = "program";
    rows = (await db
      .prepare(
        `SELECT pe.ref, pe.participant_name AS name, pe.email, pe.resident_id AS residentId,
                ${spec.sessionId ? `EXISTS (SELECT 1 FROM attendance a WHERE a.kind = 'program_session' AND a.ref = CONCAT(?, ':', pe.id) AND a.status IN ('present', 'late'))` : "0"} AS checked
         FROM program_enrollments pe WHERE pe.program_id = ? AND pe.payment_status = 'paid' AND pe.status <> 'cancelled' ORDER BY pe.created_at LIMIT ${MAX_RECIPIENTS}`
      )
      .all(...(spec.sessionId ? [spec.sessionId, spec.listingId] : [spec.listingId]))) as Row[];
  } else {
    source = "experience";
    rows = (await db
      .prepare(
        `SELECT eb.ref, eb.participant_name AS name, eb.email, eb.resident_id AS residentId,
                (EXISTS (SELECT 1 FROM attendee_checkins c WHERE c.source_type = 'experience' AND c.source_ref = eb.ref)
                 OR EXISTS (SELECT 1 FROM attendance a WHERE a.kind = 'experience' AND a.ref = eb.ref AND a.status <> 'no_show')) AS checked
         FROM experience_bookings eb WHERE eb.experience_id = ? AND eb.payment_status = 'paid' AND eb.status <> 'cancelled'${spec.sessionId ? " AND eb.session_id = ?" : ""}
         ORDER BY eb.created_at LIMIT ${MAX_RECIPIENTS}`
      )
      .all(...(spec.sessionId ? [spec.listingId, spec.sessionId] : [spec.listingId]))) as Row[];
  }
  const filter = spec.filter ?? "all";
  if (filter === "checked_in") rows = rows.filter((r) => Number(r.checked) === 1);
  if (filter === "not_checked_in") rows = rows.filter((r) => Number(r.checked) !== 1);
  if (filter === "waiting_answers") {
    const kept: Row[] = [];
    for (const r of rows) {
      const order = await orderByRef(source, r.ref);
      if (!order || !(await formQuestionsOn(order.vendorId))) continue;
      const qs = (await activeQuestions(order.listingType, order.listingId)).filter((q) => q.required && q.inputType !== "info");
      if (!qs.length) continue;
      const answers = (await readAnswersFor(ANSWER_SOURCE[order.listingType], [r.ref])).get(r.ref) ?? [];
      if (missingRequired(qs, answers, await orderPeople(order)).length) kept.push(r);
    }
    rows = kept;
  }
  const seen = new Set<string>();
  const out: Recipient[] = [];
  for (const r of rows) {
    if (!r.email && !r.residentId) continue;
    const key = keyOf(r.email ?? "", r.residentId);
    const emailKey = r.email ? keyOf(r.email, null) : null;
    if (seen.has(key) || (emailKey && seen.has(emailKey))) continue;
    seen.add(key);
    if (emailKey) seen.add(emailKey);
    out.push({ key, source, ref: r.ref, name: (r.name ?? "").trim().split(/\s+/)[0] ?? "", email: r.email ?? "", residentId: r.residentId ?? null });
  }
  return out;
}

/** What the sender sees before sending: how many people and channels, first names only — never addresses. */
export function previewOf(recipients: Recipient[]) {
  const names = recipients.map((r) => r.name).filter(Boolean);
  return {
    recipients: recipients.length,
    inApp: recipients.filter((r) => r.residentId).length,
    email: recipients.filter((r) => r.email).length,
    emailHeldBack: isLiveEnvironment() ? 0 : recipients.filter((r) => r.email && !emailAllowedHere(r.email)).length,
    sample: names.slice(0, 5),
    more: Math.max(0, names.length - 5),
  };
}

/** The text one recipient receives: placeholders filled server-side. */
export function render(text: string, vars: { name: string; listing: string; when: string }): string {
  return text.replace(/\{name\}/g, vars.name || "there").replace(/\{listing\}/g, vars.listing).replace(/\{when\}/g, vars.when);
}

export interface CreateResult { messageId: number; duplicate: boolean }

/**
 * Records the message and one delivery per person and channel, exactly once
 * per (sender, idempotency key): a repeated request returns the first message
 * and sends nothing new.
 */
export async function createMessage(args: {
  senderId: string;
  vendorId: string;
  orgId: string | null;
  spec: AudienceSpec;
  templateKey: TemplateKey;
  subject: string;
  body: string;
  idempotencyKey: string;
  recipients: Recipient[];
}): Promise<CreateResult> {
  return db.transaction(async (tx) => {
    const claimed = await tx.prepare(`INSERT IGNORE INTO vendor_message_requests (vendor_id, idem_key) VALUES (?, ?)`).run(args.senderId, args.idempotencyKey);
    if (claimed.changes !== 1) {
      const prior = (await tx.prepare(`SELECT message_id AS id FROM vendor_message_requests WHERE vendor_id = ? AND idem_key = ?`).get(args.senderId, args.idempotencyKey)) as { id: number | null };
      return { messageId: Number(prior.id), duplicate: true };
    }
    const ins = await tx
      .prepare(
        `INSERT INTO vendor_messages (vendor_id, listing_type, listing_id, subject, body, org_id, sent_by_user_id, audience_json, template_key, recipient_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(args.vendorId, args.spec.listingType, args.spec.listingId, args.subject, args.body, args.orgId, args.senderId, JSON.stringify({ sessionId: args.spec.sessionId ?? null, date: args.spec.date ?? null, filter: args.spec.filter ?? "all" }), args.templateKey, args.recipients.length);
    const messageId = Number(ins.lastInsertRowid);
    await tx.prepare(`UPDATE vendor_message_requests SET message_id = ? WHERE vendor_id = ? AND idem_key = ?`).run(messageId, args.senderId, args.idempotencyKey);
    for (const r of args.recipients) {
      if (r.residentId) await tx.prepare(`INSERT IGNORE INTO vendor_message_deliveries (message_id, recipient_key, channel, source_type, order_ref, resident_id, first_name) VALUES (?, ?, 'in_app', ?, ?, ?, ?)`).run(messageId, r.key, r.source, r.ref, r.residentId, r.name.slice(0, 60));
      if (r.email) await tx.prepare(`INSERT IGNORE INTO vendor_message_deliveries (message_id, recipient_key, channel, source_type, order_ref, resident_id, first_name) VALUES (?, ?, 'email', ?, ?, ?, ?)`).run(messageId, r.key, r.source, r.ref, r.residentId, r.name.slice(0, 60));
    }
    return { messageId, duplicate: false };
  });
}

const EMAIL_SQL: Record<OrderSource, string> = {
  booking: `SELECT email FROM bookings WHERE ref = ?`,
  registration: `SELECT email FROM registrations WHERE ref = ?`,
  program: `SELECT email FROM program_enrollments WHERE ref = ?`,
  experience: `SELECT email FROM experience_bookings WHERE ref = ?`,
};
const NOTIFY_LISTING: Record<AudienceListingType, "centre" | "club" | "program" | "experience"> = { centre: "centre", club: "club", program: "program", experience: "experience" };

/** Sends every queued (or retryable failed) delivery of one message. Safe to run again: sent rows are never resent. */
export async function dispatchMessage(messageId: number): Promise<void> {
  const msg = (await db.prepare(`SELECT id, listing_type AS listingType, listing_id AS listingId, subject, body FROM vendor_messages WHERE id = ?`).get(messageId)) as
    | { id: number; listingType: AudienceListingType; listingId: string; subject: string; body: string }
    | undefined;
  if (!msg) return;
  const title = await titleOf(msg.listingType, msg.listingId);
  const due = (await db
    .prepare(`SELECT id, channel, source_type AS source, order_ref AS ref, resident_id AS residentId, first_name AS name, attempts FROM vendor_message_deliveries WHERE message_id = ? AND (status = 'queued' OR (status = 'failed' AND attempts < ?)) ORDER BY id`)
    .all(messageId, MAX_ATTEMPTS)) as { id: number; channel: "in_app" | "email"; source: OrderSource; ref: string; residentId: string | null; name: string; attempts: number }[];
  for (const d of due) {
    // Claim the row first so two dispatchers never send it twice.
    const claim = await db.prepare(`UPDATE vendor_message_deliveries SET status = 'sending', attempts = attempts + 1 WHERE id = ? AND status IN ('queued', 'failed')`).run(d.id);
    if (claim.changes !== 1) continue;
    const vars = { name: d.name, listing: title, when: "" };
    let status = "sent";
    let error: string | null = null;
    try {
      if (d.channel === "in_app") {
        await notifyResident({ residentId: d.residentId!, kind: "organiser_message", title: render(msg.subject, vars), body: render(msg.body, vars).slice(0, 1000), listingType: NOTIFY_LISTING[msg.listingType], listingId: msg.listingId, ref: `${d.source}/${d.ref}` });
      } else {
        const row = (await db.prepare(EMAIL_SQL[d.source]).get(d.ref)) as { email: string } | undefined;
        if (!row?.email) status = "skipped_no_email";
        else if (!emailAllowedHere(row.email)) status = "held_test_environment";
        else {
          const footer = `\n\n—\nYou're getting this because you booked ${title} on HelloCircle (reference ${d.ref}). Manage your booking in My Life.`;
          const outcome = await deliverMail({ to: row.email, subject: render(msg.subject, vars), text: render(msg.body, vars) + footer });
          status = outcome === "sent" ? "sent" : outcome === "unavailable" ? "skipped_no_transport" : "failed";
          if (outcome === "failed") error = "Delivery failed";
        }
      }
    } catch {
      status = "failed";
      error = "Delivery failed";
    }
    await db.prepare(`UPDATE vendor_message_deliveries SET status = ?, last_error = ?, sent_at = ${status === "sent" ? "NOW()" : "sent_at"} WHERE id = ?`).run(status, error, d.id);
  }
}

async function titleOf(listingType: AudienceListingType, listingId: string): Promise<string> {
  const [table, col] = { centre: ["centres", "name"], club: ["clubs", "name"], program: ["programs", "title"], experience: ["experiences", "title"] }[listingType];
  const row = (await db.prepare(`SELECT ${col} AS t FROM ${table} WHERE id = ?`).get(listingId)) as { t: string } | undefined;
  return row?.t ?? "your booking";
}

/** Retries failed deliveries and picks up any left queued (e.g. after a restart). */
export async function sweepMessageDeliveries(): Promise<number> {
  // A row stuck in 'sending' for 10 minutes (a crash mid-send) goes back to failed so it can be retried.
  await db.prepare(`UPDATE vendor_message_deliveries SET status = 'failed', last_error = 'Interrupted' WHERE status = 'sending' AND updated_at < DATE_SUB(NOW(), INTERVAL 10 MINUTE)`).run();
  const msgs = (await db
    .prepare(`SELECT DISTINCT message_id AS id FROM vendor_message_deliveries WHERE (status = 'queued' AND created_at < DATE_SUB(NOW(), INTERVAL 2 MINUTE)) OR (status = 'failed' AND attempts < ?) LIMIT 50`)
    .all(MAX_ATTEMPTS)) as { id: number }[];
  for (const m of msgs) await dispatchMessage(Number(m.id));
  return msgs.length;
}

/** Delivery status per message: counts by channel and status (no addresses). */
export async function deliverySummary(messageIds: number[]): Promise<Map<number, Record<string, Record<string, number>>>> {
  const out = new Map<number, Record<string, Record<string, number>>>();
  if (!messageIds.length) return out;
  const rows = (await db
    .prepare(`SELECT message_id AS id, channel, status, COUNT(*) AS n FROM vendor_message_deliveries WHERE message_id IN (${ids(messageIds.length)}) GROUP BY message_id, channel, status`)
    .all(...messageIds)) as { id: number; channel: string; status: string; n: number }[];
  for (const r of rows) {
    const m = out.get(Number(r.id)) ?? {};
    m[r.channel] = { ...(m[r.channel] ?? {}), [r.status]: Number(r.n) };
    out.set(Number(r.id), m);
  }
  return out;
}
