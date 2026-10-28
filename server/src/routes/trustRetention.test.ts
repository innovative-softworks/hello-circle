import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { attendanceRouter, adminAttendanceRouter } from "./attendanceCorrections.js";
import { reviewsRouter } from "./reviews.js";
import { residentsRouter } from "./residents.js";
import { reportsRouter } from "./reports.js";
import { providersRouter } from "./providers.js";
import { adminVerificationRouter, vendorVerificationRouter } from "./verificationChecks.js";
import { vendorOperationsRouter } from "./vendorOperations.js";
import { residentLabels, vendorLabels } from "../verification.js";

// Trust & Retention batch 1 (docs/trust-retention/). Identity is stubbed at
// the request layer (same approach as vendorOperations.test.ts): headers say
// who is calling, so the tests exercise the rules, not the login flows.
//   x-test-resident: <resident id>
//   x-test-user: vendor:<id>[:staff:<role>] | admin:<role>

const u = crypto.randomUUID().slice(0, 8);
const id = (p: string) => `test-tr-${p}-${u}`;

const vendorA = id("vendorA"); // org A owner
const staffA = id("staffA"); // org A staff, finance role
const vendorB = id("vendorB"); // org B owner (another organisation)
const orgA = id("orgA");
const orgB = id("orgB");
const centreA = id("centreA");
const expA = id("expA");
const expSessionPast = id("expSess");
const host = id("host");
const player = id("player");
const player2 = id("player2");
const stranger = id("stranger");
const gamePast = id("gamePast");
const gameCancelled = id("gameCancelled");
const privateGame = id("privateGame");
const inviteCircle = id("inviteCircle");
const quietResident = id("quiet");

let server: Server;
let base = "";

