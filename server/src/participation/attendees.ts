import { db } from "../db/index.js";
import type { ResolvedLines, OrderLineView } from "./lines.js";
import { readOrderLinesFor } from "./lines.js";

// Participation Phase 2 (docs/participation-expansion/12 §2) — the people in a
// booking. A booking made with participation.attendees on stores one row per
// person: adult or child, the order line (option) they came with, and — for a
// child — who looks after them (the booking contact or an adult in the same
// booking). Every other booking (made before Phase 2, or with the switch off)
// has no rows; its people are read from party_size + the seat names, so check-in
// and My Life work the same for both. Seat names
// (experience_booking_participants) are still written for every booking.

type Tx = Pick<typeof db, "prepare">;

export type PersonType = "adult" | "child";
export const MAX_NAME = 120;

export interface AttendeeSlot {
  lineNo: number | null;
  lineLabel: string | null;
  /** Fixed by the option's age band; null = the booker says. */
  fixedType: PersonType | null;
}

export interface CleanAttendee {
  attendeeNo: number;
  lineNo: number | null;
  personType: PersonType;
  name: string;
  guardianKind: "contact" | "attendee" | null;
  guardianAttendeeNo: number | null;
}

export interface Attendee extends CleanAttendee {
  lineLabel: string | null;
  guardianName: string | null;
  status: "active" | "removed";
  /** false = read from party size and seat names (no attendee rows). */
  recorded: boolean;
}

export const typeForBand = (band: string | null | undefined): PersonType | null =>
  band === "child" || band === "infant" ? "child" : band === "adult" || band === "senior" ? "adult" : null;

/** One slot per person, in order: each non-add-on line's heads, or party size. */
export function slotsForResolved(lines: ResolvedLines | null, partySize: number): AttendeeSlot[] {
  if (!lines) return Array.from({ length: partySize }, () => ({ lineNo: null, lineLabel: null, fixedType: null }));
  const out: AttendeeSlot[] = [];
  for (const l of lines.lines) {
    if (l.option.kind === "addon") continue;
    for (let i = 0; i < l.heads; i++) out.push({ lineNo: l.lineNo, lineLabel: l.option.label, fixedType: typeForBand(l.option.ageBand) });
  }
  return out;
}

function slotsForView(lines: OrderLineView[], partySize: number): AttendeeSlot[] {
  const people = lines.filter((l) => l.kind !== "addon");
  if (!people.length) return Array.from({ length: partySize }, () => ({ lineNo: null, lineLabel: null, fixedType: null }));
  const out: AttendeeSlot[] = [];
  for (const l of people) for (let i = 0; i < l.heads; i++) out.push({ lineNo: l.lineNo, lineLabel: l.label, fixedType: typeForBand(l.ageBand) });
  return out;
}

export class AttendeeError extends Error {}

const cleanName = (v: unknown) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "");

/**
 * Validates the booker's attendee list against the slots the order bought.
 * Rules: one entry per person; a name each; an option with a child/adult age
 * band fixes the type; every child has a guardian — the booking contact, or
 * an adult in this booking (never themselves, never another child).
 */
export function cleanAttendees(raw: unknown, slots: AttendeeSlot[]): CleanAttendee[] {
  if (!Array.isArray(raw) || raw.length !== slots.length) throw new AttendeeError(`Tell us about each of the ${slots.length} ${slots.length === 1 ? "person" : "people"} coming`);
  const out: CleanAttendee[] = raw.map((r, i) => {
    const o = (r ?? {}) as { name?: unknown; personType?: unknown; guardian?: unknown };
    const name = cleanName(o.name);
    if (!name || name.length > MAX_NAME) throw new AttendeeError(`Give a name for person ${i + 1}`);
    const slot = slots[i];
    const asked = o.personType === "child" ? "child" : o.personType === "adult" ? "adult" : null;
    if (slot.fixedType && asked && asked !== slot.fixedType) throw new AttendeeError(`${slot.lineLabel ?? `Person ${i + 1}`} is for ${slot.fixedType === "child" ? "a child" : "an adult"}`);
    const personType: PersonType = slot.fixedType ?? asked ?? "adult";
    return { attendeeNo: i + 1, lineNo: slot.lineNo, personType, name, guardianKind: null, guardianAttendeeNo: null, _guardian: o.guardian } as CleanAttendee & { _guardian?: unknown };
  });
  for (const a of out as (CleanAttendee & { _guardian?: unknown })[]) {
    const g = a._guardian;
    delete a._guardian;
    if (a.personType !== "child") continue;
    if (g === "contact") {
      a.guardianKind = "contact";
    } else if (typeof g === "number" && Number.isInteger(g)) {
      const adult = out.find((x) => x.attendeeNo === g);
      if (!adult || adult.attendeeNo === a.attendeeNo || adult.personType !== "adult") throw new AttendeeError(`Choose an adult in this booking to look after ${a.name}`);
      a.guardianKind = "attendee";
      a.guardianAttendeeNo = g;
    } else {
      throw new AttendeeError(`Say who looks after ${a.name}`);
    }
  }
  return out;
}

