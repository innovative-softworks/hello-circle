import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { ADMIN_PERMISSIONS } from "../adminPermissions.js";
import { myLifeRouter } from "../myLife.js";
import { scheduleReviewInvitation, sweepReviewInvitations } from "../myLifePlans.js";
import { attendanceRouter } from "./attendanceCorrections.js";
import { reviewsRouter } from "./reviews.js";
import { followsRouter, notifyHostFollowers } from "./follows.js";
import { adminVerificationRouter } from "./verificationChecks.js";

// Trust & Retention — next plan → attend → confirmed → review → go again /
// follow (docs/trust-retention/06-*). Identity is stubbed per request.

const u = crypto.randomUUID().slice(0, 8);
const id = (p: string) => `test-j-${p}-${u}`;
const vendor = id("vendor");
const org = id("org");
const centre = id("centre");
const club = id("club");
const exp = id("exp");
const me = id("me");
const other = id("other");
const host = id("host");
const circle = id("circle");
const privateCircle = id("pcircle");
const series = id("series");
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin" }).format(new Date());
const plus = (days: number) => new Date(new Date(`${today}T12:00:00Z`).getTime() + days * 86400000).toISOString().slice(0, 10);

let server: Server;
let base = "";
type Who = { resident?: string; client?: string; user?: string };
const call = (method: string, path: string, who: Who = {}, body?: unknown) => {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (who.client) h["X-Client-Id"] = who.client;
  if (who.resident) h["x-test-resident"] = who.resident;
  if (who.user) h["x-test-user"] = who.user;
  return fetch(`${base}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
};

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(async (req, _res, next) => {
    const r = req.header("x-test-resident");
    if (r) (req as any).resident = { id: r, email: `${r}@example.test`, name: r };
    const t = req.header("x-test-user");
    if (t) {
      const [kind, a] = t.split(":");
      if (kind === "admin") (req as any).user = { id: id(`admin-${a}`), role: "admin", status: "approved", adminRole: a };
      else (req as any).user = { id: a, role: "vendor", status: "approved", orgId: org, invitedStaff: false };
    }
    next();
  });
  app.use("/my-life", myLifeRouter);
  app.use("/attendance", attendanceRouter);
  app.use("/reviews", reviewsRouter);
  app.use("/follows", followsRouter);
  app.use("/admin/verification", adminVerificationRouter);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const a = server.address();
  if (!a || typeof a === "string") throw new Error("bind");
  base = `http://127.0.0.1:${a.port}`;

  await db.prepare(`INSERT INTO organisations (id, name, kind, status) VALUES (?, 'J Org', 'vendor', 'active')`).run(org);
  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name, business_name, org_id) VALUES (?, ?, 'x', 'vendor', 'approved', 'V', 'J Hall Ltd', ?)`).run(vendor, `${vendor}@example.test`, org);
  for (const r of [me, other, host]) await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, ?)`).run(r, `${r}@example.test`, `Name ${r.slice(7, 12)}`);
  await db
    .prepare(`INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, image_url, blurb, vendor_id, status, newcomer_welcome) VALUES (?, 'J Hall', 'Rathmines', 'Dublin', 0, 0, 20, 1000, 'M', '', '', '', ?, 'approved', 'Pat opens up')`)
    .run(centre, vendor);
  await db
    .prepare(`INSERT INTO clubs (id, name, sport, area, county, ages, price, unit, trial, ph, image_url, blurb, vendor_id, status) VALUES (?, 'J Club', 'Rowing', 'A', 'Dublin', '8-12', 10, 'year', 0, '', '', '', ?, 'approved')`)
    .run(club, vendor);
  await db
    .prepare(
      `INSERT INTO experiences (id, vendor_id, title, area, county, blurb, description, fitness_requirements, itinerary, equipment_provided, equipment_required, transport_info, safety_info, weather_policy, eligibility, cancellation_terms, status, capacity, price_cents, duration_minutes, meeting_point, newcomer_welcome)
       VALUES (?, ?, 'J Kayak', 'Howth', 'Dublin', 'b', 'd', '', '', '', 'Towel', '', '', '', '', '', 'approved', 6, 4000, 120, 'Howth pier', 'Guide Ciara')`
    )
    .run(exp, vendor);
  const sess = `INSERT INTO experience_sessions (id, experience_id, date, time, status) VALUES (?, ?, ?, '10:00', ?)`;
  await db.prepare(sess).run(id("es-past"), exp, plus(-3), "scheduled");
  await db.prepare(sess).run(id("es-cancelled"), exp, plus(4), "cancelled");
  await db.prepare(sess).run(id("es-next"), exp, plus(6), "scheduled");
  await db.prepare(`INSERT INTO circles (id, name, activity_label, area, county, about, created_by_resident_id, join_mode) VALUES (?, 'J Circle', 'Walks', 'A', 'Dublin', '', ?, 'open'), (?, 'J Private', 'Walks', 'A', 'Dublin', '', ?, 'invite')`).run(circle, host, privateCircle, host);
  await db.prepare(`INSERT INTO circle_members (circle_id, resident_id, role) VALUES (?, ?, 'organiser'), (?, ?, 'member'), (?, ?, 'organiser')`).run(circle, host, circle, me, privateCircle, host);
  await db.prepare(`INSERT INTO game_series (id, host_resident_id, weekdays, start_date, end_date, time) VALUES (?, ?, '3', ?, ?, '18:00')`).run(series, host, plus(-2), plus(30));
  const game = `INSERT INTO games (id, host_resident_id, activity_label, location_text, date, time, capacity, status, visibility, series_id, circle_id, price_cents, duration_minutes) VALUES (?, ?, ?, 'Park gate', ?, ?, ?, ?, ?, ?, ?, ?, 60)`;
  await db.prepare(game).run(id("g-past"), host, "J Run", plus(-2), "18:00", 8, "open", "public", series, null, 0);
  await db.prepare(game).run(id("g-next-cancelled"), host, "J Run", plus(5), "18:00", 8, "cancelled", "public", series, null, 0);
  await db.prepare(game).run(id("g-next-private"), host, "J Run", plus(9), "18:00", 8, "open", "circle", series, privateCircle, 0);
  await db.prepare(game).run(id("g-next-full"), host, "J Run", plus(12), "18:00", 1, "open", "public", series, null, 0);
  await db.prepare(game).run(id("g-next"), host, "J Run", plus(19), "18:00", 8, "open", "public", series, null, 500);
  await db.prepare(game).run(id("g-samename"), host, "J Run", plus(7), "18:00", 8, "open", "public", null, null, 0); // same name, not the series
  await db.prepare(game).run(id("g-meetup"), host, "J Circle walk", plus(2), "11:00", 10, "open", "public", null, circle, 0);
  await db.prepare(game).run(id("g-waitlist"), host, "J Busy", plus(1), "09:00", 1, "open", "public", null, null, 0);
  for (const [g, r] of [[id("g-past"), host], [id("g-past"), me], [id("g-next-full"), other], [id("g-meetup"), host], [id("g-meetup"), me], [id("g-waitlist"), other]]) {
    await db.prepare(`INSERT INTO game_participants (game_id, resident_id) VALUES (?, ?)`).run(g, r);
  }
  await db.prepare(`INSERT INTO waitlist_entries (listing_type, listing_id, resident_id, client_id, name, email, status) VALUES ('game', ?, ?, 'c', 'Me', 'me@example.test', 'waiting')`).run(id("g-waitlist"), me);
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  const like = `%${u}%`;
  for (const [t, c] of [
    ["review_invitations", "resident_id"], ["notifications", "resident_id"], ["follows", "resident_id"], ["follows", "followed_id"], ["review_claims", "review_id"],
  ] as const) {
    if (t === "review_claims") await db.prepare(`DELETE FROM review_claims WHERE review_id IN (SELECT id FROM reviews WHERE listing_id LIKE ?)`).run(like);
    else await db.prepare(`DELETE FROM ${t} WHERE ${c} LIKE ?`).run(like);
  }
  await db.prepare(`DELETE FROM reviews WHERE listing_id LIKE ?`).run(like);
  await db.prepare(`DELETE FROM attendance WHERE ref LIKE ?`).run(like);
  await db.prepare(`DELETE FROM attendance_corrections WHERE ref LIKE ?`).run(like);
  await db.prepare(`DELETE FROM reports WHERE reporter_client_id = 'system:attendance' AND target_id IN (SELECT CAST(id AS CHAR) FROM reviews WHERE listing_id LIKE ?)`).run(like);
  await db.prepare(`DELETE FROM waitlist_entries WHERE listing_id LIKE ?`).run(like);
  await db.prepare(`DELETE FROM game_participants WHERE game_id LIKE ?`).run(like);
  await db.prepare(`DELETE FROM games WHERE id LIKE ?`).run(like);
  await db.prepare(`DELETE FROM game_series WHERE id LIKE ?`).run(like);
  await db.prepare(`DELETE FROM circle_members WHERE circle_id LIKE ?`).run(like);
  await db.prepare(`DELETE FROM circle_plan_interest WHERE resident_id LIKE ?`).run(like);
  await db.prepare(`DELETE FROM circle_plans WHERE circle_id LIKE ?`).run(like);
  await db.prepare(`DELETE FROM circles WHERE id LIKE ?`).run(like);
  await db.prepare(`DELETE FROM experience_bookings WHERE experience_id = ?`).run(exp);
  await db.prepare(`DELETE FROM experience_sessions WHERE experience_id = ?`).run(exp);
  await db.prepare(`DELETE FROM experiences WHERE id = ?`).run(exp);
  await db.prepare(`DELETE FROM registrations WHERE club_id = ?`).run(club);
  await db.prepare(`DELETE FROM clubs WHERE id = ?`).run(club);
  await db.prepare(`DELETE FROM bookings WHERE centre_id = ?`).run(centre);
  await db.prepare(`DELETE FROM centres WHERE id = ?`).run(centre);
  await db.prepare(`DELETE FROM verification_checks WHERE subject_id LIKE ?`).run(like);
  await db.prepare(`DELETE FROM residents WHERE id LIKE ?`).run(like);
  await db.prepare(`DELETE FROM users WHERE id LIKE ?`).run(like);
  await db.prepare(`DELETE FROM organisations WHERE id LIKE ?`).run(like);
});

