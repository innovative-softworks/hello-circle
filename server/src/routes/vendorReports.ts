import { Router, type Request } from "express";
import { requirePlatformRole } from "../auth.js";
import { writeAudit } from "../audit.js";
import { db } from "../db/index.js";
import { irelandTodayIso } from "../irelandTime.js";
import { formQuestionsOn } from "../participation/formAnswers.js";
import { ANSWER_SOURCE } from "../participation/formListings.js";
import { missingRequired, orderPeople, orderByRef, type OrderSource } from "../participation/orderRecords.js";
import { activeQuestions, readAnswersFor, type Question } from "../participation/questions.js";
import { inClause } from "./vendorHelpers.js";

// Phase L (docs/participation-expansion/20) — the organisation's participation
// report: registrations by listing type, attendance, capacity, cancellations
// by month and registration-form completion. Counts only — no names, contact
// details or answers — so the order roles and the read-only analyst can read
// it. Always the caller's own organisation (req.vendorIds). The CSV is the same
// numbers and every download is audited.

export const vendorReportsRouter = Router();
const REPORT_ROLES = ["centre_manager", "facility_manager", "finance", "read_only_analyst"] as const;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const shift = (iso: string, days: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const n = (v: unknown) => Number(v ?? 0);

function range(req: Request): { from: string; to: string } | null {
  const today = irelandTodayIso();
  const from = typeof req.query.from === "string" && DAY.test(req.query.from) ? req.query.from : shift(today, -90);
  const to = typeof req.query.to === "string" && DAY.test(req.query.to) ? req.query.to : today;
  if (from > to || Date.parse(to) - Date.parse(from) > 366 * 86_400_000) return null;
  return { from, to };
}

export interface ParticipationReport {
  from: string;
  to: string;
  byType: { type: string; orders: number; active: number; cancelled: number; people: number }[];
  attendance: { type: string; expected: number; attended: number; noShow: number; unmarked: number }[];
  capacity: { type: string; offered: number; taken: number }[];
  cancellationsByMonth: { month: string; type: string; total: number; cancelled: number }[];
  forms: { listingsWithForm: number; ordersChecked: number; complete: number; incomplete: number; truncated: boolean };
}

const FORM_CHECK_LIMIT = 1000;

export async function participationReport(vendorIds: string[], from: string, to: string): Promise<ParticipationReport> {
  const ids = inClause(vendorIds);
  const today = irelandTodayIso();
  const pastTo = to < today ? to : shift(today, -1);
  // Activity date for dated orders (experiences, halls), order date for clubs and programmes.
  const typeRows = async (sql: string, params: unknown[]) => (await db.prepare(sql).get(...params)) as Record<string, unknown>;
  const exp = await typeRows(
    `SELECT COUNT(*) AS orders, SUM(eb.status <> 'cancelled') AS active, SUM(eb.status = 'cancelled') AS cancelled, SUM(CASE WHEN eb.status <> 'cancelled' THEN eb.party_size ELSE 0 END) AS people
     FROM experience_bookings eb JOIN experience_sessions es ON es.id = eb.session_id JOIN experiences e ON e.id = eb.experience_id
     WHERE e.vendor_id IN (${ids}) AND eb.payment_status IN ('paid', 'refunded') AND es.date BETWEEN ? AND ?`,
    [...vendorIds, from, to]
  );
  const hall = await typeRows(
    `SELECT COUNT(*) AS orders, SUM(b.status <> 'cancelled') AS active, SUM(b.status = 'cancelled') AS cancelled, SUM(CASE WHEN b.status <> 'cancelled' THEN b.guests ELSE 0 END) AS people
     FROM bookings b JOIN centres c ON c.id = b.centre_id WHERE c.vendor_id IN (${ids}) AND b.payment_status IN ('paid', 'refunded') AND b.date BETWEEN ? AND ?`,
    [...vendorIds, from, to]
  );
  const club = await typeRows(
    `SELECT COUNT(*) AS orders, SUM(r.status <> 'cancelled') AS active, SUM(r.status = 'cancelled') AS cancelled, SUM(r.status <> 'cancelled') AS people
     FROM registrations r JOIN clubs c ON c.id = r.club_id WHERE c.vendor_id IN (${ids}) AND r.payment_status IN ('paid', 'refunded') AND DATE(r.created_at) BETWEEN ? AND ?`,
    [...vendorIds, from, to]
  );
  const prog = await typeRows(
    `SELECT COUNT(*) AS orders, SUM(pe.status <> 'cancelled') AS active, SUM(pe.status = 'cancelled') AS cancelled, SUM(pe.status <> 'cancelled') AS people
     FROM program_enrollments pe JOIN programs p ON p.id = pe.program_id WHERE p.vendor_id IN (${ids}) AND pe.payment_status IN ('paid', 'refunded') AND DATE(pe.created_at) BETWEEN ? AND ?`,
    [...vendorIds, from, to]
  );
  const byType = (
    [
      ["Events and experiences", exp],
      ["Hall bookings", hall],
      ["Club registrations", club],
      ["Programme enrolments", prog],
    ] as [string, Record<string, unknown>][]
  ).map(([type, r]) => ({ type, orders: n(r.orders), active: n(r.active), cancelled: n(r.cancelled), people: n(r.people) }));

  // Attendance for what has already happened in the range.
  const expAtt = await typeRows(
    `SELECT SUM(eb.party_size) AS expected,
            (SELECT COUNT(*) FROM attendee_checkins ac JOIN experience_bookings b2 ON b2.ref = ac.source_ref AND ac.source_type = 'experience'
               JOIN experience_sessions s2 ON s2.id = b2.session_id JOIN experiences e2 ON e2.id = b2.experience_id
               WHERE e2.vendor_id IN (${ids}) AND b2.status <> 'cancelled' AND b2.payment_status = 'paid' AND s2.date BETWEEN ? AND ?) AS attended,
            SUM(EXISTS (SELECT 1 FROM attendance a WHERE a.kind = 'experience' AND a.ref = eb.ref AND a.status = 'no_show')) AS noShow
     FROM experience_bookings eb JOIN experience_sessions es ON es.id = eb.session_id JOIN experiences e ON e.id = eb.experience_id
     WHERE e.vendor_id IN (${ids}) AND eb.status <> 'cancelled' AND eb.payment_status = 'paid' AND es.date BETWEEN ? AND ?`,
    [...vendorIds, from, pastTo, ...vendorIds, from, pastTo]
  );
  const orderAtt = async (kind: "booking" | "registration", sql: string) => {
    const r = await typeRows(sql, [...vendorIds, from, pastTo]);
    return { expected: n(r.expected), attended: n(r.attended), noShow: n(r.noShow) };
  };
  const hallAtt = await orderAtt(
    "booking",
    `SELECT COUNT(*) AS expected, SUM(a.status IS NOT NULL AND a.status <> 'no_show') AS attended, SUM(a.status = 'no_show') AS noShow
     FROM bookings b JOIN centres c ON c.id = b.centre_id LEFT JOIN attendance a ON a.kind = 'booking' AND a.ref = b.ref
     WHERE c.vendor_id IN (${ids}) AND b.status <> 'cancelled' AND b.payment_status = 'paid' AND b.date BETWEEN ? AND ?`
  );
  const progAtt = await typeRows(
    `SELECT COUNT(*) AS expected, SUM(a.status IN ('present', 'late')) AS attended, SUM(a.status IN ('absent', 'no_show')) AS noShow
     FROM program_enrollments pe JOIN programs p ON p.id = pe.program_id JOIN program_sessions s ON s.program_id = p.id
     LEFT JOIN attendance a ON a.kind = 'program_session' AND a.ref = CONCAT(s.id, ':', pe.id)
     WHERE p.vendor_id IN (${ids}) AND pe.status <> 'cancelled' AND pe.payment_status = 'paid' AND s.status <> 'cancelled' AND s.date BETWEEN ? AND ?`,
    [...vendorIds, from, pastTo]
  );
  const att = (type: string, r: { expected: number; attended: number; noShow: number }) => ({ type, ...r, unmarked: Math.max(0, r.expected - r.attended - r.noShow) });
  const attendance = [
    att("Events and experiences (people)", { expected: n(expAtt.expected), attended: n(expAtt.attended), noShow: n(expAtt.noShow) }),
    att("Hall bookings", hallAtt),
    att("Programme sessions (per person)", { expected: n(progAtt.expected), attended: n(progAtt.attended), noShow: n(progAtt.noShow) }),
  ];

  const expCap = await typeRows(
    `SELECT SUM(COALESCE(es.capacity, e.capacity)) AS offered,
            SUM((SELECT COALESCE(SUM(b.party_size), 0) FROM experience_bookings b WHERE b.session_id = es.id AND b.status <> 'cancelled' AND b.payment_status = 'paid')) AS taken
     FROM experience_sessions es JOIN experiences e ON e.id = es.experience_id
     WHERE e.vendor_id IN (${ids}) AND COALESCE(es.status, 'scheduled') <> 'cancelled' AND es.date BETWEEN ? AND ?`,
    [...vendorIds, from, to]
  );
  const progCap = await typeRows(
    `SELECT SUM(p.capacity) AS offered, SUM((SELECT COUNT(*) FROM program_enrollments pe WHERE pe.program_id = p.id AND pe.status <> 'cancelled' AND pe.payment_status = 'paid')) AS taken
     FROM programs p WHERE p.vendor_id IN (${ids}) AND p.capacity IS NOT NULL AND p.status = 'published'`,
    [...vendorIds]
  );
  const capacity = [
    { type: "Event and experience places (dates in range)", offered: n(expCap.offered), taken: n(expCap.taken) },
    { type: "Programme places (published, with a limit)", offered: n(progCap.offered), taken: n(progCap.taken) },
  ];

  const monthly = (await db
    .prepare(
      `SELECT m, t, COUNT(*) AS total, SUM(st = 'cancelled') AS cancelled FROM (
         SELECT DATE_FORMAT(es.date, '%Y-%m') AS m, 'Events and experiences' AS t, eb.status AS st FROM experience_bookings eb JOIN experience_sessions es ON es.id = eb.session_id JOIN experiences e ON e.id = eb.experience_id WHERE e.vendor_id IN (${ids}) AND eb.payment_status IN ('paid', 'refunded') AND es.date BETWEEN ? AND ?
         UNION ALL SELECT DATE_FORMAT(b.date, '%Y-%m'), 'Hall bookings', b.status FROM bookings b JOIN centres c ON c.id = b.centre_id WHERE c.vendor_id IN (${ids}) AND b.payment_status IN ('paid', 'refunded') AND b.date BETWEEN ? AND ?
         UNION ALL SELECT DATE_FORMAT(r.created_at, '%Y-%m'), 'Club registrations', r.status FROM registrations r JOIN clubs c ON c.id = r.club_id WHERE c.vendor_id IN (${ids}) AND r.payment_status IN ('paid', 'refunded') AND DATE(r.created_at) BETWEEN ? AND ?
         UNION ALL SELECT DATE_FORMAT(pe.created_at, '%Y-%m'), 'Programme enrolments', pe.status FROM program_enrollments pe JOIN programs p ON p.id = pe.program_id WHERE p.vendor_id IN (${ids}) AND pe.payment_status IN ('paid', 'refunded') AND DATE(pe.created_at) BETWEEN ? AND ?
       ) x GROUP BY m, t ORDER BY m, t`
    )
    .all(...vendorIds, from, to, ...vendorIds, from, to, ...vendorIds, from, to, ...vendorIds, from, to)) as { m: string; t: string; total: number; cancelled: number }[];
  const cancellationsByMonth = monthly.map((r) => ({ month: r.m, type: r.t, total: n(r.total), cancelled: n(r.cancelled) }));

  // Form completion: active orders in the range on listings whose live form has required questions.
  const refs = (await db
    .prepare(
      `SELECT 'experience' AS s, eb.ref FROM experience_bookings eb JOIN experience_sessions es ON es.id = eb.session_id JOIN experiences e ON e.id = eb.experience_id WHERE e.vendor_id IN (${ids}) AND eb.status <> 'cancelled' AND eb.payment_status = 'paid' AND es.date BETWEEN ? AND ?
       UNION ALL SELECT 'booking', b.ref FROM bookings b JOIN centres c ON c.id = b.centre_id WHERE c.vendor_id IN (${ids}) AND b.status <> 'cancelled' AND b.payment_status = 'paid' AND b.date BETWEEN ? AND ?
       UNION ALL SELECT 'registration', r.ref FROM registrations r JOIN clubs c ON c.id = r.club_id WHERE c.vendor_id IN (${ids}) AND r.status <> 'cancelled' AND r.payment_status = 'paid' AND DATE(r.created_at) BETWEEN ? AND ?
       UNION ALL SELECT 'program', pe.ref FROM program_enrollments pe JOIN programs p ON p.id = pe.program_id WHERE p.vendor_id IN (${ids}) AND pe.status <> 'cancelled' AND pe.payment_status = 'paid' AND DATE(pe.created_at) BETWEEN ? AND ?
       LIMIT ${FORM_CHECK_LIMIT + 1}`
    )
    .all(...vendorIds, from, to, ...vendorIds, from, to, ...vendorIds, from, to, ...vendorIds, from, to)) as { s: OrderSource; ref: string }[];
  const formCache = new Map<string, Question[] | null>();
  let complete = 0;
  let incomplete = 0;
  for (const { s, ref } of refs.slice(0, FORM_CHECK_LIMIT)) {
    const order = await orderByRef(s, ref);
    if (!order) continue;
    const key = `${order.listingType}:${order.listingId}`;
    if (!formCache.has(key)) {
      const qs = (await formQuestionsOn(order.vendorId)) ? (await activeQuestions(order.listingType, order.listingId)).filter((q) => q.required && q.inputType !== "info") : [];
      formCache.set(key, qs.length ? qs : null);
    }
    const qs = formCache.get(key);
    if (!qs) continue;
    const answers = (await readAnswersFor(ANSWER_SOURCE[order.listingType], [ref])).get(ref) ?? [];
    if (missingRequired(qs, answers, await orderPeople(order)).length) incomplete++;
    else complete++;
  }
  return {
    from,
    to,
    byType,
    attendance,
    capacity,
    cancellationsByMonth,
    forms: { listingsWithForm: [...formCache.values()].filter(Boolean).length, ordersChecked: complete + incomplete, complete, incomplete, truncated: refs.length > FORM_CHECK_LIMIT },
  };
}

vendorReportsRouter.get("/reports/participation", requirePlatformRole(...REPORT_ROLES), async (req, res) => {
  const r = range(req);
  if (!r) return res.status(400).json({ error: "Choose a date range of up to a year" });
  res.json(await participationReport(req.vendorIds!, r.from, r.to));
});

const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

vendorReportsRouter.get("/reports/participation.csv", requirePlatformRole(...REPORT_ROLES), async (req, res) => {
  const r = range(req);
  if (!r) return res.status(400).json({ error: "Choose a date range of up to a year" });
  const rep = await participationReport(req.vendorIds!, r.from, r.to);
  const lines = [["Section", "Type", "Month", "Measure", "Value"].map(cell).join(",")];
  for (const t of rep.byType) for (const [k, v] of Object.entries({ orders: t.orders, active: t.active, cancelled: t.cancelled, people: t.people })) lines.push(["Registrations", t.type, "", k, v].map(cell).join(","));
  for (const t of rep.attendance) for (const [k, v] of Object.entries({ expected: t.expected, attended: t.attended, noShow: t.noShow, unmarked: t.unmarked })) lines.push(["Attendance", t.type, "", k, v].map(cell).join(","));
  for (const t of rep.capacity) for (const [k, v] of Object.entries({ offered: t.offered, taken: t.taken })) lines.push(["Capacity", t.type, "", k, v].map(cell).join(","));
  for (const m of rep.cancellationsByMonth) for (const [k, v] of Object.entries({ total: m.total, cancelled: m.cancelled })) lines.push(["Cancellations", m.type, m.month, k, v].map(cell).join(","));
  for (const [k, v] of Object.entries({ complete: rep.forms.complete, incomplete: rep.forms.incomplete })) lines.push(["Form completion", "All listings with a form", "", k, v].map(cell).join(","));
  await writeAudit({ actorUserId: req.user!.id, action: "report.participation_exported", objectType: "organisation", objectId: req.user!.orgId ?? req.user!.id, newValue: { from: r.from, to: r.to } });
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="participation-${r.from}-to-${r.to}.csv"`);
  res.send(lines.join("\r\n"));
});