export async function writeAttendees(tx: Tx, sourceType: "experience", ref: string, list: CleanAttendee[]): Promise<void> {
  // An abandoned checkout's row is deleted, so a later order can reuse its ref.
  await tx.prepare(`DELETE FROM booking_attendees WHERE source_type = ? AND source_ref = ?`).run(sourceType, ref);
  for (const a of list) {
    await tx
      .prepare(
        `INSERT INTO booking_attendees (source_type, source_ref, attendee_no, line_no, person_type, name, guardian_kind, guardian_attendee_no)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(sourceType, ref, a.attendeeNo, a.lineNo, a.personType, a.name, a.guardianKind, a.guardianAttendeeNo);
  }
}

export interface BookingPeopleInput {
  ref: string;
  partySize: number;
  participantName: string;
}

/** People for many bookings at once: recorded rows, or synthesised from seats. */
export async function readAttendeesFor(sourceType: "experience", bookings: BookingPeopleInput[]): Promise<Map<string, Attendee[]>> {
  const out = new Map<string, Attendee[]>();
  if (!bookings.length) return out;
  const refs = bookings.map((b) => b.ref);
  const marks = refs.map(() => "?").join(", ");
  const rows = (await db
    .prepare(`SELECT * FROM booking_attendees WHERE source_type = ? AND source_ref IN (${marks}) ORDER BY source_ref, attendee_no`)
    .all(sourceType, ...refs)) as Record<string, any>[];
  const seats = (await db
    .prepare(`SELECT booking_ref AS ref, seat, name FROM experience_booking_participants WHERE booking_ref IN (${marks}) ORDER BY booking_ref, seat`)
    .all(...refs)) as { ref: string; seat: number; name: string }[];
  const lines = await readOrderLinesFor(sourceType, refs);
  for (const b of bookings) {
    const lineList = lines.get(b.ref) ?? [];
    const labelOf = (lineNo: number | null) => (lineNo === null ? null : lineList.find((l) => l.lineNo === lineNo)?.label ?? null);
    const own = rows.filter((r) => r.source_ref === b.ref);
    let people: Attendee[];
    if (own.length) {
      people = own.map((r) => ({
        attendeeNo: Number(r.attendee_no),
        lineNo: r.line_no === null ? null : Number(r.line_no),
        lineLabel: labelOf(r.line_no === null ? null : Number(r.line_no)),
        personType: r.person_type === "child" ? "child" : "adult",
        name: r.name,
        guardianKind: r.guardian_kind ?? null,
        guardianAttendeeNo: r.guardian_attendee_no === null ? null : Number(r.guardian_attendee_no),
        guardianName: null,
        status: r.status === "removed" ? "removed" : "active",
        recorded: true,
      }));
    } else {
      const seatNames = seats.filter((s) => s.ref === b.ref);
      const slots = slotsForView(lineList, b.partySize);
      people = Array.from({ length: Math.max(b.partySize, 0) }, (_, i) => ({
        attendeeNo: i + 1,
        lineNo: slots[i]?.lineNo ?? null,
        lineLabel: slots[i]?.lineLabel ?? null,
        personType: slots[i]?.fixedType ?? "adult",
        name: seatNames.find((s) => Number(s.seat) === i + 1)?.name ?? (i === 0 ? b.participantName : `Guest ${i + 1} of ${b.participantName}`),
        guardianKind: null,
        guardianAttendeeNo: null,
        guardianName: null,
        status: "active",
        recorded: false,
      }));
    }
    for (const p of people) {
      if (p.guardianKind === "contact") p.guardianName = `${b.participantName} (booking contact)`;
      else if (p.guardianKind === "attendee") p.guardianName = people.find((x) => x.attendeeNo === p.guardianAttendeeNo)?.name ?? null;
    }
    out.set(b.ref, people);
  }
  return out;
}

export async function readAttendees(sourceType: "experience", booking: BookingPeopleInput): Promise<Attendee[]> {
  return (await readAttendeesFor(sourceType, [booking])).get(booking.ref) ?? [];
}

/** Head counts must agree: active people = party size = Σ line heads. */
export function reconcile(people: Attendee[], partySize: number, lines: OrderLineView[]): string[] {
  const issues: string[] = [];
  const active = people.filter((p) => p.status === "active");
  if (active.length !== partySize) issues.push(`${active.length} people recorded for a party of ${partySize}`);
  const personLines = lines.filter((l) => l.kind !== "addon");
  if (personLines.length && people.some((p) => p.recorded)) {
    const sum = personLines.reduce((s, l) => s + l.heads, 0);
    if (sum !== partySize) issues.push(`options add up to ${sum} people, the booking says ${partySize}`);
    for (const l of personLines) {
      const n = active.filter((p) => p.lineNo === l.lineNo).length;
      if (n !== l.heads) issues.push(`${l.label}: ${n} people recorded, ${l.heads} booked`);
    }
  }
  return issues;
}
