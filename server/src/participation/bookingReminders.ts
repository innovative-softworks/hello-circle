import { db } from "../db/index.js";
import { featureOn } from "../circleFeatures.js";
import { irelandTodayIso } from "../irelandTime.js";
import { notifyResident } from "../notifications.js";
import { formQuestionsOn } from "./formAnswers.js";
import { missingRequired, orderPeople, orderByRef, type OrderSource } from "./orderRecords.js";
import { activeQuestions, readAnswersFor } from "./questions.js";
import { ANSWER_SOURCE } from "./formListings.js";

// Phase K (docs/participation-expansion/20) — the day-before reminder for a
// confirmed booking: when and where, a reminder to bring the pass for check-in,
// and a note when the organiser is still waiting for registration answers.
// In-app (and push on the app) through notifyResident, so the resident's
// "Booking reminders" setting applies. Behind participation.reminders (off by
// default). Once per order and day: the notification itself is the record.
// Signed-in residents only — a guest's email confirmation already says when.

const MAX_PER_SWEEP = 200;

interface Due { source: OrderSource; ref: string; residentId: string; date: string; time: string; title: string; where: string; listingType: "experience" | "club" | "program" | "centre"; listingId: string }

async function dueTomorrow(tomorrow: string): Promise<Due[]> {
  const exp = (await db
    .prepare(
      `SELECT 'experience' AS source, eb.ref, eb.resident_id AS residentId, es.date, es.time, e.title, e.meeting_point AS place, e.id AS listingId, 'experience' AS listingType
       FROM experience_bookings eb JOIN experience_sessions es ON es.id = eb.session_id JOIN experiences e ON e.id = eb.experience_id
       WHERE es.date = ? AND eb.resident_id IS NOT NULL AND eb.payment_status = 'paid' AND eb.status <> 'cancelled' AND COALESCE(es.status, 'scheduled') <> 'cancelled'`
    )
    .all(tomorrow)) as Record<string, string>[];
  const halls = (await db
    .prepare(
      `SELECT 'booking' AS source, b.ref, b.resident_id AS residentId, b.date, b.time, c.name AS title, CONCAT(c.area, ', ', c.county) AS place, c.id AS listingId, 'centre' AS listingType
       FROM bookings b JOIN centres c ON c.id = b.centre_id WHERE b.date = ? AND b.resident_id IS NOT NULL AND b.payment_status = 'paid' AND b.status <> 'cancelled'`
    )
    .all(tomorrow)) as Record<string, string>[];
  const progs = (await db
    .prepare(
      `SELECT 'program' AS source, pe.ref, pe.resident_id AS residentId, s.date, s.time, p.title, '' AS place, p.id AS listingId, 'program' AS listingType
       FROM program_enrollments pe JOIN programs p ON p.id = pe.program_id JOIN program_sessions s ON s.program_id = p.id
       WHERE s.date = ? AND s.status <> 'cancelled' AND pe.resident_id IS NOT NULL AND pe.payment_status = 'paid' AND pe.status <> 'cancelled'`
    )
    .all(tomorrow)) as Record<string, string>[];
  return [...exp, ...halls, ...progs].map((r) => ({ source: r.source as OrderSource, ref: r.ref, residentId: r.residentId, date: r.date, time: r.time, title: r.title, where: r.place ?? "", listingType: r.listingType as Due["listingType"], listingId: r.listingId }));
}

const addDay = (iso: string) => new Date(Date.parse(`${iso}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** Sends due reminders; returns how many were sent. Safe to run often. */
export async function sweepBookingReminders(today = irelandTodayIso()): Promise<number> {
  if (!(await featureOn("participation.reminders"))) return 0;
  const tomorrow = addDay(today);
  let sent = 0;
  for (const d of (await dueTomorrow(tomorrow)).slice(0, MAX_PER_SWEEP)) {
    const key = `${d.source}/${d.ref}`;
    // Once per order and day (a programme gets one per session day).
    const already = await db.prepare(`SELECT id FROM notifications WHERE resident_id = ? AND kind = 'reminder' AND ref = ? AND body LIKE ? LIMIT 1`).get(d.residentId, key, `%${tomorrow}%`);
    if (already) continue;
    const order = await orderByRef(d.source, d.ref);
    let waiting = false;
    if (order && (await formQuestionsOn(order.vendorId))) {
      const questions = await activeQuestions(order.listingType, order.listingId);
      const answers = (await readAnswersFor(ANSWER_SOURCE[order.listingType], [order.ref])).get(order.ref) ?? [];
      waiting = missingRequired(questions, answers, await orderPeople(order)).length > 0;
    }
    const parts = [`Tomorrow (${tomorrow}) at ${d.time}${d.where ? ` · ${d.where}` : ""}.`, "Show your pass at the door to check in."];
    if (waiting) parts.push("The organiser is still waiting for some of your answers — add them on your booking page.");
    await notifyResident({ residentId: d.residentId, kind: "reminder", title: `Reminder: ${d.title}`, body: parts.join(" "), listingType: d.listingType === "centre" ? "centre" : d.listingType === "program" ? "program" : "experience", listingId: d.listingId, ref: key });
    sent++;
  }
  return sent;
}
