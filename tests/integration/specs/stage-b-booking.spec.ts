import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { test, expect, personas, env } from "../fixtures";
import { withActors, evidence } from "../authorization-fixture";
import { FUTURE, centreFor, clubFor, paidBooking, programFor } from "../stage-b-fixture";

// Authorization only — not booking lifecycle. Rows are synthetic and
// cash-marked (payment_status='paid', no stripe_session_id) solely so the
// status-gated cancel/reschedule/check-in paths are reachable; no checkout,
// provider or real payment is involved. Positive owner cancel/reschedule is
// deliberately NOT executed (booking-integrity E2E is out of scope).

test("STAGE-B-BOOKING: user, vendor and host isolation for bookings, registrations and attendee data", async ({ playwright }) => {
  await withActors(playwright, ["QA_USER", "QA_USER_B", "QA_VENDOR", "QA_VENDOR_B", "QA_HOST", "QA_HOST_B"], async (f) => {
    const clientA = randomUUID(), clientB = randomUUID();
    const centre = await centreFor(f, "QA_VENDOR");
    const ref = await paidBooking(f, centre, { clientId: clientA, email: env.QA_USER_EMAIL, residentId: personas.QA_USER.id });
    const club = await clubFor(f, "QA_VENDOR");
    const regRef = `QAR${randomUUID().slice(0, 8).toUpperCase()}`;
    await f.connection.execute(`INSERT INTO registrations (ref, client_id, club_id, team, child_first, child_last, dob, g_first, g_last, email, phone, address, ec_name, ec_phone, ec_rel, medical, consent, trial, total_cents, payment_status, status, resident_id)
      VALUES (?, ?, ?, 'QA', 'QAChild', 'Synthetic', '2015-01-01', 'QA', 'Guardian', ?, '000', 'QA address', 'QA', '000', 'QA', 'QA private medical note', 1, 0, 0, 'paid', 'confirmed', ?)`, [regRef, clientA, club, env.QA_USER_EMAIL, personas.QA_USER.id]);
    for (const [table, column] of [["attendance", "ref"], ["audit_log", "object_id"], ["notifications", "ref"]]) f.track(table, column, regRef);
    const program = await programFor(f, "QA_VENDOR", centre.id);
    const enrolRef = randomUUID();
    await f.connection.execute("INSERT INTO program_enrollments (ref, program_id, client_id, participant_name, email, total_cents, payment_status, resident_id) VALUES (?, ?, ?, 'QA participant', ?, 0, 'paid', ?)", [enrolRef, program, clientA, env.QA_USER_EMAIL, personas.QA_USER.id]);
    const invariants = await Promise.all([
      f.snapshot("SELECT * FROM bookings WHERE ref = ?", [ref]),
      f.snapshot("SELECT * FROM registrations WHERE ref = ?", [regRef]),
      f.snapshot("SELECT * FROM program_enrollments WHERE ref = ?", [enrolRef]),
      f.snapshot("SELECT * FROM attendance WHERE ref IN (?,?) ORDER BY ref", [ref, regRef]),
      f.snapshot("SELECT COUNT(*) AS n FROM audit_log WHERE object_id IN (?,?)", [ref, regRef]),
    ]);
    const B = f.actors.QA_USER_B, VB = f.actors.QA_VENDOR_B;
    const withB = { headers: { "X-Client-Id": clientB } };
    const cases: [() => ReturnType<APIRequestContext["get"]>, number, string][] = [
      [() => B.get(`/api/bookings/status/${ref}`, withB), 404, "user B booking status"],
      [() => B.get(`/api/bookings/${ref}/ics`, withB), 404, "user B booking calendar"],
      [() => B.post(`/api/bookings/${ref}/reschedule`, { ...withB, data: { email: env.QA_USER_B_EMAIL, date: FUTURE, time: "14:00" } }), 404, "user B reschedule"],
      [() => B.post(`/api/bookings/${ref}/cancel`, { ...withB, data: { email: env.QA_USER_B_EMAIL } }), 404, "user B cancel"],
      [() => B.get(`/api/registrations/status/${regRef}`, withB), 404, "user B registration status"],
      [() => B.post(`/api/registrations/${regRef}/cancel`, { ...withB, data: { email: env.QA_USER_B_EMAIL } }), 404, "user B registration cancel"],
      [() => B.get(`/api/programs/enrollments/status/${enrolRef}`, withB), 404, "user B enrollment status"],
      [() => B.post(`/api/programs/enrollments/${enrolRef}/cancel`, { ...withB, data: { email: env.QA_USER_B_EMAIL } }), 404, "user B enrollment cancel"],
      [() => VB.post(`/api/vendor/registrations/${regRef}/cancel`), 404, "vendor B registration cancel"],
      [() => VB.post(`/api/vendor/bookings/${ref}/resend-confirmation`), 404, "vendor B resend booking"],
      [() => VB.post(`/api/vendor/checkin/booking/${ref}`, { data: { status: "present" } }), 403, "vendor B booking check-in"],
      [() => VB.get(`/api/vendor/checkin/booking/${ref}`), 403, "vendor B check-in read"],
      [() => VB.post(`/api/vendor/checkin/registration/${regRef}`, { data: { status: "present" } }), 403, "vendor B registration check-in"],
      [() => VB.post(`/api/vendor/programs/${program}/enrollments/1/cancel`), 403, "vendor B enrollment cancel"],
      [() => f.actors.QA_HOST.get("/api/vendor/bookings"), 401, "host cannot use vendor bookings"],
    ];
    const statuses: number[] = [];
    for (const [call, status, label] of cases) {
      const got = (await call()).status();
      statuses.push(got);
      expect(got, label).toBe(status);
      for (const unchanged of invariants) await unchanged();
    }
    // Aggregated reads: contact/medical data never crosses users or organisations.
    const privateMarkers = [ref, regRef, enrolRef, env.QA_USER_EMAIL, "QA private medical note"];
    const leaks: Record<string, boolean> = {};
    for (const [label, call] of [
      ["userBBookings", () => B.get("/api/bookings", withB)],
      ["userBRegistrations", () => B.get("/api/registrations", withB)],
      ["userBReceipts", () => B.get("/api/residents/me/receipts")],
      ["userBParticipation", () => B.get("/api/residents/me/participation")],
      ["vendorBBookings", () => VB.get(`/api/vendor/bookings?centreId=${centre.id}`)],
      ["vendorBRegistrations", () => VB.get("/api/vendor/registrations")],
      ["vendorBParticipants", () => VB.get("/api/vendor/participants")],
      ["vendorBCsv", () => VB.get("/api/vendor/reports/bookings.csv")],
      ["vendorBSchedule", () => VB.get("/api/vendor/schedule-items")],
    ] as [string, () => ReturnType<APIRequestContext["get"]>][]) {
      const text = await (await call()).text();
      leaks[label] = privateMarkers.some((marker) => text.includes(marker));
    }
    // Owner/vendor positive controls: owner sees own booking; owning vendor sees attendee contact.
    const own = await (await f.actors.QA_USER.get("/api/bookings", { headers: { "X-Client-Id": clientA } })).text();
    const vendorOwn = await (await f.actors.QA_VENDOR.get(`/api/vendor/bookings?centreId=${centre.id}`)).text();
    // Host attendee management never includes contact fields.
    const game = await f.actors.QA_HOST.post("/api/games", { data: { activityLabel: `QA attendee ${randomUUID()}`, date: FUTURE, time: "12:00", capacity: 6, locationText: "Synthetic QA venue", priceCents: 0 } });
    const gameId = (await game.json()).id;
    for (const [table, column] of [["games", "id"], ["game_participants", "game_id"], ["listing_attributes", "listing_id"]]) f.track(table, column, gameId);
    await f.connection.execute("INSERT INTO game_participants (game_id, resident_id, status) VALUES (?, ?, 'joined')", [gameId, personas.QA_USER_B.id]);
    const roster = await (await f.actors.QA_HOST.get(`/api/games/${gameId}/participants/manage`)).text();
    const hostBRoster = (await f.actors.QA_HOST_B.get(`/api/games/${gameId}/participants/manage`)).status();
    const facts = { deniedStatuses: statuses, ...leaks, ownerSeesOwn: own.includes(ref), owningVendorSeesContact: vendorOwn.includes(env.QA_USER_EMAIL), hostRosterHasEmail: roster.includes(env.QA_USER_B_EMAIL), hostBRoster };
    await evidence("stage-b-booking", facts);
    for (const [label, leaked] of Object.entries(leaks)) expect(leaked, `${label} must not include another user's booking data`).toBe(false);
    expect(facts.ownerSeesOwn && facts.owningVendorSeesContact).toBe(true);
    expect(facts.hostRosterHasEmail).toBe(false);
    expect(hostBRoster).toBe(403);
  });
});
