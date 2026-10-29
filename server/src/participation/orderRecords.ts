import { db } from "../db/index.js";
import { startIsInFuture } from "../bookingIntegrity.js";
import { irelandTodayIso } from "../irelandTime.js";
import { readAttendees } from "./attendees.js";
import { checkinsFor } from "./checkin.js";
import { formQuestionsOn, personTypeFromDob } from "./formAnswers.js";
import { ANSWER_SOURCE, type AnswerSource, type FormListingType } from "./formListings.js";
import { activeQuestions, cleanAnswers, questionsVersion, QuestionError, readAnswersFor, toPublicQuestion, writeAnswers, type CleanAnswer, type Question, type StoredAnswer } from "./questions.js";

// Phases I–J (docs/participation-expansion/20) — one read of an order of any
// participation type for the resident's booking page and the partner's
// record page: who is taking part, their attendance, the answers as they
// were given (wording and form version kept), what can still be changed,
// and what's missing. Built on the existing order, answer, attendee and
// attendance rows; nothing is copied.

export const ORDER_SOURCES = ["experience", "registration", "program", "booking"] as const;
export type OrderSource = (typeof ORDER_SOURCES)[number];
export const isOrderSource = (v: unknown): v is OrderSource => typeof v === "string" && (ORDER_SOURCES as readonly string[]).includes(v);

const LISTING_OF: Record<OrderSource, FormListingType> = { experience: "experience", registration: "club", program: "program", booking: "centre" };

export interface OrderCore {
  source: OrderSource;
  listingType: FormListingType;
  ref: string;
  listingId: string;
  vendorId: string | null;
  title: string;
  /** Start of the activity (date YYYY-MM-DD and time HH:MM), null when ongoing (club membership). */
  date: string | null;
  time: string | null;
  status: string;
  paymentStatus: string;
  contactName: string;
  email: string;
  phone: string;
  partySize: number;
  /** The registrant / participant of a club registration or programme enrolment. */
  person: { name: string; personType: "adult" | "child" } | null;
  createdAt: string;
  /** Programme enrolments: their id (programme attendance is keyed by it) and the last session date. */
  enrollmentId?: number;
  lastSessionDate?: string | null;
  notes?: string;
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v ?? ""));

