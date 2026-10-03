import { randomUUID } from "node:crypto";
import { test, expect, personas } from "../fixtures";
import { withActors, evidence } from "../authorization-fixture";
import { FUTURE, centreFor, clubFor, experienceFor, programFor, residentCircle } from "../stage-b-fixture";

// Stage B vendor/organisation remainder. Each nested endpoint is exercised as
// correct parent+child, correct parent+foreign child, foreign parent+correct
// child, foreign parent+foreign child and nonexistent parent/child, asserting
// scoped DB invariants after every denial.

test("STAGE-B-ROOM-ASSIGNMENT: programme sessions and blocks only link rooms of the programme's own centre", async ({ playwright }) => {
  await withActors(playwright, ["QA_VENDOR", "QA_VENDOR_B"], async (f) => {
    const [orgs] = await f.connection.query<any[]>("SELECT org_id FROM users WHERE id IN (?,?)", [personas.QA_VENDOR.id, personas.QA_VENDOR_B.id]);
    expect(orgs.length === 2 && orgs[0].org_id !== orgs[1].org_id, "Distinct organisations").toBe(true);
    const A = await centreFor(f, "QA_VENDOR"), B = await centreFor(f, "QA_VENDOR_B");
    const pA = await programFor(f, "QA_VENDOR", A.id), pB = await programFor(f, "QA_VENDOR_B", B.id);
    const sessions = await f.snapshot("SELECT * FROM program_sessions WHERE program_id IN (?,?) ORDER BY id", [pA, pB]);
    const rooms = await f.snapshot("SELECT * FROM rooms WHERE centre_id IN (?,?) ORDER BY id", [A.id, B.id]);
    const cases: [string, string, string, number][] = [
      ["QA_VENDOR", pA, B.room, 400],          // own session parent + foreign room
      ["QA_VENDOR_B", pA, B.room, 403],        // foreign parent + attacker's room
      ["QA_VENDOR_B", pA, A.room, 403],        // foreign parent + victim room
      ["QA_VENDOR_B", pB, A.room, 400],        // own parent + foreign room (reverse)
      ["QA_VENDOR", pA, randomUUID(), 400],    // nonexistent room
      ["QA_VENDOR", randomUUID(), A.room, 403],// nonexistent parent
    ];
    const statuses: number[] = [];
    for (const [role, program, roomId, status] of cases) {
      const response = await f.actors[role].post(`/api/vendor/programs/${program}/sessions`, { data: { date: FUTURE, time: "10:00", roomId } });
      statuses.push(response.status());
      expect(response.status(), `${role} ${program === pA ? "A" : program === pB ? "B" : "missing"} programme`).toBe(status);
      await sessions(); await rooms();
    }
    const [linked] = await f.connection.query<any[]>("SELECT COUNT(*) AS n FROM program_sessions ps JOIN programs p ON p.id = ps.program_id JOIN rooms r ON r.id = ps.room_id WHERE p.id IN (?,?) AND r.centre_id <> p.listing_id", [pA, pB]);
    // Legitimate: Vendor A session + Room A.
    const own = await f.actors.QA_VENDOR.post(`/api/vendor/programs/${pA}/sessions`, { data: { date: FUTURE, time: "11:00", roomId: A.room } });
    expect(own.status()).toBe(201);
    const [stored] = await f.connection.query<any[]>("SELECT room_id, program_id FROM program_sessions WHERE id = ?", [(await own.json()).id]);
    expect(stored[0].room_id === A.room && stored[0].program_id === pA).toBe(true);
    await rooms();
    // Blocks: foreign room rejected, foreign block not deletable, foreign parent denied.
    const blocks = await f.snapshot("SELECT * FROM room_blocks WHERE centre_id IN (?,?) ORDER BY id", [A.id, B.id]);
    expect((await f.actors.QA_VENDOR.post(`/api/vendor/centres/${A.id}/blocks`, { data: { date: FUTURE, roomId: B.room } })).status()).toBe(400);
    await blocks();
    const block = await f.actors.QA_VENDOR.post(`/api/vendor/centres/${A.id}/blocks`, { data: { date: FUTURE, roomId: A.room } });
    expect(block.status()).toBe(201);
    const blockId = (await block.json()).id;
    const blocksAfter = await f.snapshot("SELECT * FROM room_blocks WHERE centre_id IN (?,?) ORDER BY id", [A.id, B.id]);
    expect((await f.actors.QA_VENDOR_B.delete(`/api/vendor/centres/${B.id}/blocks/${blockId}`)).status()).toBe(404);
    expect((await f.actors.QA_VENDOR_B.delete(`/api/vendor/centres/${A.id}/blocks/${blockId}`)).status()).toBe(403);
    expect((await f.actors.QA_VENDOR_B.get(`/api/vendor/centres/${A.id}/blocks`)).status()).toBe(403);
    expect((await f.actors.QA_VENDOR_B.get(`/api/vendor/centres/${A.id}/hours`)).status()).toBe(403);
    expect((await f.actors.QA_VENDOR_B.put(`/api/vendor/centres/${A.id}/hours`, { data: { days: [] } })).status()).toBe(403);
    expect((await f.actors.QA_VENDOR.put(`/api/vendor/centres/${A.id}/rooms/${B.room}`, { data: { active: false, name: "Forbidden" } })).status()).toBe(404);
    await blocksAfter(); await rooms();
    await evidence("stage-b-room-assignment", { deniedStatuses: statuses, crossCentreSessionRoomLinks: Number(linked[0].n), legitimateCreated: true });
    expect(Number(linked[0].n)).toBe(0);
  });
});