async function expBooking(ref: string, sessionKey: string, resident: string | null, party = 1) {
  await db
    .prepare(`INSERT INTO experience_bookings (ref, experience_id, session_id, client_id, resident_id, participant_name, email, phone, party_size, total_cents, payment_status, status) VALUES (?, ?, ?, ?, ?, 'Me', 'me@example.test', '', ?, 4000, 'paid', 'confirmed')`)
    .run(ref, exp, id(sessionKey), id("client"), resident, party);
}
const plans = async (who: Who) => (await (await call("GET", "/my-life/plans", who)).json()) as any;
const invitations = async (ref: string) => (await db.prepare(`SELECT status, reason, notification_id as nid FROM review_invitations WHERE occurrence_ref = ?`).all(ref)) as any[];

describe("your next plan", () => {
  it("orders by time, labels honestly, and never offers a waitlist, interest or someone else's plan as a place", async () => {
    await expBooking(id("exb-next"), "es-next", me);
    const plan = (await db.prepare(`INSERT INTO circle_plans (id, circle_id, created_by_resident_id, title, note, status, proposed_date) VALUES (?, ?, ?, 'J Swim idea', '', 'open', ?)`).run(id("plan"), circle, host, plus(1))) as any;
    void plan;
    await db.prepare(`INSERT INTO circle_plan_interest (plan_id, resident_id) VALUES (?, ?)`).run(id("plan"), me);
    const p = await plans({ resident: me });
    // Waitlist (tomorrow 09:00) and interest (tomorrow) are earlier but aren't commitments.
    expect(p.next).toMatchObject({ title: "J Circle walk", status: "rsvp", circleName: "J Circle", statusLabel: "Going · Circle meetup" });
    expect(p.next.prep.meeting).toBeNull(); // no meeting instructions set
    const byTitle = Object.fromEntries(p.upcoming.map((x: any) => [x.title, x]));
    expect(byTitle["J Busy"]).toMatchObject({ status: "waitlist", statusLabel: "On the waitlist — not a place yet" });
    expect(byTitle["J Swim idea"]).toMatchObject({ status: "interest", statusLabel: "Interested — not a booking" });
    expect(byTitle["J Kayak"]).toMatchObject({ status: "confirmed", prep: { meeting: "Howth pier", welcome: "Guide Ciara", bring: "Towel" } });
    // Someone else sees none of it.
    const o = await plans({ resident: other });
    expect([o.next, ...o.upcoming].some((x: any) => x && (x.title === "J Kayak" || x.title === "J Swim idea"))).toBe(false);
  });

  it("a cancelled session shows as cancelled, not booked", async () => {
    await expBooking(id("exb-cxl"), "es-cancelled", me);
    const p = await plans({ resident: me });
    const cxl = p.upcoming.find((x: any) => x.ref === id("exb-cxl"));
    expect(cxl).toMatchObject({ status: "cancelled", statusLabel: "Cancelled" });
  });
});

