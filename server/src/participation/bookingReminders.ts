import { db } from "../db/index.js";
import { featureOn } from "../circleFeatures.js";
import { reportException } from "../errorReporting.js";
import { irelandTodayIso } from "../irelandTime.js";
import { notifyResidentWithOutcome } from "../notifications.js";
import { formQuestionsOn } from "./formAnswers.js";
import { missingRequired, orderPeople, orderByRef, type OrderSource } from "./orderRecords.js";
import { activeQuestions, readAnswersFor } from "./questions.js";
import { ANSWER_SOURCE } from "./formListings.js";

// Phase K (docs/participation-expansion/20) — the day-before reminder for a
// confirmed booking: when and where, a reminder to bring the pass for check-in,
// and a note when the organiser is still waiting for registration answers.
// In-app (and push on the app) through notifyResidentWithOutcome, so the
// resident's "Booking reminders" setting applies. Behind participation.reminders
// (off by default). Signed-in residents only — a guest's email confirmation
// already says when.
//
// Pilot remediation (final-validation/14, DEF-03): every due order is reached.
// - Due orders are read in stable pages keyed on (source, ref); orders that are
//   already sent, skipped, given up on, or being sent right now are filtered out
//   in SQL, so a page never fills up with finished work.
// - booking_reminder_sends is the claim: one row per order and reminder day. Only
//   the run that inserts it (or atomically re-claims a failed or stale one) sends,
//   so overlapping runs and restarts can't send twice.
// - Each claimed order is re-checked just before sending (cancelled or moved in the
//   meantime → claim released, nothing sent). No transaction is held while delivering.
// - attempts counts tries; status 'sent' and sent_at only after the in-app notice
//   was written. Failures stay retryable (up to MAX_ATTEMPTS) and are reported.

const PAGE = 200;
const MAX_PAGES = 100; // 20,000 per sweep; the next sweep carries on from what's left
const MAX_ATTEMPTS = 3;
const STALE_MINUTES = 15; // a 'sending' claim older than this was abandoned (crash or restart)

interface Due { source: OrderSource; ref: string; residentId: string; date: string; time: string; title: string; where: string; listingType: "experience" | "club" | "program" | "centre"; listingId: string }

const dueSql = (oneOrder: boolean) => {
  const claimFilter = oneOrder
    ? ""
    : `AND NOT EXISTS (
      SELECT 1 FROM booking_reminder_sends r
      WHERE r.source_type = d.source AND r.order_ref = d.ref AND r.remind_for = ?
        AND (r.status = 'sent' OR r.status LIKE 'skipped%' OR (r.status = 'failed' AND r.attempts >= ${MAX_ATTEMPTS})
             OR (r.status = 'sending' AND r.claimed_at > DATE_SUB(NOW(), INTERVAL ${STALE_MINUTES} MINUTE)))
    )`;
  return `
  SELECT * FROM (
    SELECT 'booking' AS source, b.ref, b.resident_id AS residentId, b.date, b.time, c.name AS title, CONCAT(c.area, ', ', c.county) AS place, c.id AS listingId, 'centre' AS listingType
      FROM bookings b JOIN centres c ON c.id = b.centre_id
      WHERE b.date = ? AND b.resident_id IS NOT NULL AND b.payment_status = 'paid' AND b.status <> 'cancelled'
    UNION ALL
    SELECT 'experience', eb.ref, eb.resident_id, es.date, es.time, e.title, e.meeting_point, e.id, 'experience'
      FROM experience_bookings eb JOIN experience_sessions es ON es.id = eb.session_id JOIN experiences e ON e.id = eb.experience_id
      WHERE es.date = ? AND eb.resident_id IS NOT NULL AND eb.payment_status = 'paid' AND eb.status <> 'cancelled' AND COALESCE(es.status, 'scheduled') <> 'cancelled'
    UNION ALL
    SELECT 'program', pe.ref, pe.resident_id, MIN(s.date), MIN(s.time), p.title, '', p.id, 'program'
      FROM program_enrollments pe JOIN programs p ON p.id = pe.program_id JOIN program_sessions s ON s.program_id = p.id
      WHERE s.date = ? AND s.status <> 'cancelled' AND pe.resident_id IS NOT NULL AND pe.payment_status = 'paid' AND pe.status <> 'cancelled'
      GROUP BY pe.ref, pe.resident_id, p.title, p.id
  ) d
  WHERE ${oneOrder ? "d.source = ? AND d.ref = ?" : "(d.source > ? OR (d.source = ? AND d.ref > ?))"}
    ${claimFilter}
  ORDER BY d.source, d.ref
  LIMIT ${PAGE}`;
};

const toDue = (r: Record<string, unknown>): Due => ({
  source: r.source as OrderSource,
  ref: String(r.ref),
  residentId: String(r.residentId),
  date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date).slice(0, 10),
  time: String(r.time ?? ""),
  title: String(r.title ?? ""),
  where: String(r.place ?? ""),
  listingType: r.listingType as Due["listingType"],
  listingId: String(r.listingId),
});

async function duePage(day: string, after: { source: string; ref: string }): Promise<Due[]> {
  return ((await db.prepare(dueSql(false)).all(day, day, day, after.source, after.source, after.ref, day)) as Record<string, unknown>[]).map(toDue);
}