test("STAGE-B-EXPERIENCES: sessions, bookings, attendance and refund children are experience-scoped", async ({ playwright }) => {
  await withActors(playwright, ["QA_VENDOR", "QA_VENDOR_B", "GUEST"], async (f) => {
    const eA = await experienceFor(f, "QA_VENDOR"), eB = await experienceFor(f, "QA_VENDOR_B");
    const sessionIds: string[] = [];
    for (const [role, experience] of [["QA_VENDOR", eA], ["QA_VENDOR_B", eB]]) {
      const created = await f.actors[role].post(`/api/vendor/experiences/${experience}/sessions`, { data: { date: FUTURE, time: "09:00", capacity: 4 } });
      expect(created.status()).toBe(201);
      sessionIds.push((await created.json()).id);
    }
    const bookings: { id: number; ref: string }[] = [];
    for (const [index, experience] of [eA, eB].entries()) {
      const ref = `QAX${randomUUID().slice(0, 8).toUpperCase()}`;
      const [insert] = await f.connection.execute<any>("INSERT INTO experience_bookings (ref, experience_id, session_id, client_id, participant_name, email, payment_status, status) VALUES (?, ?, ?, ?, 'QA synthetic', 'qa_experience@example.test', 'pending', 'confirmed')", [ref, experience, sessionIds[index], randomUUID()]);
      bookings.push({ id: Number(insert.insertId), ref });
      f.track("attendance", "ref", ref); f.track("audit_log", "object_id", ref);
    }
    const invariants = await Promise.all([
      f.snapshot("SELECT * FROM experiences WHERE id IN (?,?) ORDER BY id", [eA, eB]),
      f.snapshot("SELECT * FROM experience_sessions WHERE experience_id IN (?,?) ORDER BY id", [eA, eB]),
      f.snapshot("SELECT * FROM experience_bookings WHERE experience_id IN (?,?) ORDER BY id", [eA, eB]),
      f.snapshot("SELECT * FROM attendance WHERE ref IN (?,?) ORDER BY ref", [bookings[0].ref, bookings[1].ref]),
    ]);
    const check = async (response: Promise<import("@playwright/test").APIResponse>, expected: number, label: string) => {
      expect((await response).status(), label).toBe(expected);
      for (const unchanged of invariants) await unchanged();
    };
    const V = f.actors.QA_VENDOR, VB = f.actors.QA_VENDOR_B;
    await check(VB.get(`/api/vendor/experiences/${eA}`), 403, "foreign parent read");
    await check(VB.get(`/api/vendor/experiences/${eA}/sessions`), 403, "foreign sessions");
    await check(VB.get(`/api/vendor/experiences/${eA}/bookings`), 403, "foreign attendee list");
    await check(VB.post(`/api/vendor/experiences/${eA}/sessions`, { data: { date: FUTURE, time: "10:00" } }), 403, "foreign session create");
    await check(VB.put(`/api/vendor/experiences/${eA}`, { data: { title: "Forbidden", vendorId: personas.QA_VENDOR_B.id, status: "approved" } }), 403, "foreign update");
    await check(VB.post(`/api/vendor/experiences/${eA}/publish`), 403, "foreign publish");
    await check(VB.delete(`/api/vendor/experiences/${eA}`), 403, "foreign delete");
    await check(V.delete(`/api/vendor/experiences/${eA}/sessions/${sessionIds[1]}`), 200, "own parent + foreign session is a scoped no-op");
    await check(VB.delete(`/api/vendor/experiences/${eA}/sessions/${sessionIds[0]}`), 403, "foreign parent + child");
    await check(V.post(`/api/vendor/experiences/${eA}/bookings/${bookings[1].id}/cancel`), 404, "own parent + foreign booking cancel");
    await check(VB.post(`/api/vendor/experiences/${eA}/bookings/${bookings[0].id}/cancel`), 403, "foreign parent booking cancel");
    await check(V.post(`/api/vendor/experiences/${eA}/bookings/${bookings[1].id}/refund`), 404, "own parent + foreign booking refund");
    await check(VB.post(`/api/vendor/experiences/${eA}/bookings/${bookings[0].id}/refund`), 403, "foreign refund");
    await check(V.post(`/api/vendor/experiences/${eA}/bookings/${bookings[1].ref}/attendance`, { data: { status: "present" } }), 404, "own parent + foreign attendance");
    await check(VB.post(`/api/vendor/experiences/${eA}/bookings/${bookings[0].ref}/attendance`, { data: { status: "present" } }), 403, "foreign attendance");
    await check(V.post(`/api/vendor/experiences/${randomUUID()}/bookings/${bookings[0].id}/cancel`), 403, "nonexistent parent");
    await check(V.post(`/api/vendor/experiences/${eA}/bookings/999999999/cancel`), 404, "nonexistent child");
    await check(f.actors.GUEST.get(`/api/vendor/experiences/${eA}/bookings`), 401, "guest");
    // Correct parent + correct child control: status-only cancel of own synthetic booking.
    expect((await V.post(`/api/vendor/experiences/${eA}/bookings/${bookings[0].id}/cancel`)).status()).toBe(200);
    const [rows] = await f.connection.query<any[]>("SELECT status FROM experience_bookings WHERE id IN (?,?) ORDER BY id", [bookings[0].id, bookings[1].id]);
    expect(rows[0].status === "cancelled" && rows[1].status === "confirmed").toBe(true);
  });
});