/** Loads an order by its reference; `where` narrows ownership (resident/browser or organisation). */
async function loadOrder(source: OrderSource, ref: string): Promise<OrderCore | null> {
  if (source === "experience") {
    const r = (await db
      .prepare(
        `SELECT eb.ref, eb.experience_id AS listingId, e.vendor_id AS vendorId, e.title, es.date, es.time, eb.status, eb.payment_status AS paymentStatus,
                eb.participant_name AS contactName, eb.email, eb.phone, eb.party_size AS partySize, eb.created_at AS createdAt
         FROM experience_bookings eb JOIN experiences e ON e.id = eb.experience_id JOIN experience_sessions es ON es.id = eb.session_id WHERE eb.ref = ?`
      )
      .get(ref)) as Record<string, any> | undefined;
    if (!r) return null;
    return { source, listingType: "experience", ref: r.ref, listingId: r.listingId, vendorId: r.vendorId, title: r.title, date: r.date, time: r.time, status: r.status, paymentStatus: r.paymentStatus, contactName: r.contactName, email: r.email, phone: r.phone ?? "", partySize: Number(r.partySize), person: null, createdAt: iso(r.createdAt) };
  }
  if (source === "registration") {
    const r = (await db
      .prepare(
        `SELECT r.ref, r.club_id AS listingId, c.vendor_id AS vendorId, c.name AS title, r.status, r.payment_status AS paymentStatus, r.child_first, r.child_last,
                r.registrant_type AS registrantType, r.g_first, r.g_last, r.email, r.phone, r.created_at AS createdAt
         FROM registrations r JOIN clubs c ON c.id = r.club_id WHERE r.ref = ?`
      )
      .get(ref)) as Record<string, any> | undefined;
    if (!r) return null;
    const name = `${r.child_first} ${r.child_last}`.trim();
    return { source, listingType: "club", ref: r.ref, listingId: r.listingId, vendorId: r.vendorId, title: r.title, date: null, time: null, status: r.status, paymentStatus: r.paymentStatus, contactName: `${r.g_first} ${r.g_last}`.trim() || name, email: r.email, phone: r.phone ?? "", partySize: 1, person: { name, personType: r.registrantType === "adult" ? "adult" : "child" }, createdAt: iso(r.createdAt) };
  }
  if (source === "program") {
    const r = (await db
      .prepare(
        `SELECT pe.id, pe.ref, pe.program_id AS listingId, p.vendor_id AS vendorId, p.title, pe.status, pe.payment_status AS paymentStatus, pe.participant_name AS name,
                pe.participant_dob AS dob, pe.email, pe.phone, pe.created_at AS createdAt,
                (SELECT MIN(CONCAT(s.date, ' ', s.time)) FROM program_sessions s WHERE s.program_id = p.id AND s.status <> 'cancelled' AND s.date >= ?) AS nextStart,
                (SELECT MAX(s.date) FROM program_sessions s WHERE s.program_id = p.id AND s.status <> 'cancelled') AS lastDate
         FROM program_enrollments pe JOIN programs p ON p.id = pe.program_id WHERE pe.ref = ?`
      )
      .get(irelandTodayIso(), ref)) as Record<string, any> | undefined;
    if (!r) return null;
    const [date, time] = r.nextStart ? String(r.nextStart).split(" ") : [null, null];
    return { source, listingType: "program", ref: r.ref, listingId: r.listingId, vendorId: r.vendorId, title: r.title, date, time, status: r.status, paymentStatus: r.paymentStatus, contactName: r.name, email: r.email, phone: r.phone ?? "", partySize: 1, person: { name: r.name, personType: personTypeFromDob(r.dob) }, createdAt: iso(r.createdAt), enrollmentId: Number(r.id), lastSessionDate: r.lastDate ?? null };
  }
  const r = (await db
    .prepare(
      `SELECT b.ref, b.centre_id AS listingId, c.vendor_id AS vendorId, c.name AS title, b.date, b.time, b.status, b.payment_status AS paymentStatus, b.name, b.email, b.phone,
              b.guests, b.notes, b.created_at AS createdAt
       FROM bookings b JOIN centres c ON c.id = b.centre_id WHERE b.ref = ?`
    )
    .get(ref)) as Record<string, any> | undefined;
  if (!r) return null;
  return { source, listingType: "centre", ref: r.ref, listingId: r.listingId, vendorId: r.vendorId, title: r.title, date: r.date, time: r.time, status: r.status, paymentStatus: r.paymentStatus, contactName: r.name, email: r.email, phone: r.phone ?? "", partySize: Number(r.guests ?? 1), person: null, createdAt: iso(r.createdAt), notes: r.notes ?? "" };
}

const OWNER_SQL: Record<OrderSource, string> = {
  experience: `SELECT client_id AS c, resident_id AS r FROM experience_bookings WHERE ref = ?`,
  registration: `SELECT client_id AS c, resident_id AS r FROM registrations WHERE ref = ?`,
  program: `SELECT client_id AS c, resident_id AS r FROM program_enrollments WHERE ref = ?`,
  booking: `SELECT client_id AS c, resident_id AS r FROM bookings WHERE ref = ?`,
};

/** The order when this browser (client id) or signed-in resident made it; otherwise null (reads as "not found"). */
export async function ownedOrder(source: OrderSource, ref: string, clientId: string | null, residentId: string | null): Promise<OrderCore | null> {
  const o = (await db.prepare(OWNER_SQL[source]).get(ref)) as { c: string | null; r: string | null } | undefined;
  if (!o) return null;
  const mine = (!!clientId && o.c === clientId) || (!!residentId && o.r === residentId);
  return mine ? loadOrder(source, ref) : null;
}

/** Phase K — the order by reference for the reminder sweep (server-side only, no caller identity). */
export const ownedOrderForReminder = (source: OrderSource, ref: string) => loadOrder(source, ref);

/** The order when one of `vendorIds` (the caller's organisation) owns its listing; otherwise null. */
export async function orgOrder(source: OrderSource, ref: string, vendorIds: string[]): Promise<OrderCore | null> {
  const order = await loadOrder(source, ref);
  return order && order.vendorId && vendorIds.includes(order.vendorId) ? order : null;
}

export interface OrderPerson {
  attendeeNo: number;
  name: string;
  personType: "adult" | "child";
  lineLabel: string | null;
  guardianName: string | null;
  status: "active" | "removed";
  recorded: boolean;
  /** Admission: experiences per person at the door; halls and clubs per order. */
  checkedInAt: string | null;
}