describe("after the visit: invitations, go again, follow", () => {
  it("one invitation after confirmation of a finished visit; repeats and races make no second one; withdraw voids it and restoring never re-sends", async () => {
    const ref = id("exb-past");
    await expBooking(ref, "es-past", me, 3);
    let recent = (await plans({ resident: me })).recent.find((x: any) => x.ref === ref);
    expect(recent.visit).toBe("not_confirmed");
    expect((await call("POST", "/attendance/confirm", { user: `vendor:${vendor}` }, { kind: "experience", ref })).status).toBe(201);
    await Promise.all(Array.from({ length: 5 }, () => scheduleReviewInvitation("experience", ref)));
    await sweepReviewInvitations();
    let inv = await invitations(ref);
    expect(inv).toHaveLength(1);
    expect(inv[0].status).toBe("sent");
    const notes = (await db.prepare(`SELECT title, ref FROM notifications WHERE resident_id = ? AND kind = 'review_invite'`).all(me)) as any[];
    expect(notes).toHaveLength(1);
    expect(notes[0].ref).toBe(`experience/${ref}`);
    recent = (await plans({ resident: me })).recent.find((x: any) => x.ref === ref);
    expect(recent.visit).toBe("review_available");
    // Go again: the next open session of the same experience (not the cancelled one).
    expect(recent.goAgain).toMatchObject({ kind: "occurrence", date: plus(6), priceCents: 4000 });

    // Withdrawn → the notification stops inviting; restored → no second invitation.
    const confId = ((await db.prepare(`SELECT id FROM attendance_corrections WHERE ref = ? AND status = 'accepted'`).get(ref)) as { id: number }).id;
    expect((await call("POST", `/attendance/confirm/${confId}/withdraw`, { user: `vendor:${vendor}` }, { note: "Wrong booking confirmed" })).status).toBe(200);
    inv = await invitations(ref);
    expect(inv[0].status).toBe("void");
    const changed = (await db.prepare(`SELECT title, body FROM notifications WHERE id = ?`).get(inv[0].nid)) as { title: string; body: string };
    expect(changed.body).toMatch(/attendance record changed/);
    expect((await call("POST", "/attendance/confirm", { user: `vendor:${vendor}` }, { kind: "experience", ref })).status).toBe(201);
    await sweepReviewInvitations();
    expect(await invitations(ref)).toHaveLength(1);
    expect(Number(((await db.prepare(`SELECT COUNT(*) as n FROM notifications WHERE resident_id = ? AND kind = 'review_invite'`).get(me)) as { n: number }).n)).toBe(1);
  });

  it("confirmation before the visit ends is scheduled, not sent; preference off or already reviewed → skipped", async () => {
    // Confirmed early (organiser data entry): not sent until it ends.
    await db.prepare(`INSERT INTO attendance (kind, ref, status, source) VALUES ('game', ?, 'present', 'host_manual')`).run(`${id("g-meetup")}:${me}`);
    await scheduleReviewInvitation("game", `${id("g-meetup")}:${me}`);
    await sweepReviewInvitations();
    expect((await invitations(id("g-meetup")))[0].status).toBe("scheduled");

    // Preference off.
    await db.prepare(`UPDATE residents SET notification_prefs = ? WHERE id = ?`).run(JSON.stringify({ reviewInvites: false }), other);
    await db.prepare(`INSERT INTO game_participants (game_id, resident_id) VALUES (?, ?)`).run(id("g-past"), other);
    await db.prepare(`INSERT INTO attendance (kind, ref, status, source) VALUES ('game', ?, 'present', 'host_manual')`).run(`${id("g-past")}:${other}`);
    await scheduleReviewInvitation("game", `${id("g-past")}:${other}`);
    expect((await db.prepare(`SELECT status, reason FROM review_invitations WHERE resident_id = ? AND occurrence_ref = ?`).get(other, id("g-past"))) as any).toMatchObject({ status: "skipped", reason: "preference_off" });
    expect(Number(((await db.prepare(`SELECT COUNT(*) as n FROM notifications WHERE resident_id = ? AND kind = 'review_invite'`).get(other)) as { n: number }).n)).toBe(0);

    // Already reviewed before the invitation went out.
    await db.prepare(`INSERT INTO attendance (kind, ref, status, source) VALUES ('game', ?, 'present', 'host_manual')`).run(`${id("g-past")}:${me}`);
    expect((await call("POST", "/reviews", { resident: me, client: id("cl") }, { listingType: "game", listingId: id("g-past"), name: "Me", rating: 4 })).status).toBe(201);
    await scheduleReviewInvitation("game", `${id("g-past")}:${me}`);
    expect((await db.prepare(`SELECT status, reason FROM review_invitations WHERE resident_id = ? AND occurrence_ref = ?`).get(me, id("g-past"))) as any).toMatchObject({ status: "skipped", reason: "already_reviewed" });
  });

  it("go again follows the series only: skips cancelled, private, full and same-named non-series games", async () => {
    const recent = (await plans({ resident: me })).recent.find((x: any) => x.ref === id("g-past"));
    expect(recent.visit).toBe("review_submitted");
    expect(recent.goAgain).toMatchObject({ kind: "occurrence", date: plus(19), priceCents: 500, href: `/games/${id("g-next")}` });
    expect(recent.followTarget).toMatchObject({ type: "host", id: host });
  });

  it("follow: anyone hosting in public can be followed, never yourself; levels change delivery", async () => {
    expect((await call("POST", "/follows", { resident: me }, { followedType: "host", followedId: host })).status).toBe(201);
    expect((await call("POST", "/follows", { resident: host }, { followedType: "host", followedId: host })).status).toBe(400);
    expect((await call("POST", "/follows", { resident: other }, { followedType: "host", followedId: host })).status).toBe(201);
    expect((await call("PUT", "/follows/notification-level", { resident: other }, { followedType: "host", followedId: host, level: "everything" })).status).toBe(200);
    await notifyHostFollowers(host, { title: "Another date added", body: "x", ref: id("g-next") }, "everything");
    await notifyHostFollowers(host, { title: "New activity", body: "x", ref: id("g-next") });
    const count = async (r: string, title: string) => Number(((await db.prepare(`SELECT COUNT(*) as n FROM notifications WHERE resident_id = ? AND kind = 'host_update' AND title = ?`).get(r, title)) as { n: number }).n);
    expect(await count(me, "Another date added")).toBe(0); // Highlights
    expect(await count(other, "Another date added")).toBe(1); // Everything
    expect(await count(me, "New activity")).toBe(1);
    // State is consistent: the plans endpoint now reports following.
    const recent = (await plans({ resident: me })).recent.find((x: any) => x.ref === id("g-past"));
    expect(recent.following).toBe(true);
    expect((await call("DELETE", "/follows", { resident: me }, { followedType: "host", followedId: host })).status).toBe(200);
    expect((await plans({ resident: me })).recent.find((x: any) => x.ref === id("g-past")).following).toBe(false);
  });
});

