import { db } from "../db/index.js";
import { checkinOnly, hasPlatformRole, type AuthedUser } from "../auth.js";
import { irelandTodayIso } from "../irelandTime.js";
import { readAttendeesFor, type Attendee } from "./attendees.js";
import { readAnswersFor } from "./questions.js";

// Participation Phase 2 (docs/participation-expansion/12 §4) — per-person
// check-in at the door.
//
// Who may check in (decided on every request, nothing cached):
// - the organisation owner and its centre_manager / facility_manager staff:
//   every experience or event of the organisation (same groups as the roster);
// - checkin_staff: only a listing, or one date of it, they are assigned to in
//   listing_staff_assignments (not revoked, same organisation);
// - nobody else (finance, communications, read_only_analyst).
// requireVendor has already refused suspended organisations and removed staff.
//
// Who may be admitted: a paid, not-cancelled booking for this date, on a
// session that isn't cancelled, on the day itself (Ireland). A person can be
// checked in once (UNIQUE row); a second scan reports when and is not an error
// for the group. The booking's own `attendance` row is set to present on the
// first arrival so reviews, attendance history and corrections keep working.

type Tx = Pick<typeof db, "prepare">;

export const DOOR_ROSTER_ROLES = ["centre_manager", "facility_manager"] as const;

export interface DoorSession {
  sessionId: string;
  experienceId: string;
  title: string;
  kind: string;
  date: string;
  time: string;
  status: string;
  vendorId: string;
}

export async function loadDoorSession(sessionId: string): Promise<DoorSession | null> {
  const row = (await db
    .prepare(
      `SELECT es.id AS sessionId, es.experience_id AS experienceId, e.title, e.kind, es.date, es.time, es.status, e.vendor_id AS vendorId
       FROM experience_sessions es JOIN experiences e ON e.id = es.experience_id WHERE es.id = ?`
    )
    .get(sessionId)) as DoorSession | undefined;
  return row ?? null;
}

export type ScopeResult = { ok: true; via: "organisation" | "assignment" } | { ok: false; status: 403 | 404; error: string };

/** May `user` check people in on this session? */
export async function doorScope(user: AuthedUser, vendorIds: string[], session: DoorSession | null): Promise<ScopeResult> {
  if (!session || !vendorIds.includes(session.vendorId)) return { ok: false, status: 404, error: "This event isn't one you can check people in for" };
  if (!checkinOnly(user)) {
    return hasPlatformRole(user, ...DOOR_ROSTER_ROLES) ? { ok: true, via: "organisation" } : { ok: false, status: 403, error: "Your role can't check people in" };
  }
  const assigned = await db
    .prepare(
      `SELECT id FROM listing_staff_assignments
       WHERE user_id = ? AND org_id = ? AND listing_type = 'experience' AND listing_id = ? AND duty = 'checkin' AND revoked_at IS NULL
         AND (session_id IS NULL OR session_id = ?) LIMIT 1`
    )
    .get(user.id, user.orgId ?? "", session.experienceId, session.sessionId);
  return assigned ? { ok: true, via: "assignment" } : { ok: false, status: 403, error: "You aren't assigned to check people in for this event or date" };
}

export type AdmitReason = "ok" | "cancelled" | "not_paid" | "refunded" | "session_cancelled" | "wrong_date" | "other_session";

export interface DoorBookingRow {
  ref: string;
  sessionId: string;
  participantName: string;
  partySize: number;
  status: string;
  paymentStatus: string;
  date: string;
  sessionStatus: string;
}

export function admitVerdict(b: DoorBookingRow, session: DoorSession, today: string = irelandTodayIso()): { ok: boolean; reason: AdmitReason; message: string } {
  if (b.sessionId !== session.sessionId) return { ok: false, reason: "other_session", message: `Booked for ${b.date}, not this date` };
  if (b.status === "cancelled") return { ok: false, reason: "cancelled", message: "This booking was cancelled — don't admit" };
  if (b.paymentStatus === "refunded") return { ok: false, reason: "refunded", message: "This booking was refunded — don't admit" };
  if (b.paymentStatus !== "paid") return { ok: false, reason: "not_paid", message: "Payment isn't complete — send them to the organiser" };
  if (session.status === "cancelled" || b.sessionStatus === "cancelled") return { ok: false, reason: "session_cancelled", message: "This date was cancelled" };
  if (session.date !== today) return { ok: false, reason: "wrong_date", message: session.date > today ? `Check-in opens on ${session.date}` : `This date (${session.date}) has passed` };
  return { ok: true, reason: "ok", message: "OK to admit" };
}

const bookingSelect = `SELECT eb.ref, eb.session_id AS sessionId, eb.participant_name AS participantName, eb.party_size AS partySize, eb.status,
       eb.payment_status AS paymentStatus, es.date, es.status AS sessionStatus
  FROM experience_bookings eb JOIN experience_sessions es ON es.id = eb.session_id`;