export interface Attendance {
  /** What the record can say about attendance for this kind of order. */
  kind: "door" | "order" | "sessions" | "none";
  /** order: "attended" | "no_show" | null; sessions: counts. */
  status: string | null;
  checkedInAt: string | null;
  sessionsAttended?: number;
  sessionsMarked?: number;
  sessionsTotal?: number;
}

export async function orderPeople(order: OrderCore): Promise<OrderPerson[]> {
  if (order.source === "experience") {
    const people = await readAttendees("experience", { ref: order.ref, partySize: order.partySize, participantName: order.contactName });
    const checks = (await checkinsFor([order.ref])).get(order.ref) ?? [];
    return people.map((p) => {
      const hit = checks.find((c) => Number(c.attendee_no) === p.attendeeNo);
      return { attendeeNo: p.attendeeNo, name: p.name, personType: p.personType, lineLabel: p.lineLabel, guardianName: p.guardianName, status: p.status, recorded: p.recorded, checkedInAt: hit ? new Date(hit.checked_in_at).toISOString() : null };
    });
  }
  if (!order.person) return [];
  return [{ attendeeNo: 1, name: order.person.name, personType: order.person.personType, lineLabel: null, guardianName: null, status: order.status === "cancelled" ? "removed" : "active", recorded: true, checkedInAt: null }];
}

export async function orderAttendance(order: OrderCore): Promise<Attendance> {
  if (order.source === "experience") {
    const a = (await db.prepare(`SELECT status, checked_in_at AS at FROM attendance WHERE kind = 'experience' AND ref = ?`).get(order.ref)) as { status: string; at: Date } | undefined;
    return { kind: "door", status: a?.status ?? null, checkedInAt: a ? iso(a.at) : null };
  }
  if (order.source === "booking" || order.source === "registration") {
    const a = (await db.prepare(`SELECT status, checked_in_at AS at FROM attendance WHERE kind = ? AND ref = ?`).get(order.source, order.ref)) as { status: string; at: Date } | undefined;
    return { kind: "order", status: a ? (a.status === "no_show" ? "no_show" : "attended") : null, checkedInAt: a ? iso(a.at) : null };
  }
  const total = (await db.prepare(`SELECT COUNT(*) AS n FROM program_sessions WHERE program_id = ? AND status <> 'cancelled' AND date <= ?`).get(order.listingId, irelandTodayIso())) as { n: number };
  const rows = (await db.prepare(`SELECT status FROM attendance WHERE kind = 'program_session' AND ref LIKE ?`).all(`%:${order.enrollmentId}`)) as { status: string }[];
  return { kind: "sessions", status: null, checkedInAt: null, sessionsAttended: rows.filter((r) => r.status === "present" || r.status === "late").length, sessionsMarked: rows.length, sessionsTotal: Number(total.n) };
}

/**
 * Until when a resident may change answers. Never once cancelled or unpaid.
 * experience / hall: until the start; programme: until its last session
 * day has passed; club membership (ongoing): while the registration is active.
 */
export function answersEditableNow(order: OrderCore): { editable: boolean; reason: string | null } {
  if (order.status === "cancelled") return { editable: false, reason: "This booking is cancelled" };
  if (order.paymentStatus !== "paid") return { editable: false, reason: "Answers can be changed once the booking is confirmed" };
  if (order.source === "experience" || order.source === "booking") {
    if (!order.date || !order.time || !startIsInFuture(order.date, order.time)) return { editable: false, reason: "Answers can't be changed once it has started" };
  }
  if (order.source === "program" && (!order.lastSessionDate || order.lastSessionDate < irelandTodayIso())) return { editable: false, reason: "The programme has finished" };
  return { editable: true, reason: null };
}

/** Required questions without an answer, as "Name: question" (or the question for once-per-booking ones). */
export function missingRequired(questions: Question[], answers: StoredAnswer[], people: OrderPerson[]): string[] {
  const active = people.filter((p) => p.status === "active");
  return questions
    .filter((q) => q.required && q.inputType !== "info")
    .flatMap((q) =>
      q.scope === "booking"
        ? answers.some((a) => a.attendeeNo === 0 && a.key === q.key) ? [] : [q.label]
        : active.filter((p) => (q.appliesTo === "all" || q.appliesTo === p.personType) && !answers.some((a) => a.attendeeNo === p.attendeeNo && a.key === q.key)).map((p) => `${p.name}: ${q.label}`)
    );
}