test("STAGE-B-CLUBS: club listing, club sessions, roster and waitlist children are organisation-scoped", async ({ playwright }) => {
  await withActors(playwright, ["QA_VENDOR", "QA_VENDOR_B"], async (f) => {
    const cA = await clubFor(f, "QA_VENDOR"), cB = await clubFor(f, "QA_VENDOR_B");
    const created = await f.actors.QA_VENDOR.post("/api/club-sessions", { data: { clubId: cA, dayOfWeek: 2, time: "18:00", label: "QA session" } });
    expect(created.status()).toBe(201);
    const sessionA = (await created.json()).id;
    const [entry] = await f.connection.execute<any>("INSERT INTO waitlist_entries (listing_type, listing_id, client_id, name, email) VALUES ('club', ?, ?, 'QA waiting', 'qa_waitlist@example.test')", [cA, randomUUID()]);
    const entryId = Number(entry.insertId);
    f.track("waitlist_entries", "id", entryId);
    const invariants = await Promise.all([
      f.snapshot("SELECT * FROM clubs WHERE id IN (?,?) ORDER BY id", [cA, cB]),
      f.snapshot("SELECT * FROM club_sessions WHERE club_id IN (?,?) ORDER BY id", [cA, cB]),
      f.snapshot("SELECT * FROM waitlist_entries WHERE id = ?", [entryId]),
    ]);
    const VB = f.actors.QA_VENDOR_B;
    const cases: [() => Promise<import("@playwright/test").APIResponse>, number, string][] = [
      [() => VB.get(`/api/vendor/clubs/${cA}`), 403, "foreign club read"],
      [() => VB.put(`/api/vendor/clubs/${cA}`, { data: { name: "Forbidden", vendorId: personas.QA_VENDOR_B.id, status: "approved" } }), 403, "foreign club update"],
      [() => VB.post(`/api/vendor/clubs/${cA}/pause`), 403, "foreign pause"],
      [() => VB.post(`/api/vendor/clubs/${cA}/duplicate`), 403, "foreign duplicate"],
      [() => VB.delete(`/api/vendor/clubs/${cA}`), 403, "foreign delete"],
      [() => VB.post("/api/club-sessions", { data: { clubId: cA, dayOfWeek: 3, time: "19:00" } }), 403, "session under foreign club"],
      [() => VB.put(`/api/club-sessions/${sessionA}`, { data: { label: "Forbidden", active: false } }), 403, "foreign session update"],
      [() => VB.delete(`/api/club-sessions/${sessionA}`), 403, "foreign session delete"],
      [() => VB.get(`/api/vendor/clubs/${cA}/participants`), 403, "foreign roster"],
      [() => VB.get(`/api/vendor/clubs/${cA}/waitlist`), 403, "foreign waitlist"],
      [() => VB.post(`/api/vendor/clubs/${cB}/waitlist/${entryId}/offer`), 409, "own club + foreign waitlist entry"],
      [() => VB.post(`/api/vendor/clubs/${cA}/waitlist/${entryId}/offer`), 403, "foreign club + entry"],
      [() => VB.get(`/api/vendor/participation/club/${cA}`), 403, "foreign participation read"],
      [() => VB.put(`/api/vendor/participation/club/${cA}`, { data: { arrivalInstructions: "Forbidden" } }), 403, "foreign participation write"],
      [() => f.actors.QA_VENDOR.put(`/api/club-sessions/${randomUUID()}`, { data: { label: "Missing" } }), 403, "nonexistent session"],
    ];
    for (const [response, status, label] of cases) {
      expect((await response()).status(), label).toBe(status);
      for (const unchanged of invariants) await unchanged();
    }
    // Legitimate owner child update remains functional.
    expect((await f.actors.QA_VENDOR.put(`/api/club-sessions/${sessionA}`, { data: { label: "QA updated" } })).status()).toBe(200);
  });
});