describe("child registrations stay separate from personal reviews", () => {
  it("a confirmed child registration never opens a review or an invitation for the account holder", async () => {
    const ref = id("reg-child");
    await db
      .prepare(
        `INSERT INTO registrations (ref, client_id, resident_id, club_id, team, child_first, child_last, dob, g_first, g_last, email, phone, address, ec_name, ec_phone, ec_rel, medical, consent, trial, total_cents, status, payment_status)
         VALUES (?, ?, ?, ?, 'T', 'Kid', 'Me', '2015-01-01', 'Me', 'Me', 'me@example.test', '', '', '', '', '', '', 1, 0, 1000, 'confirmed', 'paid')`
      )
      .run(ref, id("client"), me, club);
    expect((await call("POST", "/attendance/confirm", { user: `vendor:${vendor}` }, { kind: "registration", ref })).status).toBe(409);
    // Even an accepted request (the club recording the child) gives the parent nothing to review.
    await db.prepare(`INSERT INTO attendance_corrections (kind, ref, resident_id, status, owner_vendor_id) VALUES ('registration', ?, ?, 'accepted', ?)`).run(ref, me, vendor);
    const e = (await (await call("GET", `/reviews/eligible?listingType=club&listingId=${club}`, { resident: me, client: id("cl") })).json()) as any;
    expect(e).toMatchObject({ eligible: false, reason: "guardian" });
    expect((await call("POST", "/reviews", { resident: me, client: id("cl") }, { listingType: "club", listingId: club, name: "Me", rating: 5 })).status).toBe(403);
    await scheduleReviewInvitation("registration", ref);
    expect(await invitations(ref)).toHaveLength(0);
    const places = (await (await call("GET", `/attendance/places/registration/${ref}`, { resident: me, client: id("client") })).json()) as any;
    expect(places.items[0].forSomeoneElse).toBe(true);
  });
});