export interface RegistrationView {
  ref: string;
  source: OrderSource;
  title: string;
  kind: string;
  date: string | null;
  time: string | null;
  status: string;
  paymentStatus: string;
  contactName: string;
  partySize: number;
  attendees: OrderPerson[];
  attendance: Attendance;
  answers: StoredAnswer[];
  /** The live form, when the organiser asks questions (answers keep their own wording). */
  questions: ReturnType<typeof toPublicQuestion>[];
  questionsVersion: number;
  /** The form versions these answers were given on. */
  answeredVersions: number[];
  canEditAnswers: boolean;
  editNote: string | null;
  /** Answers the resident can't change any more (question marked "can't be changed after booking"). */
  lockedAnswers: { key: string; attendeeNo: number }[];
  missingAnswers: string[];
}

/** The resident's view: their own order only (the caller checked ownership). */
export async function registrationView(order: OrderCore): Promise<RegistrationView> {
  const people = await orderPeople(order);
  const answers = (await readAnswersFor(ANSWER_SOURCE[order.listingType], [order.ref])).get(order.ref) ?? [];
  const on = await formQuestionsOn(order.vendorId);
  const questions = on ? await activeQuestions(order.listingType, order.listingId) : [];
  const window = answersEditableNow(order);
  const editable = on && questions.some((q) => q.inputType !== "info") && window.editable;
  const lockedKeys = new Set(questions.filter((q) => q.editability === "locked").map((q) => q.key));
  return {
    ref: order.ref,
    source: order.source,
    title: order.title,
    kind: order.listingType,
    date: order.date,
    time: order.time,
    status: order.status,
    paymentStatus: order.paymentStatus,
    contactName: order.contactName,
    partySize: order.partySize,
    attendees: people,
    attendance: await orderAttendance(order),
    answers,
    questions: questions.map(toPublicQuestion),
    questionsVersion: on ? await questionsVersion(order.listingId, db, order.listingType) : 0,
    answeredVersions: [...new Set(answers.map((a) => a.version))].sort((a, b) => a - b),
    canEditAnswers: editable,
    editNote: questions.length && !window.editable ? window.reason : null,
    lockedAnswers: answers.filter((a) => lockedKeys.has(a.key)).map((a) => ({ key: a.key, attendeeNo: a.attendeeNo })),
    missingAnswers: editable ? missingRequired(questions, answers, people) : [],
  };
}

/**
 * The resident changes their answers. Same rules as booking: the live form,
 * its version, required answers and conditions. A "can't be changed after
 * booking" answer keeps what was given. Nothing about the order itself
 * (price, places, dates) changes. Returns the keys changed (for the audit).
 */
export async function saveOrderAnswers(order: OrderCore, body: { answers?: unknown; questionsVersion?: unknown }, byKind: "booker" | "resident"): Promise<string[]> {
  if (!(await formQuestionsOn(order.vendorId))) throw new QuestionError("This isn't available yet", 404);
  const window = answersEditableNow(order);
  if (!window.editable) throw new QuestionError(window.reason ?? "Answers can't be changed now", 409, "not_editable");
  const questions = await activeQuestions(order.listingType, order.listingId);
  const version = await questionsVersion(order.listingId, db, order.listingType);
  if (body.questionsVersion !== version) throw new QuestionError("The organiser changed the questions — reload to see them", 409, "questions_changed");
  const people = (await orderPeople(order)).filter((p) => p.status === "active");
  const cleaned: CleanAnswer[] = cleanAnswers(questions, body.answers, people);
  const source: AnswerSource = ANSWER_SOURCE[order.listingType];
  const existing = (await readAnswersFor(source, [order.ref])).get(order.ref) ?? [];
  const lockedKeys = new Set(questions.filter((q) => q.editability === "locked").map((q) => q.key));
  const given = (key: string, no: number) => existing.some((a) => a.key === key && a.attendeeNo === no);
  const toWrite = cleaned.filter((a) => !(lockedKeys.has(a.question.key) && given(a.question.key, a.attendeeNo)));
  const editableKeys = questions.filter((q) => !lockedKeys.has(q.key)).map((q) => q.key);
  await db.transaction(async (tx) => {
    if (editableKeys.length) {
      await tx.prepare(`DELETE FROM registration_answers WHERE source_type = ? AND source_ref = ? AND qkey IN (${editableKeys.map(() => "?").join(", ")})`).run(source, order.ref, ...editableKeys);
    }
    await writeAnswers(tx, source, order.ref, version, toWrite, byKind, false);
  });
  return [...new Set(toWrite.map((a) => a.question.key))];
}

export const listingTypeOf = (source: OrderSource) => LISTING_OF[source];