/** The same rule for one order, read again just before sending (without the claim filter:
 * this run's own fresh 'sending' claim would otherwise hide it). */
async function stillDue(d: Due, day: string): Promise<Due | null> {
  const row = (await db.prepare(dueSql(true)).get(day, day, day, d.source, d.ref)) as Record<string, unknown> | undefined;
  return row ? toDue(row) : null;
}

/** Takes the claim for one order and day; false when another run owns or finished it. */
async function claim(d: Due, day: string): Promise<boolean> {
  const ins = await db.prepare(`INSERT IGNORE INTO booking_reminder_sends (source_type, order_ref, remind_for, resident_id) VALUES (?, ?, ?, ?)`).run(d.source, d.ref, day, d.residentId);
  if (ins.changes === 1) return true;
  const again = await db
    .prepare(
      `UPDATE booking_reminder_sends SET status = 'sending', attempts = attempts + 1, claimed_at = NOW(), last_error = NULL
       WHERE source_type = ? AND order_ref = ? AND remind_for = ?
         AND ((status = 'failed' AND attempts < ${MAX_ATTEMPTS}) OR (status = 'sending' AND claimed_at <= DATE_SUB(NOW(), INTERVAL ${STALE_MINUTES} MINUTE)))`
    )
    .run(d.source, d.ref, day);
  return again.changes === 1;
}

const finish = (d: Due, day: string, status: string, extra: { sent?: boolean; push?: string | null; error?: string | null } = {}) =>
  db
    .prepare(`UPDATE booking_reminder_sends SET status = ?, sent_at = ${extra.sent ? "NOW()" : "sent_at"}, push_status = ?, last_error = ? WHERE source_type = ? AND order_ref = ? AND remind_for = ?`)
    .run(status, extra.push ?? null, extra.error ?? null, d.source, d.ref, day);

async function sendOne(claimed: Due, day: string): Promise<"sent" | "skipped" | "failed"> {
  try {
    const d = await stillDue(claimed, day);
    if (!d || d.residentId !== claimed.residentId) {
      // Cancelled, moved to another day or reassigned since the page was read: release the
      // claim so the order is judged afresh by later sweeps (a session moved back is still reminded).
      await db.prepare(`DELETE FROM booking_reminder_sends WHERE source_type = ? AND order_ref = ? AND remind_for = ? AND status = 'sending'`).run(claimed.source, claimed.ref, day);
      return "skipped";
    }
    const order = await orderByRef(d.source, d.ref);
    let waiting = false;
    if (order && (await formQuestionsOn(order.vendorId))) {
      const questions = await activeQuestions(order.listingType, order.listingId);
      const answers = (await readAnswersFor(ANSWER_SOURCE[order.listingType], [order.ref])).get(order.ref) ?? [];
      waiting = missingRequired(questions, answers, await orderPeople(order)).length > 0;
    }
    const parts = [`Tomorrow (${day}) at ${d.time}${d.where ? ` · ${d.where}` : ""}.`, "Show your pass at the door to check in."];
    if (waiting) parts.push("The organiser is still waiting for some of your answers — add them on your booking page.");
    const outcome = await notifyResidentWithOutcome({
      residentId: d.residentId,
      kind: "reminder",
      title: `Reminder: ${d.title}`,
      body: parts.join(" "),
      listingType: d.listingType === "centre" ? "centre" : d.listingType === "program" ? "program" : "experience",
      listingId: d.listingId,
      ref: `${d.source}/${d.ref}`,
    });
    if (outcome.inApp === "skipped_preference") {
      await finish(d, day, "skipped_preference");
      return "skipped";
    }
    await finish(d, day, "sent", { sent: true, push: outcome.push });
    return "sent";
  } catch (e) {
    reportException("job.booking-reminders.delivery", e);
    await finish(claimed, day, "failed", { error: String((e as Error)?.message ?? e).slice(0, 120) }).catch((err) => reportException("job.booking-reminders.record", err));
    return "failed";
  }
}

/** Sends due reminders; returns how many were sent. Safe to run often and in parallel. */
export async function sweepBookingReminders(today = irelandTodayIso()): Promise<number> {
  return (await sweepBookingRemindersDetailed(today)).sent;
}

export async function sweepBookingRemindersDetailed(today = irelandTodayIso()): Promise<{ sent: number; skipped: number; failed: number; claimedElsewhere: number }> {
  const out = { sent: 0, skipped: 0, failed: 0, claimedElsewhere: 0 };
  if (!(await featureOn("participation.reminders"))) return out;
  // Overlapping runs (this process or another) are safe: each order is sent only by the run holding its claim.
  {
    const day = addDay(today);
    let after = { source: "", ref: "" };
    for (let page = 0; page < MAX_PAGES; page++) {
      const due = await duePage(day, after);
      if (!due.length) break;
      for (const d of due) {
        if (!(await claim(d, day))) {
          out.claimedElsewhere++;
          continue;
        }
        out[await sendOne(d, day)]++;
      }
      const last = due[due.length - 1];
      after = { source: last.source, ref: last.ref };
    }
  }
  return out;
}

const addDay = (iso: string) => new Date(Date.parse(`${iso}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