describe("verification evidence stays restricted", () => {
  it("a queue role without decisions.internal_notes.view gets the case but not the evidence note (isolated permission fixture)", async () => {
    const r = await db
      .prepare(`INSERT INTO verification_checks (subject_type, subject_id, check_type, status, submitted_details, evidence_note, decided_at) VALUES ('vendor', ?, 'business_details', 'approved', 'details', 'EVIDENCE-SECRET', NOW())`)
      .run(vendor);
    const table = ADMIN_PERMISSIONS as unknown as Record<string, string[]>;
    const original = table["decisions.internal_notes.view"];
    table["decisions.internal_notes.view"] = original.filter((role) => role !== "support");
    try {
      const res = (await (await call("GET", `/admin/verification/${r.lastInsertRowid}`, { user: "admin:support" })).json()) as any;
      expect(res.evidenceRestricted).toBe(true);
      expect(res.check.evidenceNote).toBeNull();
      expect(JSON.stringify(res)).not.toContain("EVIDENCE-SECRET");
    } finally {
      table["decisions.internal_notes.view"] = original;
    }
    const allowed = (await (await call("GET", `/admin/verification/${r.lastInsertRowid}`, { user: "admin:support" })).json()) as any;
    expect(allowed.check.evidenceNote).toBe("EVIDENCE-SECRET");
  });
});