test("STAGE-B-VENDOR-OPS: coupons, review replies, notifications, check-in and Circle links are scoped", async ({ playwright }) => {
  await withActors(playwright, ["QA_VENDOR", "QA_VENDOR_B"], async (f) => {
    const A = await centreFor(f, "QA_VENDOR");
    const pA = await programFor(f, "QA_VENDOR", A.id);
    const code = `QASB${randomUUID().slice(0, 8).toUpperCase()}`;
    expect((await f.actors.QA_VENDOR.post("/api/vendor/coupons", { data: { code, kind: "percent", amount: 10, eligibleListingType: "centre", eligibleListingId: A.id } })).status()).toBe(201);
    const [coupon] = await f.connection.query<any[]>("SELECT id FROM coupons WHERE code = ?", [code]);
    f.track("coupons", "code", code);
    const [review] = await f.connection.execute<any>("INSERT INTO reviews (listing_type, listing_id, client_id, name, rating, comment) VALUES ('centre', ?, ?, 'QA reviewer', 4, 'Synthetic')", [A.id, randomUUID()]);
    const reviewId = Number(review.insertId);
    f.track("reviews", "id", reviewId);
    const [note] = await f.connection.execute<any>("INSERT INTO notifications (recipient_id, kind, title, body, listing_type, listing_id, ref) VALUES (?, 'booking', 'QA', 'Synthetic', 'centre', ?, 'qa')", [personas.QA_VENDOR.id, A.id]);
    const noteId = Number(note.insertId);
    f.track("notifications", "id", noteId);
    const circle = await residentCircle(f, "QA_USER");
    const invariants = await Promise.all([
      f.snapshot("SELECT * FROM coupons WHERE code = ?", [code]),
      f.snapshot("SELECT * FROM reviews WHERE id = ?", [reviewId]),
      f.snapshot("SELECT * FROM notifications WHERE id = ?", [noteId]),
      f.snapshot("SELECT * FROM programs WHERE id = ?", [pA]),
      f.snapshot("SELECT * FROM coupons WHERE eligible_listing_id = ? ORDER BY id", [A.id]),
    ]);
    const VB = f.actors.QA_VENDOR_B;
    const cases: [() => Promise<import("@playwright/test").APIResponse>, number, string][] = [
      [() => VB.put(`/api/vendor/coupons/${coupon[0].id}/active`, { data: { active: false } }), 404, "foreign coupon toggle"],
      [() => VB.post("/api/vendor/coupons", { data: { code: `QASBX${randomUUID().slice(0, 6)}`, kind: "fixed", amount: 500, eligibleListingType: "centre", eligibleListingId: A.id } }), 403, "coupon bound to foreign listing"],
      [() => VB.post(`/api/vendor/reviews/${reviewId}/reply`, { data: { reply: "Forbidden" } }), 404, "foreign review reply"],
      [() => VB.post(`/api/vendor/notifications/${noteId}/read`), 404, "foreign notification"],
      [() => VB.post("/api/vendor/messages", { data: { listingType: "centre", listingId: A.id, subject: "Forbidden", body: "Forbidden" } }), 403, "message foreign listing attendees"],
      [() => VB.get(`/api/vendor/participation/program/${pA}`), 403, "foreign programme participation"],
      [() => VB.put(`/api/vendor/programs/${pA}`, { data: { title: "Forbidden", status: "published", vendorId: personas.QA_VENDOR_B.id } }), 403, "foreign programme update"],
      [() => f.actors.QA_VENDOR.put(`/api/vendor/participation/program/${pA}`, { data: { circleId: circle } }), 403, "own programme + unrelated resident Circle"],
    ];
    for (const [response, status, label] of cases) {
      expect((await response()).status(), label).toBe(status);
      for (const unchanged of invariants) await unchanged();
    }
    // Mass assignment on own programme: ownership/listing fields are server-derived.
    expect((await f.actors.QA_VENDOR.put(`/api/vendor/programs/${pA}`, { data: { title: "QA renamed", vendorId: personas.QA_VENDOR_B.id, vendor_id: personas.QA_VENDOR_B.id, listingId: randomUUID(), listing_id: randomUUID() } })).status()).toBe(200);
    const [program] = await f.connection.query<any[]>("SELECT vendor_id, listing_id, title FROM programs WHERE id = ?", [pA]);
    expect(program[0].vendor_id === personas.QA_VENDOR.id && program[0].listing_id === A.id && program[0].title === "QA renamed").toBe(true);
  });
});