type Who = { client?: string; resident?: string; user?: string };
function headers(who: Who = {}): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (who.client) h["X-Client-Id"] = who.client;
  if (who.resident) h["x-test-resident"] = who.resident;
  if (who.user) h["x-test-user"] = who.user;
  return h;
}
const call = (method: string, path: string, who: Who = {}, body?: unknown) =>
  fetch(`${base}${path}`, { method, headers: headers(who), body: body === undefined ? undefined : JSON.stringify(body) });

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(async (req, _res, next) => {
    const r = req.header("x-test-resident");
    if (r) (req as any).resident = { id: r, email: `${r}@example.test`, name: r };
    const t = req.header("x-test-user");
    if (t) {
      const [role, a, b, c] = t.split(":");
      if (role === "admin") (req as any).user = { id: id("admin-" + a), role: "admin", status: "approved", adminRole: a };
      else {
        const row = (await db.prepare(`SELECT org_id as orgId FROM users WHERE id = ?`).get(a)) as { orgId: string | null } | undefined;
        (req as any).user = { id: a, role: "vendor", status: "approved", orgId: row?.orgId ?? null, invitedStaff: b === "staff", platformRole: b === "staff" ? c : null };
      }
    }
    next();
  });
  app.use("/reviews", reviewsRouter);
  app.use("/attendance", attendanceRouter);
  app.use("/admin/attendance", adminAttendanceRouter);
  app.use("/admin/verification", adminVerificationRouter);
  app.use("/vendor/verification", vendorVerificationRouter);
  app.use("/residents", residentsRouter);
  app.use("/reports", reportsRouter);
  app.use("/providers", providersRouter);
  app.use("/vendor", async (req, _res, next) => {
    (req as any).vendorIds = req.user ? ((await db.prepare(`SELECT id FROM users WHERE org_id = ?`).all((req as any).user.orgId)) as { id: string }[]).map((x) => x.id) : [];
    next();
  }, vendorOperationsRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("bind failed");
  base = `http://127.0.0.1:${addr.port}`;

  await db.prepare(`INSERT INTO organisations (id, name, kind, status) VALUES (?, 'TR Org A', 'vendor', 'active'), (?, 'TR Org B', 'vendor', 'active')`).run(orgA, orgB);
  const vendor = `INSERT INTO users (id, email, password_hash, role, status, name, business_name, org_id, invited_staff, platform_role) VALUES (?, ?, 'x', 'vendor', 'approved', ?, ?, ?, ?, ?)`;
  await db.prepare(vendor).run(vendorA, `${vendorA}@example.test`, "Owner A", "Org A Ltd", orgA, 0, null);
  await db.prepare(vendor).run(staffA, `${staffA}@example.test`, "Staff A", "", orgA, 1, "finance");
  await db.prepare(vendor).run(vendorB, `${vendorB}@example.test`, "Owner B", "Org B Ltd", orgB, 0, null);
  await db
    .prepare(`INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, image_url, blurb, vendor_id, status) VALUES (?, 'TR Hall', 'Rathmines', 'Dublin', 0, 0, 20, 1000, 'M', '', '', '', ?, 'approved')`)
    .run(centreA, vendorA);
  await db
    .prepare(
      `INSERT INTO experiences (id, vendor_id, title, area, county, blurb, description, fitness_requirements, itinerary, equipment_provided, equipment_required, transport_info, safety_info, weather_policy, eligibility, cancellation_terms, status)
       VALUES (?, ?, 'TR Kayak', 'Area', 'Cork', 'b', 'd', '', '', '', '', '', '', '', '', '', 'approved')`
    )
    .run(expA, vendorA);
  await db.prepare(`INSERT INTO experience_sessions (id, experience_id, date, time) VALUES (?, ?, '2020-05-01', '10:00')`).run(expSessionPast, expA);
  for (const r of [host, player, player2, stranger, quietResident]) {
    await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, ?)`).run(r, `${r}@example.test`, `Name ${r.slice(8, 14)}`);
  }
  await db.prepare(`UPDATE residents SET email_verified_at = NOW() WHERE id = ?`).run(host);
  const game = `INSERT INTO games (id, host_resident_id, activity_label, centre_id, date, time, capacity, status, visibility) VALUES (?, ?, ?, ?, ?, '10:00', 8, ?, ?)`;
  await db.prepare(game).run(gamePast, host, "TR Kickabout", centreA, "2020-06-01", "open", "public");
  await db.prepare(game).run(gameCancelled, host, "TR Cancelled", centreA, "2020-06-02", "cancelled", "public");
  await db.prepare(game).run(privateGame, host, "TR Secret", centreA, "2099-06-02", "open", "circle");
  for (const g of [gamePast, gameCancelled]) {
    for (const p of [host, player, player2]) await db.prepare(`INSERT INTO game_participants (game_id, resident_id) VALUES (?, ?)`).run(g, p);
  }
  await db.prepare(`INSERT INTO circles (id, name, activity_label, area, county, about, created_by_resident_id, join_mode) VALUES (?, 'TR Invite Circle', 'Chess', 'Area', 'Dublin', '', ?, 'invite')`).run(inviteCircle, host);
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const like = `%${u}%`;
  await db.prepare(`DELETE FROM reviews WHERE listing_id LIKE ? OR client_id LIKE ?`).run(like, like);
  await db.prepare(`DELETE FROM attendance WHERE ref LIKE ?`).run(like);
  await db.prepare(`DELETE FROM attendance_corrections WHERE ref LIKE ?`).run(like);
  await db.prepare(`DELETE FROM verification_checks WHERE subject_id LIKE ?`).run(like);
  await db.prepare(`DELETE FROM moderation_decisions WHERE object_type = 'verification_check'`).run();
  await db.prepare(`DELETE FROM reports WHERE reporter_client_id LIKE ?`).run(like);
  await db.prepare(`DELETE FROM program_enrollments WHERE program_id LIKE ?`).run(like);
  await db.prepare(`DELETE FROM program_sessions WHERE program_id LIKE ?`).run(like);
  await db.prepare(`DELETE FROM programs WHERE id LIKE ?`).run(like);
  await db.prepare(`DELETE FROM audit_log WHERE object_type = 'attendance_correction'`).run();
  await db.prepare(`DELETE FROM bookings WHERE centre_id = ?`).run(centreA);
  await db.prepare(`DELETE FROM experience_bookings WHERE experience_id = ?`).run(expA);
  await db.prepare(`DELETE FROM experience_sessions WHERE experience_id = ?`).run(expA);
  await db.prepare(`DELETE FROM experiences WHERE id = ?`).run(expA);
  await db.prepare(`DELETE FROM game_participants WHERE game_id LIKE ?`).run(like);
  await db.prepare(`DELETE FROM games WHERE id LIKE ?`).run(like);
  await db.prepare(`DELETE FROM circles WHERE id LIKE ?`).run(like);
  await db.prepare(`DELETE FROM notifications WHERE recipient_id LIKE ? OR resident_id LIKE ?`).run(like, like);
  await db.prepare(`DELETE FROM centres WHERE id = ?`).run(centreA);
  await db.prepare(`DELETE FROM residents WHERE id LIKE ?`).run(like);
  await db.prepare(`DELETE FROM users WHERE id LIKE ?`).run(like);
  await db.prepare(`DELETE FROM organisations WHERE id LIKE ?`).run(like);
});

async function booking(client: string, opts: { date?: string; status?: string; paid?: boolean } = {}) {
  const ref = id(`bkg-${crypto.randomUUID().slice(0, 6)}`);
  await db
    .prepare(
      `INSERT INTO bookings (ref, client_id, centre_id, room_id, date, time, duration, event_type, guests, name, email, phone, notes, total_cents, status, payment_status)
       VALUES (?, ?, ?, 'room', ?, '18:00', 1, 'Event', 12, 'Guest', 'g@example.test', '', '', 1000, ?, ?)`
    )
    .run(ref, client, centreA, opts.date ?? "2020-01-01", opts.status ?? "confirmed", opts.paid === false ? "pending" : "paid");
  return ref;
}
const mark = (kind: string, ref: string, status: string) =>
  db.prepare(`INSERT INTO attendance (kind, ref, status, source) VALUES (?, ?, ?, 'host_manual') ON DUPLICATE KEY UPDATE status = VALUES(status)`).run(kind, ref, status);
const eligible = async (type: string, listing: string, who: Who) => (await (await call("GET", `/reviews/eligible?listingType=${type}&listingId=${listing}`, who)).json()) as any;
const post = (who: Who, body: Record<string, unknown>) => call("POST", "/reviews", who, { name: "Reviewer", rating: 4, ...body });

/** The organiser accepts this person's "I attended" request (fixture shortcut; the route is exercised below). */
const confirmPerson = (kind: string, ref: string, who: { client?: string; resident?: string }) =>
  db
    .prepare(`INSERT INTO attendance_corrections (kind, ref, resident_id, client_id, status, owner_vendor_id, decided_at) VALUES (?, ?, ?, ?, 'accepted', ?, NOW())`)
    .run(kind, ref, who.resident ?? null, who.client ?? null, vendorA);

describe("review eligibility needs this person's attendance confirmed by the organiser", () => {
  it("a past paid booking with no confirmation is not reviewable — and says why", async () => {
    const client = id(`c-${crypto.randomUUID().slice(0, 6)}`);
    await booking(client);
    const e = await eligible("centre", centreA, { client });
    expect(e.eligible).toBe(false);
    expect(e.reason).toBe("not_confirmed");
    expect(e.unconfirmed).toHaveLength(1);
    expect((await post({ client }, { listingType: "centre", listingId: centreA })).status).toBe(403);
  });

  it("a door check-in of the booking alone doesn't establish who attended", async () => {
    const client = id("c-door");
    await mark("booking", await booking(client), "present");
    expect((await eligible("centre", centreA, { client })).reason).toBe("not_confirmed");
  });

  it("a cancelled or future booking isn't reviewable even when confirmed; a no-show overrides an accepted request", async () => {
    const c2 = id("c-cancel");
    const r2 = await booking(c2, { status: "cancelled" });
    await confirmPerson("booking", r2, { client: c2 });
    expect((await eligible("centre", centreA, { client: c2 })).eligible).toBe(false);
    const c3 = id("c-future");
    const r3 = await booking(c3, { date: "2099-01-01" });
    await confirmPerson("booking", r3, { client: c3 });
    expect((await eligible("centre", centreA, { client: c3 })).eligible).toBe(false);
    const c4 = id("c-overturn");
    const r4 = await booking(c4);
    await confirmPerson("booking", r4, { client: c4 });
    expect((await eligible("centre", centreA, { client: c4 })).eligible).toBe(true);
    await mark("booking", r4, "no_show");
    expect((await eligible("centre", centreA, { client: c4 })).eligible).toBe(false);
  });

  it("once confirmed, one review per booking; a racing double submit makes one review, labelled verified", async () => {
    const client = id("c-ok");
    const ref = await booking(client);
    await confirmPerson("booking", ref, { client });
    const e = await eligible("centre", centreA, { client });
    expect(e.occurrences[0]).toMatchObject({ ref, basis: "person", reviewed: false });
    const [a, b] = await Promise.all([post({ client }, { listingType: "centre", listingId: centreA, tags: ["good_value", "nonsense"] }), post({ client }, { listingType: "centre", listingId: centreA })]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const n = (await db.prepare(`SELECT COUNT(*) as n FROM reviews WHERE occurrence_ref = ?`).get(ref)) as { n: number };
    expect(Number(n.n)).toBe(1);
    const created = (await (a.status === 201 ? a : b).json()) as any;
    expect(created.attendanceBasis).toBe("person");
    expect(created.tags).toEqual(["good_value"]);
    expect((await eligible("centre", centreA, { client })).reason).toBe("already_reviewed");
  });

  it("a group booking: the purchaser can review only once their own attendance is confirmed, and only once", async () => {
    const client = id("c-group");
    const ref = id("exb-group");
    await db
      .prepare(`INSERT INTO experience_bookings (ref, experience_id, session_id, client_id, participant_name, email, phone, party_size, total_cents, payment_status, status) VALUES (?, ?, ?, ?, 'Lead', 'l@example.test', '', 4, 8000, 'paid', 'confirmed')`)
      .run(ref, expA, expSessionPast, client);
    await mark("experience", ref, "present");
    expect((await post({ client }, { listingType: "experience", listingId: expA })).status).toBe(403);
    // The holder asks to be confirmed even though the booking was checked in.
    const asked = await call("POST", "/attendance/corrections", { client }, { kind: "experience", ref, note: "I was the lead booker and came" });
    expect(asked.status).toBe(201);
    const { id: corrId } = (await asked.json()) as { id: number };
    expect((await call("PUT", `/attendance/corrections/${corrId}`, { user: `vendor:${vendorA}` }, { decision: "accept" })).status).toBe(200);
    // The door check-in keeps its own source.
    expect(((await db.prepare(`SELECT source FROM attendance WHERE kind = 'experience' AND ref = ?`).get(ref)) as { source: string }).source).toBe("host_manual");
    const r = await post({ client }, { listingType: "experience", listingId: expA });
    expect(r.status).toBe(201);
    expect(((await r.json()) as any).attendanceBasis).toBe("person");
    expect((await post({ client }, { listingType: "experience", listingId: expA })).status).toBe(409);
    expect((await call("POST", "/attendance/corrections", { client }, { kind: "experience", ref })).status).toBe(409);
  });

  it("Sessions: self check-in or 'I went' alone isn't enough; the host's record is; a no-show or cancellation blocks it", async () => {
    await db.prepare(`UPDATE game_participants SET attended = 1, checked_in_at = NOW() WHERE game_id = ? AND resident_id = ?`).run(gamePast, player);
    let e = await eligible("game", gamePast, { resident: player, client: id("cl-p") });
    expect(e.eligible).toBe(false);
    expect(e.reason).toBe("not_confirmed");
    await mark("game", `${gamePast}:${player}`, "present");
    e = await eligible("game", gamePast, { resident: player, client: id("cl-p") });
    expect(e.occurrences[0].basis).toBe("person");
    await db.prepare(`UPDATE game_participants SET attended = 1 WHERE game_id = ? AND resident_id = ?`).run(gamePast, player2);
    await mark("game", `${gamePast}:${player2}`, "no_show");
    expect((await eligible("game", gamePast, { resident: player2, client: id("cl-p2") })).eligible).toBe(false);
    await mark("game", `${gameCancelled}:${player}`, "present");
    expect((await eligible("game", gameCancelled, { resident: player, client: id("cl-p") })).eligible).toBe(false);
  });

  it("a host can't review their own Session or themselves; a partner's staff can't review their own listing", async () => {
    expect((await eligible("game", gamePast, { resident: host, client: id("cl-h") })).reason).toBe("own");
    expect((await post({ resident: host, client: id("cl-h") }, { listingType: "host", listingId: host })).status).toBe(403);
    await db.prepare(`UPDATE users SET resident_id = ? WHERE id = ?`).run(stranger, staffA);
    expect((await eligible("centre", centreA, { resident: stranger, client: id("cl-s") })).reason).toBe("own");
    await db.prepare(`UPDATE users SET resident_id = NULL WHERE id = ?`).run(staffA);
  });
});

describe("author edit/delete, older reviews, live rating and replies", () => {
  it("only the author edits or deletes; the summary recalculates after edit, delete and moderation", async () => {
    const client = id("c-edit");
    const ref = await booking(client);
    await confirmPerson("booking", ref, { client });
    const created = (await (await post({ client }, { listingType: "centre", listingId: centreA, rating: 2 })).json()) as any;
    const other = id("c-other");
    expect((await call("PUT", `/reviews/mine/${created.id}`, { client: other }, { rating: 5 })).status).toBe(404);
    expect((await call("DELETE", `/reviews/mine/${created.id}`, { client: other })).status).toBe(404);

    const before = (await (await call("GET", `/reviews/summary?listingType=centre&listingId=${centreA}`)).json()) as any;
    const edited = await call("PUT", `/reviews/mine/${created.id}`, { client }, { rating: 5, comment: "Better than I said", tags: ["welcoming_host"] });
    expect(edited.status).toBe(200);
    expect(((await edited.json()) as any).updatedAt).toBeTruthy();
    const after = (await (await call("GET", `/reviews/summary?listingType=centre&listingId=${centreA}`)).json()) as any;
    expect(after.distribution[4]).toBe(before.distribution[4] + 1);
    expect(after.distribution[1]).toBe(before.distribution[1] - 1);

    expect((await call("DELETE", `/reviews/${created.id}`, { user: "admin:support" }, {})).status).toBe(400);
    expect((await call("DELETE", `/reviews/${created.id}`, { user: "admin:support" }, { reason: "Personal details in text" })).status).toBe(200);
    const hidden = (await (await call("GET", `/reviews/summary?listingType=centre&listingId=${centreA}`)).json()) as any;
    expect(hidden.count).toBe(after.count - 1);
    expect(((await db.prepare(`SELECT hidden_reason as r FROM reviews WHERE id = ?`).get(created.id)) as { r: string }).r).toBe("Personal details in text");

    expect((await call("DELETE", `/reviews/mine/${created.id}`, { client })).status).toBe(200);
    expect(await db.prepare(`SELECT 1 FROM reviews WHERE id = ?`).get(created.id)).toBeUndefined();
  });

  it("a later no-show removes the label and blocks editing; deleting still works", async () => {
    const client = id("c-later");
    const ref = await booking(client);
    await confirmPerson("booking", ref, { client });
    const created = (await (await post({ client }, { listingType: "centre", listingId: centreA, rating: 4 })).json()) as any;
    await mark("booking", ref, "no_show");
    const list = (await (await call("GET", `/reviews?listingType=centre&listingId=${centreA}`, { client })).json()) as any[];
    expect(list.find((r) => r.id === created.id).attendanceBasis).toBeNull();
    expect((await call("PUT", `/reviews/mine/${created.id}`, { client }, { rating: 5 })).status).toBe(409);
    expect((await call("DELETE", `/reviews/mine/${created.id}`, { client })).status).toBe(200);
  });

  it("older reviews stay visible and counted, never gain a label, and can't be edited", async () => {
    const client = id("c-legacy");
    const legacy = await db.prepare(`INSERT INTO reviews (listing_type, listing_id, client_id, name, rating, comment) VALUES ('centre', ?, ?, 'Old', 3, 'From before')`).run(centreA, client);
    // Written under the earlier, looser rule: booking-level basis, no person confirmation.
    const looser = await db
      .prepare(`INSERT INTO reviews (listing_type, listing_id, client_id, name, rating, comment, occurrence_kind, occurrence_ref, author_key, attendance_basis) VALUES ('centre', ?, ?, 'Looser', 4, 'Group', 'booking', ?, 'booking', 'booking')`)
      .run(centreA, client, id("bkg-looser"));
    const list = (await (await call("GET", `/reviews?listingType=centre&listingId=${centreA}`, { client })).json()) as any[];
    for (const rid of [legacy.lastInsertRowid, looser.lastInsertRowid]) {
      const r = list.find((x) => x.id === Number(rid));
      expect(r).toBeTruthy();
      expect(r.attendanceBasis).toBeNull();
      expect((await call("PUT", `/reviews/mine/${rid}`, { client }, { rating: 5 })).status).toBe(409);
    }
  });

  it("a host replies to reviews of their own Sessions only; a partner replies within its organisation only", async () => {
    const pReview = (await (await post({ resident: player, client: id("cl-p") }, { listingType: "game", listingId: gamePast, rating: 5 })).json()) as any;
    expect(pReview.attendanceBasis).toBe("person");
    expect((await call("POST", `/residents/host-reviews/${pReview.id}/reply`, { resident: stranger }, { reply: "Not my Session" })).status).toBe(404);
    expect((await call("POST", `/residents/host-reviews/${pReview.id}/reply`, { resident: host }, { reply: "Thanks for coming!" })).status).toBe(200);

    const client = id("c-exp1");
    const ref = id("exb-solo");
    await db
      .prepare(`INSERT INTO experience_bookings (ref, experience_id, session_id, client_id, participant_name, email, phone, party_size, total_cents, payment_status, status) VALUES (?, ?, ?, ?, 'Solo', 's@example.test', '', 1, 2000, 'paid', 'confirmed')`)
      .run(ref, expA, expSessionPast, client);
    await confirmPerson("experience", ref, { client });
    const eReview = (await (await post({ client }, { listingType: "experience", listingId: expA, rating: 1, comment: "Late start" })).json()) as any;
    expect((await call("POST", `/vendor/reviews/${eReview.id}/reply`, { user: `vendor:${vendorB}` }, { reply: "Not ours" })).status).toBe(404);
    expect((await call("POST", `/vendor/reviews/${eReview.id}/reply`, { user: `vendor:${staffA}:staff:finance` }, { reply: "Wrong role" })).status).toBe(403);
    expect((await call("POST", `/vendor/reviews/${eReview.id}/reply`, { user: `vendor:${vendorA}` }, { reply: "Sorry — we've changed the start time." })).status).toBe(200);
    const list = (await (await call("GET", `/reviews?listingType=experience&listingId=${expA}`)).json()) as any[];
    expect(list.find((r) => r.id === eReview.id)).toMatchObject({ rating: 1, vendorReply: "Sorry — we've changed the start time." });
  });
});

describe("attendance corrections", () => {
  it("the participant asks once; another organisation can't decide; the owner accepts and the review opens", async () => {
    const client = id("c-corr");
    const ref = await booking(client);
    await mark("booking", ref, "no_show");
    expect((await call("POST", "/attendance/corrections", { client: id("c-notmine") }, { kind: "booking", ref })).status).toBe(404);
    const created = await call("POST", "/attendance/corrections", { client }, { kind: "booking", ref, note: "I was there, signed in late" });
    expect(created.status).toBe(201);
    const { id: corrId } = (await created.json()) as { id: number };
    expect((await call("POST", "/attendance/corrections", { client }, { kind: "booking", ref })).status).toBe(409);

    expect((await call("PUT", `/attendance/corrections/${corrId}`, { user: `vendor:${vendorB}` }, { decision: "accept" })).status).toBe(404);
    const owned = (await (await call("GET", "/attendance/corrections/owned", { user: `vendor:${vendorA}` })).json()) as any[];
    expect(owned.some((c) => c.id === corrId)).toBe(true);
    expect(((await (await call("GET", "/attendance/corrections/owned", { user: `vendor:${vendorB}` })).json()) as any[]).some((c) => c.id === corrId)).toBe(false);
    expect((await call("PUT", `/attendance/corrections/${corrId}`, { user: `vendor:${vendorA}` }, { decision: "accept" })).status).toBe(200);
    expect((await call("PUT", `/attendance/corrections/${corrId}`, { user: `vendor:${vendorA}` }, { decision: "decline", note: "changed my mind" })).status).toBe(409);

    const a = (await db.prepare(`SELECT status, source FROM attendance WHERE kind = 'booking' AND ref = ?`).get(ref)) as { status: string; source: string };
    expect(a).toMatchObject({ status: "present", source: "correction" });
    expect((await eligible("centre", centreA, { client })).eligible).toBe(true);
    const mine = (await (await call("GET", "/attendance/corrections/mine", { client })).json()) as any[];
    expect(mine[0]).toMatchObject({ id: corrId, status: "accepted" });
    const places = (await (await call("GET", `/attendance/places/booking/${ref}`, { client })).json()) as any;
    expect(places.items[0]).toMatchObject({ confirmed: true, canRequest: false, recorded: "present" });
    expect(((await (await call("GET", `/attendance/places/booking/${ref}`, { client: id("c-nosy") })).json()) as any).items).toEqual([]);
  });

  it("a declined request needs a reason; support needs permission to overturn it, and it's audited", async () => {
    const client = id("c-corr2");
    const ref = await booking(client);
    const { id: corrId } = (await (await call("POST", "/attendance/corrections", { client }, { kind: "booking", ref })).json()) as { id: number };
    expect((await call("PUT", `/attendance/corrections/${corrId}`, { user: `vendor:${vendorA}` }, { decision: "decline" })).status).toBe(400);
    expect((await call("PUT", `/attendance/corrections/${corrId}`, { user: `vendor:${vendorA}` }, { decision: "decline", note: "Not on our register" })).status).toBe(200);
    expect(((await (await call("GET", `/attendance/places/booking/${ref}`, { client })).json()) as any).items[0]).toMatchObject({ confirmed: false, canRequest: true, request: { status: "declined", decisionNote: "Not on our register" } });
    expect((await call("PUT", `/admin/attendance/corrections/${corrId}`, { user: "admin:finance" }, { decision: "accept", note: "x".repeat(25) })).status).toBe(403);
    expect((await call("PUT", `/admin/attendance/corrections/${corrId}`, { user: "admin:support" }, { decision: "accept", note: "short" })).status).toBe(200);
    const audit = await db.prepare(`SELECT 1 FROM audit_log WHERE object_type = 'attendance_correction' AND object_id = ? AND action = 'attendance_correction.accepted'`).get(String(corrId));
    expect(audit).toBeTruthy();
    expect((await eligible("centre", centreA, { client })).eligible).toBe(true);
  });

  it("programme sessions: the holder asks per session; acceptance opens a programme review", async () => {
    const prog = id("prog");
    const sessPast = id("psPast");
    const sessFuture = id("psFuture");
    await db.prepare(`INSERT INTO programs (id, listing_type, listing_id, vendor_id, title, description, status) VALUES (?, 'centre', ?, ?, 'TR Course', '', 'published')`).run(prog, centreA, vendorA);
    await db.prepare(`INSERT INTO program_sessions (id, program_id, date, time, status) VALUES (?, ?, '2020-03-01', '10:00', 'scheduled'), (?, ?, '2099-03-01', '10:00', 'scheduled')`).run(sessPast, prog, sessFuture, prog);
    const client = id("c-prog");
    const peRef = id("pe");
    const pe = await db
      .prepare(`INSERT INTO program_enrollments (ref, program_id, client_id, participant_name, email, payment_status, status) VALUES (?, ?, ?, 'Me', 'me@example.test', 'paid', 'confirmed')`)
      .run(peRef, prog, client);
    const places = (await (await call("GET", `/attendance/places/program/${peRef}`, { client })).json()) as any;
    expect(places.items).toHaveLength(1); // the future session isn't offered
    expect(places.items[0]).toMatchObject({ correctionKind: "program_session", requestRef: `${sessPast}:${pe.lastInsertRowid}`, confirmed: false, canRequest: true });
    expect((await call("POST", "/attendance/corrections", { client }, { kind: "program_session", ref: `${sessFuture}:${pe.lastInsertRowid}` })).status).toBe(404);
    const asked = (await (await call("POST", "/attendance/corrections", { client }, { kind: "program_session", ref: places.items[0].requestRef })).json()) as { id: number };
    expect((await eligible("program", prog, { client })).reason).toBe("not_confirmed");
    expect((await call("PUT", `/attendance/corrections/${asked.id}`, { user: `vendor:${staffA}:staff:finance` }, { decision: "accept" })).status).toBe(403); // same organisation, role can't record attendance
    expect((await call("PUT", `/attendance/corrections/${asked.id}`, { user: `vendor:${vendorA}` }, { decision: "accept" })).status).toBe(200);
    const r = await post({ client }, { listingType: "program", listingId: prog });
    expect(r.status).toBe(201);
    expect(((await r.json()) as any).attendanceBasis).toBe("person");
  });

  it("only the host records Session attendance", async () => {
    expect((await call("POST", `/attendance/games/${gamePast}/participants/${player2}`, { resident: stranger }, { status: "present" })).status).toBe(403);
    expect((await call("POST", `/attendance/games/${gamePast}/participants/${player2}`, { resident: host }, { status: "present" })).status).toBe(200);
    expect((await eligible("game", gamePast, { resident: player2, client: id("cl-p2") })).occurrences[0].basis).toBe("person");
  });
});

describe("verification checks", () => {
  it("a partner asks, admin approves with a note, the label shows; revoking removes it; the evidence note stays restricted", async () => {
    expect((await call("POST", "/vendor/verification", { user: `vendor:${staffA}:staff:finance` }, { checkType: "business_details", details: "Org A Ltd, CRO 123456, 1 Main St" })).status).toBe(403);
    const req = await call("POST", "/vendor/verification", { user: `vendor:${vendorA}` }, { checkType: "business_details", details: "Org A Ltd, CRO 123456, 1 Main St" });
    expect(req.status).toBe(201);
    const { id: checkId } = (await req.json()) as { id: number };
    expect((await call("POST", "/vendor/verification", { user: `vendor:${vendorA}` }, { checkType: "business_details", details: "Org A Ltd, CRO 123456, 1 Main St" })).status).toBe(409);
    expect(await vendorLabels(vendorA)).toEqual([]);

    const caseRes = (await (await call("GET", `/admin/verification/${checkId}`, { user: "admin:super" })).json()) as any;
    const v = caseRes.check.rowVersion;
    expect((await call("PUT", `/admin/verification/${checkId}/approve`, { user: "admin:super" }, { rowVersion: v, evidenceNote: "short" })).status).toBe(400);
    expect((await call("PUT", `/admin/verification/${checkId}/approve`, { user: "admin:super" }, { rowVersion: v + 7, evidenceNote: "Checked CRO record 123456 matches name and address" })).status).toBe(409);
    expect((await call("PUT", `/admin/verification/${checkId}/approve`, { user: "admin:finance" }, { rowVersion: v, evidenceNote: "Checked CRO record 123456 matches name and address" })).status).toBe(403);
    expect((await call("PUT", `/admin/verification/${checkId}/approve`, { user: "admin:super" }, { rowVersion: v, evidenceNote: "Checked CRO record 123456 matches name and address" })).status).toBe(200);

    // Labels apply to the whole organisation, including staff-owned listings.
    expect((await vendorLabels(staffA)).map((l) => l.key)).toEqual(["business_details_checked"]);
    const profile = (await (await call("GET", `/providers/${vendorA}`)).json()) as any;
    expect(profile.verified).toBe(true);
    expect(profile.checks[0].meaning).toMatch(/doesn't cover individual staff/);

    const partner = (await (await call("GET", "/vendor/verification", { user: `vendor:${vendorA}` })).json()) as any;
    expect(partner.checks[0].evidenceNote).toBeUndefined();
    expect(((await (await call("GET", `/admin/verification/${checkId}`, { user: "admin:finance" })).json()) as any).error).toBeTruthy(); // finance can't open the queue
    const legal = (await (await call("GET", `/admin/verification/${checkId}`, { user: "admin:legal" })).json()) as any;
    expect(legal.check.evidenceNote).toMatch(/CRO record/);

    const v2 = legal.check.rowVersion;
    expect((await call("PUT", `/admin/verification/${checkId}/revoke`, { user: "admin:super" }, { rowVersion: v2 })).status).toBe(400);
    expect(
      (await call("PUT", `/admin/verification/${checkId}/revoke`, { user: "admin:super" }, { rowVersion: v2, reasonCategory: "no_longer_accurate", explanation: "The company has been dissolved on the register." })).status
    ).toBe(200);
    expect(await vendorLabels(vendorA)).toEqual([]);
    expect(((await (await call("GET", `/providers/${vendorA}`)).json()) as any).verified).toBe(false);
  });

  it("an expired check stops showing; identity checks can't be approved; email confirmation is never an identity label", async () => {
    await db
      .prepare(`INSERT INTO verification_checks (subject_type, subject_id, check_type, status, decided_at, expires_at) VALUES ('vendor', ?, 'business_details', 'approved', NOW(), DATE_SUB(NOW(), INTERVAL 1 DAY))`)
      .run(vendorB);
    expect(await vendorLabels(vendorB)).toEqual([]);
    const opened = await call("POST", "/admin/verification", { user: "admin:super" }, { subjectId: host, checkType: "identity" });
    expect(opened.status).toBe(409);
    expect(((await opened.json()) as any).unavailable).toBe(true);
    // Even a row written directly can't produce an identity label.
    await db.prepare(`INSERT INTO verification_checks (subject_type, subject_id, check_type, status, decided_at) VALUES ('resident', ?, 'identity', 'approved', NOW())`).run(host);
    const keys = (await residentLabels(host)).map((l) => l.key);
    expect(keys).toEqual(["email_confirmed"]);
  });
});

describe("host profiles and private content", () => {
  it("a host without approval but with public hosting has a profile, with no private Sessions or invite-only Circles", async () => {
    const res = await call("GET", `/residents/${host}/host-profile`);
    expect(res.status).toBe(200);
    const p = (await res.json()) as any;
    expect(p.checks.map((c: any) => c.key)).toEqual(["email_confirmed"]);
    expect(p.upcomingGames.some((g: any) => g.id === privateGame)).toBe(false);
    expect(p.circles.some((c: any) => c.id === inviteCircle)).toBe(false);
    expect(p.activitiesOffered).toContain("TR Kickabout");
    expect(p.activitiesOffered).not.toContain("TR Secret");
    expect(p.areas).toEqual(["Rathmines, Dublin"]);
    expect(p.hostingSince).toBe("2020-06-01");
    expect(p.reviewSummary.count).toBeGreaterThanOrEqual(0);
  });

  it("someone who has never hosted in public has no profile", async () => {
    expect((await call("GET", `/residents/${quietResident}/host-profile`)).status).toBe(404);
  });
});

describe("reports", () => {
  it("a safety report gets a case reference, shows in the reporter's history and can be appealed once decided", async () => {
    const client = id("c-report");
    const r = await call("POST", "/reports", { client }, { targetType: "host", targetId: host, reason: "Unsafe", category: "safety" });
    expect(r.status).toBe(201);
    const body = (await r.json()) as any;
    expect(body.caseRef).toMatch(/^R-\d{6}$/);
    expect(body.category).toBe("safety");
    let mine = (await (await call("GET", "/reports/mine", { client })).json()) as any[];
    expect(mine[0]).toMatchObject({ caseRef: body.caseRef, category: "safety", canAppeal: false });
    await db.prepare(`UPDATE reports SET status = 'dismissed', decided_at = NOW() WHERE id = ?`).run(body.id);
    mine = (await (await call("GET", "/reports/mine", { client })).json()) as any[];
    expect(mine[0].canAppeal).toBe(true);
    // Another device sees nothing.
    expect(((await (await call("GET", "/reports/mine", { client: id("c-else") })).json()) as any[]).length).toBe(0);
  });
});