export async function doorBookingByRef(ref: string, experienceId: string): Promise<DoorBookingRow | null> {
  const row = (await db.prepare(`${bookingSelect} WHERE eb.ref = ? AND eb.experience_id = ?`).get(ref, experienceId)) as DoorBookingRow | undefined;
  return row ? { ...row, partySize: Number(row.partySize) } : null;
}

/** Paid, active bookings of the session — the door list. */
export async function doorBookings(sessionId: string): Promise<DoorBookingRow[]> {
  const rows = (await db
    .prepare(`${bookingSelect} WHERE eb.session_id = ? AND eb.payment_status = 'paid' AND eb.status != 'cancelled' ORDER BY eb.participant_name`)
    .all(sessionId)) as DoorBookingRow[];
  return rows.map((r) => ({ ...r, partySize: Number(r.partySize) }));
}

interface CheckinRow {
  source_ref: string;
  attendee_no: number;
  checked_in_at: Date | string;
  method: string;
}

async function checkinsFor(refs: string[]): Promise<Map<string, CheckinRow[]>> {
  const out = new Map<string, CheckinRow[]>();
  if (!refs.length) return out;
  const rows = (await db
    .prepare(`SELECT source_ref, attendee_no, checked_in_at, method FROM attendee_checkins WHERE source_type = 'experience' AND source_ref IN (${refs.map(() => "?").join(", ")})`)
    .all(...refs)) as CheckinRow[];
  for (const r of rows) out.set(r.source_ref, [...(out.get(r.source_ref) ?? []), r]);
  return out;
}

export interface DoorPerson {
  attendeeNo: number;
  name: string;
  personType: "adult" | "child";
  lineLabel: string | null;
  guardianName: string | null;
  checkedInAt: string | null;
  answers: { label: string; value: string }[];
}

/** What the door sees of a booking: no amounts, no email, no phone. */
export interface DoorBooking {
  ref: string;
  contactName: string;
  partySize: number;
  admit: { ok: boolean; reason: AdmitReason; message: string };
  people: DoorPerson[];
  bookingAnswers: { label: string; value: string }[];
  checkedIn: number;
}

export async function doorViews(rows: DoorBookingRow[], session: DoorSession): Promise<DoorBooking[]> {
  const refs = rows.map((r) => r.ref);
  const people = await readAttendeesFor("experience", rows.map((r) => ({ ref: r.ref, partySize: r.partySize, participantName: r.participantName })));
  const checks = await checkinsFor(refs);
  const answers = await readAnswersFor("experience", refs, { doorOnly: true });
  const today = irelandTodayIso();
  return rows.map((r) => {
    const own = (people.get(r.ref) ?? []).filter((p: Attendee) => p.status === "active");
    const c = checks.get(r.ref) ?? [];
    const a = answers.get(r.ref) ?? [];
    const out: DoorPerson[] = own.map((p) => {
      const hit = c.find((x) => Number(x.attendee_no) === p.attendeeNo);
      return {
        attendeeNo: p.attendeeNo,
        name: p.name,
        personType: p.personType,
        lineLabel: p.lineLabel,
        guardianName: p.guardianName,
        checkedInAt: hit ? new Date(hit.checked_in_at).toISOString() : null,
        answers: a.filter((x) => x.attendeeNo === p.attendeeNo).map((x) => ({ label: x.label, value: x.value })),
      };
    });
    return {
      ref: r.ref,
      contactName: r.participantName,
      partySize: r.partySize,
      admit: admitVerdict(r, session, today),
      people: out,
      bookingAnswers: a.filter((x) => x.attendeeNo === 0).map((x) => ({ label: x.label, value: x.value })),
      checkedIn: out.filter((p) => p.checkedInAt).length,
    };
  });
}

export class CheckinError extends Error {
  constructor(message: string, readonly status: number, readonly reason?: AdmitReason | "unknown_person") {
    super(message);
  }
}

export interface CheckinResult {
  attendeeNo: number;
  result: "checked_in" | "already";
  checkedInAt: string;
}

/**
 * Checks people in. Re-reads the booking under a row lock so a cancellation
 * or refund that lands mid-scan wins. `attendeeNos` = the people arriving now
 * (part of a group is fine). Already-checked-in people come back as "already".
 */
