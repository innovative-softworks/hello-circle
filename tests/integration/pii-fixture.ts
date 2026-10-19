import { randomUUID } from "node:crypto";
import type { APIRequestContext, PlaywrightWorkerArgs } from "@playwright/test";
import { expect } from "./fixtures";
import { bookableCentre, bookableClub, bookableExperience, bookableProgram, bookingBody, experienceBody, guest, irelandDate, registrationBody } from "./booking-fixture";
import { rows } from "./lifecycle-fixture";
import type { Scope } from "./stage-b-fixture";

// Security decision Option A (2026-10-17) — one synthetic customer with an
// order of every kind at QA_VENDOR's organisation, so each staff role can be
// checked against each endpoint that carries customer personal data. The hall
// booking is moved to today (exact-ID update on this test's own row) so the
// Overview "today" list includes it. Cash/free orders only.

export interface PiiOrders {
  tag: string;
  email: string;
  name: string;
  child: string;
  participant: string;
  centre: { id: string; room: string };
  hallRef: string;
  regRef: string;
  club: string;
  exp: { id: string; session: string };
  expRef: string;
  program: string;
  programRef: string;
  waitlistEmail: string;
}

export async function piiOrders(playwright: PlaywrightWorkerArgs["playwright"], f: Scope, opened: APIRequestContext[]): Promise<PiiOrders> {
  const tag = randomUUID().slice(0, 6);
  const g = await guest(playwright, opened);
  const name = `PII Booker ${tag}`;
  const centre = await bookableCentre(f, { rate: 20, cap: 10 });
  const hall = await g.ctx.post("/api/bookings/checkout", { data: bookingBody(centre, g.email, { name, phone: "0851112222" }) });
  expect(hall.status()).toBe(201);
  const hallRef = (await hall.json()).ref as string;
  await f.connection.execute("UPDATE bookings SET date = ? WHERE ref = ?", [irelandDate(0), hallRef]);

  const club = await bookableClub(f, { price: 0, capacity: 1 });
  const child = `Kid${tag}`;
  const reg = await g.ctx.post("/api/registrations/checkout", { data: registrationBody(club, g.email, { childFirst: "PII", childLast: child }) });
  expect(reg.status()).toBe(201);
  const regRef = (await reg.json()).ref as string;
  const w = await guest(playwright, opened);
  expect((await w.ctx.post(`/api/clubs/${club}/waitlist`, { data: { name: `PII Waiter ${tag}`, email: w.email } })).status()).toBe(201);

  const exp = await bookableExperience(f, { price: 0, capacity: 4, payment: "cash", date: irelandDate(20) });
  const participant = `PII Traveller ${tag}`;
  const xb = await g.ctx.post(`/api/experiences/${exp.id}/sessions/${exp.session}/checkout`, { data: experienceBody(g.email, { participantName: participant }) });
  expect(xb.status()).toBe(201);
  const expRef = (await xb.json()).ref as string;

  const program = await bookableProgram(f, { price: 0 });
  const enrol = await g.ctx.post(`/api/programs/${program.id}/enroll`, { data: { participantName: `PII Learner ${tag}`, email: g.email, phone: "000" } });
  expect(enrol.status()).toBe(201);
  const programRef = (await enrol.json()).ref as string;
  f.track("program_enrollments", "program_id", program.id);
  f.track("waitlist_entries", "listing_id", club);
  expect((await rows(f, "SELECT payment_status FROM bookings WHERE ref = ?", [hallRef]))[0].payment_status).toBe("paid");
  return { tag, email: g.email, name, child, participant, centre, hallRef, regRef, club, exp, expRef, program: program.id, programRef, waitlistEmail: w.email };
}

export const STAFF_ROLES = ["centre_manager", "facility_manager", "finance", "communications", "read_only_analyst"] as const;
