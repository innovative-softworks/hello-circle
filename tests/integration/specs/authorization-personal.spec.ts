import { randomUUID } from "node:crypto";
import { test, expect, personas, env } from "../fixtures";
import { withActors } from "../authorization-fixture";

test("IDOR-NOTIFICATIONS: another resident cannot read or mark a private notification", async ({ playwright }) => {
  await withActors(playwright, ["QA_USER", "QA_USER_B"], async ({ actors, connection, track, snapshot }) => {
    const marker = randomUUID();
    const [inserted] = await connection.execute<any>("INSERT INTO notifications (recipient_id, resident_id, kind, title, body, listing_type, listing_id, ref) VALUES (?, ?, 'circle', 'QA private', 'Synthetic private message', 'circle', ?, ?)", [personas.QA_USER.id, personas.QA_USER.id, marker, marker]);
    track("notifications", "id", inserted.insertId);
    const unchanged = await snapshot("SELECT * FROM notifications WHERE id = ?", [inserted.insertId]);
    expect((await (await actors.QA_USER.get("/api/residents/me/notifications")).json()).some((r: { id: number }) => r.id === inserted.insertId)).toBe(true);
    expect((await (await actors.QA_USER_B.get(`/api/residents/me/notifications?residentId=${personas.QA_USER.id}`)).json()).some((r: { id: number }) => r.id === inserted.insertId)).toBe(false);
    expect((await actors.QA_USER_B.post(`/api/residents/me/notifications/${inserted.insertId}/read`)).status()).toBe(404);
    await unchanged();
    const exported = await (await actors.QA_USER_B.get(`/api/residents/me/export?residentId=${personas.QA_USER.id}`)).json();
    expect(exported.profile.id === personas.QA_USER_B.id && !("password_hash" in exported.profile)).toBe(true);
  });
});

test("IDOR-BOOKING: seeded unpaid booking rejects foreign capability and foreign email", async ({ playwright }) => {
  await withActors(playwright, ["QA_USER", "QA_USER_B", "GUEST"], async ({ actors, connection, track, snapshot }) => {
    // Authorization-only fixture. No checkout, Stripe call, charge, refund or paid booking.
    const centre = randomUUID();
    const ref = `QA-${randomUUID()}`;
    const client = randomUUID();
    await connection.execute("INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, blurb) VALUES (?, 'QA fixture', '', '', 0, 0, 5, 0, '', '', '')", [centre]);
    track("centres", "id", centre);
    await connection.execute("INSERT INTO bookings (ref, client_id, centre_id, room_id, date, time, duration, event_type, guests, name, email, phone, notes, total_cents, payment_status) VALUES (?, ?, ?, '', '2030-06-20', '12:00', 1, 'QA', 1, 'QA private', ?, '', 'Synthetic private notes', 0, 'pending')", [ref, client, centre, env.QA_USER_EMAIL]);
    track("bookings", "ref", ref);
    const unchanged = await snapshot("SELECT * FROM bookings WHERE ref = ?", [ref]);
    expect((await actors.QA_USER.get(`/api/bookings/status/${ref}`, { headers: { "X-Client-Id": client } })).status()).toBe(200);
    for (const role of ["QA_USER_B", "GUEST"]) {
      expect((await actors[role].get(`/api/bookings/status/${ref}`, { headers: { "X-Client-Id": randomUUID() } })).status()).toBe(404);
      expect((await actors[role].post("/api/bookings/lookup", { data: { ref, email: env.QA_USER_B_EMAIL } })).status()).toBe(404);
      expect((await actors[role].post(`/api/bookings/${ref}/cancel`, { data: { email: env.QA_USER_B_EMAIL }, headers: { "X-Client-Id": randomUUID() } })).status()).toBe(404);
      await unchanged();
    }
  });
});

test("IDOR-APPROVAL: organiser cannot substitute another Circle's join-request ID", async ({ playwright }) => {
  await withActors(playwright, ["QA_USER", "QA_USER_B"], async ({ actors, connection, track, snapshot }) => {
    const circles: string[] = [];
    for (const role of ["QA_USER", "QA_USER_B"]) {
      const created = await actors[role].post("/api/circles", { data: { name: `QA approval ${randomUUID()}`, joinMode: "approval" } });
      expect(created.status()).toBe(201);
      const { id } = await created.json();
      circles.push(id);
      track("circles", "id", id);
      track("circle_members", "circle_id", id);
      track("circle_invites", "circle_id", id);
    }
    const invitation = randomUUID();
    await connection.execute("INSERT INTO circle_invites (id, circle_id, resident_id, invited_by_resident_id, initiated_by) VALUES (?, ?, ?, ?, 'resident')", [invitation, circles[0], personas.QA_USER_B.id, personas.QA_USER_B.id]);
    const unchanged = await snapshot("SELECT * FROM circle_invites WHERE id = ?", [invitation]);
    const members = await snapshot("SELECT * FROM circle_members WHERE circle_id IN (?, ?) ORDER BY id", circles);
    expect((await actors.QA_USER_B.post(`/api/circles/${circles[1]}/join-requests/${invitation}/respond`, { data: { accept: true } })).status()).toBe(404);
    await unchanged();
    await members();
    expect((await actors.QA_USER_B.get(`/api/circles/${circles[0]}/members`)).status()).toBe(403);
    const teaser = await (await actors.QA_USER_B.get(`/api/circles/${circles[0]}`)).json();
    expect(teaser.restricted === true && teaser.whatWeDo === null && teaser.imageUrl === null).toBe(true);
  });
});