export async function checkIn(input: { ref: string; session: DoorSession; attendeeNos: number[]; method: "qr" | "manual"; userId: string }): Promise<CheckinResult[]> {
  const results = await db.transaction(async (tx: Tx) => {
    await tx.prepare(`SELECT ref FROM experience_bookings WHERE ref = ? FOR UPDATE`).get(input.ref);
    const row = (await tx.prepare(`${bookingSelect} WHERE eb.ref = ? AND eb.experience_id = ?`).get(input.ref, input.session.experienceId)) as DoorBookingRow | undefined;
    if (!row) throw new CheckinError("This booking isn't for this event", 404);
    const verdict = admitVerdict({ ...row, partySize: Number(row.partySize) }, input.session);
    if (!verdict.ok) throw new CheckinError(verdict.message, 409, verdict.reason);
    const people = (await readAttendeesFor("experience", [{ ref: row.ref, partySize: Number(row.partySize), participantName: row.participantName }])).get(row.ref) ?? [];
    const active = new Set(people.filter((p) => p.status === "active").map((p) => p.attendeeNo));
    const wanted = [...new Set(input.attendeeNos)];
    if (!wanted.length) throw new CheckinError("Choose who is arriving", 400);
    for (const n of wanted) if (!active.has(n)) throw new CheckinError("That person isn't on this booking", 400, "unknown_person");
    const out: CheckinResult[] = [];
    for (const n of wanted) {
      const ins = await tx
        .prepare(
          `INSERT IGNORE INTO attendee_checkins (source_type, source_ref, attendee_no, session_id, method, checked_in_by) VALUES ('experience', ?, ?, ?, ?, ?)`
        )
        .run(input.ref, n, input.session.sessionId, input.method, input.userId);
      const at = (await tx.prepare(`SELECT checked_in_at FROM attendee_checkins WHERE source_type = 'experience' AND source_ref = ? AND attendee_no = ?`).get(input.ref, n)) as { checked_in_at: Date | string };
      out.push({ attendeeNo: n, result: ins.changes === 1 ? "checked_in" : "already", checkedInAt: new Date(at.checked_in_at).toISOString() });
    }
    if (out.some((r) => r.result === "checked_in")) {
      await tx
        .prepare(
          `INSERT INTO attendance (kind, ref, checked_in_by, status, source) VALUES ('experience', ?, ?, 'present', 'door')
           ON DUPLICATE KEY UPDATE checked_in_by = IF(status = 'present', checked_in_by, VALUES(checked_in_by)), source = IF(status = 'present', source, 'door'), status = 'present'`
        )
        .run(input.ref, input.userId);
    }
    return out;
  });
  return results;
}

/** Undo one person's check-in (a mistake at the door). Returns false if there was none. */
export async function undoCheckIn(input: { ref: string; attendeeNo: number }): Promise<boolean> {
  return db.transaction(async (tx: Tx) => {
    const del = await tx.prepare(`DELETE FROM attendee_checkins WHERE source_type = 'experience' AND source_ref = ? AND attendee_no = ?`).run(input.ref, input.attendeeNo);
    if (del.changes !== 1) return false;
    const left = (await tx.prepare(`SELECT COUNT(*) AS n FROM attendee_checkins WHERE source_type = 'experience' AND source_ref = ?`).get(input.ref)) as { n: number };
    // Only the door's own roll-up is withdrawn; a host's or a correction's record stays.
    if (Number(left.n) === 0) await tx.prepare(`DELETE FROM attendance WHERE kind = 'experience' AND ref = ? AND source = 'door'`).run(input.ref);
    return true;
  });
}

/** Counts per session for the attendance summary (no names). */
export async function attendanceSummary(experienceId: string): Promise<
  { sessionId: string; date: string; time: string; status: string; bookings: number; people: number; adults: number; children: number; checkedIn: number }[]
> {
  const sessions = (await db
    .prepare(`SELECT id, date, time, status FROM experience_sessions WHERE experience_id = ? ORDER BY date, time`)
    .all(experienceId)) as { id: string; date: string; time: string; status: string }[];
  const bookings = (await db
    .prepare(`SELECT ref, session_id AS sessionId, party_size AS partySize, participant_name AS participantName FROM experience_bookings WHERE experience_id = ? AND payment_status = 'paid' AND status != 'cancelled'`)
    .all(experienceId)) as { ref: string; sessionId: string; partySize: number; participantName: string }[];
  const people = await readAttendeesFor("experience", bookings.map((b) => ({ ref: b.ref, partySize: Number(b.partySize), participantName: b.participantName })));
  const checks = await checkinsFor(bookings.map((b) => b.ref));
  return sessions.map((s) => {
    const own = bookings.filter((b) => b.sessionId === s.id);
    const ps = own.flatMap((b) => (people.get(b.ref) ?? []).filter((p) => p.status === "active"));
    return {
      sessionId: s.id,
      date: s.date,
      time: s.time,
      status: s.status,
      bookings: own.length,
      people: ps.length,
      adults: ps.filter((p) => p.personType === "adult").length,
      children: ps.filter((p) => p.personType === "child").length,
      checkedIn: own.reduce((n, b) => n + (checks.get(b.ref)?.length ?? 0), 0),
    };
  });
}

export { checkinsFor };
