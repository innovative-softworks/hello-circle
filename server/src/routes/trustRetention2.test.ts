import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, initSchema } from "../db/index.js";
import { attendanceRouter } from "./attendanceCorrections.js";
import { reviewsRouter } from "./reviews.js";
import { vendorOperationsRouter } from "./vendorOperations.js";
import { complaintsRouter } from "./complaints.js";

// Trust & Retention batch 1 follow-up 2 (docs/trust-retention/05-*):
// atomic duplicate protection with and without uq_review_occurrence,
// attendance revocation/dispute/restoration, and organisers confirming named
// attendees directly. Identity is stubbed per request (x-test-* headers).

const u = crypto.randomUUID().slice(0, 8);
const id = (p: string) => `test-t2-${p}-${u}`;
const vendorA = id("vendorA");
const staffA = id("staffA");
const vendorB = id("vendorB");
const orgA = id("orgA");
const centreA = id("centreA");
const expA = id("expA");
const expSess = id("expSess");
const host = id("host");
const player = id("player");
const gamePast = id("gamePast");

let server: Server;
let base = "";
type Who = { client?: string; resident?: string; user?: string };
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
      const [, a, b, c] = t.split(":");
      const row = (await db.prepare(`SELECT org_id as orgId FROM users WHERE id = ?`).get(a)) as { orgId: string | null } | undefined;
      (req as any).user = { id: a, role: "vendor", status: "approved", orgId: row?.orgId ?? null, invitedStaff: b === "staff", platformRole: b === "staff" ? c : null };
      (req as any).vendorIds = ((await db.prepare(`SELECT id FROM users WHERE org_id = ? OR id = ?`).all(row?.orgId ?? "", a)) as { id: string }[]).map((x) => x.id);
    }
    next();
  });
  app.use("/reviews", reviewsRouter);
  app.use("/attendance", attendanceRouter);
  app.use("/vendor", vendorOperationsRouter);
  app.use("/complaints", complaintsRouter);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const a = server.address();
  if (!a || typeof a === "string") throw new Error("bind");
  base = `http://127.0.0.1:${a.port}`;

  await db.prepare(`INSERT INTO organisations (id, name, kind, status) VALUES (?, 'T2 Org', 'vendor', 'active')`).run(orgA);
  const v = `INSERT INTO users (id, email, password_hash, role, status, name, org_id, invited_staff, platform_role) VALUES (?, ?, 'x', 'vendor', 'approved', 'V', ?, ?, ?)`;
  await db.prepare(v).run(vendorA, `${vendorA}@example.test`, orgA, 0, null);
  await db.prepare(v).run(staffA, `${staffA}@example.test`, orgA, 1, "finance");
  await db.prepare(v).run(vendorB, `${vendorB}@example.test`, null, 0, null);
  await db
    .prepare(`INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, image_url, blurb, vendor_id, status) VALUES (?, 'T2 Hall', 'A', 'Dublin', 0, 0, 20, 1000, 'M', '', '', '', ?, 'approved')`)
    .run(centreA, vendorA);
  await db
    .prepare(
      `INSERT INTO experiences (id, vendor_id, title, area, county, blurb, description, fitness_requirements, itinerary, equipment_provided, equipment_required, transport_info, safety_info, weather_policy, eligibility, cancellation_terms, status)
       VALUES (?, ?, 'T2 Kayak', 'A', 'Cork', 'b', 'd', '', '', '', '', '', '', '', '', '', 'approved')`
    )
    .run(expA, vendorA);
  await db.prepare(`INSERT INTO experience_sessions (id, experience_id, date, time) VALUES (?, ?, ?, '10:00')`).run(expSess, expA, new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10));
  for (const r of [host, player]) await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'T2')`).run(r, `${r}@example.test`);
  await db.prepare(`INSERT INTO games (id, host_resident_id, activity_label, date, time, capacity, status, visibility) VALUES (?, ?, 'T2 Run', '2020-06-01', '10:00', 8, 'open', 'public')`).run(gamePast, host);
  for (const p of [host, player]) await db.prepare(`INSERT INTO game_participants (game_id, resident_id) VALUES (?, ?)`).run(gamePast, p);
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  const like = `%${u}%`;
  await db.prepare(`DELETE FROM review_claims WHERE review_id IN (SELECT id FROM reviews WHERE listing_id LIKE ? OR client_id LIKE ?)`).run(like, like);
  await db.prepare(`DELETE FROM reports WHERE target_type = 'review' AND target_id IN (SELECT CAST(id AS CHAR) FROM reviews WHERE listing_id LIKE ?)`).run(like);
  await db.prepare(`DELETE FROM reviews WHERE listing_id LIKE ? OR client_id LIKE ?`).run(like, like);
  await db.prepare(`DELETE FROM attendance WHERE ref LIKE ?`).run(like);
  await db.prepare(`DELETE FROM attendance_corrections WHERE ref LIKE ?`).run(like);
  await db.prepare(`DELETE FROM complaints WHERE email LIKE ?`).run(like);
  await db.prepare(`DELETE FROM bookings WHERE centre_id = ?`).run(centreA);
  await db.prepare(`DELETE FROM experience_bookings WHERE experience_id = ?`).run(expA);
  await db.prepare(`DELETE FROM experience_sessions WHERE experience_id = ?`).run(expA);
  await db.prepare(`DELETE FROM experiences WHERE id = ?`).run(expA);
  await db.prepare(`DELETE FROM game_participants WHERE game_id = ?`).run(gamePast);
  await db.prepare(`DELETE FROM games WHERE id = ?`).run(gamePast);
  await db.prepare(`DELETE FROM centres WHERE id = ?`).run(centreA);
  await db.prepare(`DELETE FROM residents WHERE id LIKE ?`).run(like);
  await db.prepare(`DELETE FROM users WHERE id LIKE ?`).run(like);
  await db.prepare(`DELETE FROM organisations WHERE id LIKE ?`).run(like);
});

async function booking(client: string) {
  const ref = id(`bk-${crypto.randomUUID().slice(0, 6)}`);
  await db
    .prepare(
      `INSERT INTO bookings (ref, client_id, centre_id, room_id, date, time, duration, event_type, guests, name, email, phone, notes, total_cents, status, payment_status)
       VALUES (?, ?, ?, 'r', '2020-01-01', '18:00', 1, 'Event', 12, 'Holder Name', 'h@example.test', '', '', 1000, 'confirmed', 'paid')`
    )
    .run(ref, client, centreA);
  return ref;
}
const confirm = (kind: string, ref: string, client: string) =>
  db.prepare(`INSERT INTO attendance_corrections (kind, ref, client_id, status, owner_vendor_id) VALUES (?, ?, ?, 'accepted', ?)`).run(kind, ref, client, vendorA);
const post = (who: Who, body: Record<string, unknown>) => call("POST", "/reviews", who, { name: "R", rating: 2, ...body });
const summary = async () => (await (await call("GET", `/reviews/summary?listingType=centre&listingId=${centreA}`)).json()) as { count: number; average: number | null };
const list = async (who: Who = {}) => (await (await call("GET", `/reviews?listingType=centre&listingId=${centreA}`, who)).json()) as any[];

describe("duplicate review protection", () => {
  it("with the unique index: five simultaneous submits by one attendee make exactly one review", async () => {
    const client = id("c-race1");
    await confirm("booking", await booking(client), client);
    const codes = (await Promise.all(Array.from({ length: 5 }, () => post({ client }, { listingType: "centre", listingId: centreA })))).map((r) => r.status).sort();
    expect(codes).toEqual([201, 409, 409, 409, 409]);
  });

  it("without the unique index (legacy conflicts): still exactly one, and independent attendees both succeed", async () => {
    await db.exec(`ALTER TABLE reviews DROP INDEX uq_review_occurrence`);
    try {
      const client = id("c-race2");
      const ref = await booking(client);
      await confirm("booking", ref, client);
      const codes = (await Promise.all(Array.from({ length: 5 }, () => post({ client }, { listingType: "centre", listingId: centreA })))).map((r) => r.status).sort();
      expect(codes).toEqual([201, 409, 409, 409, 409]);
      expect(Number(((await db.prepare(`SELECT COUNT(*) as n FROM reviews WHERE occurrence_ref = ?`).get(ref)) as { n: number }).n)).toBe(1);
      const [c1, c2] = [id("c-ind1"), id("c-ind2")];
      await confirm("booking", await booking(c1), c1);
      await confirm("booking", await booking(c2), c2);
      const both = await Promise.all([post({ client: c1 }, { listingType: "centre", listingId: centreA }), post({ client: c2 }, { listingType: "centre", listingId: centreA })]);
      expect(both.map((r) => r.status)).toEqual([201, 201]);
    } finally {
      await db.exec(`ALTER TABLE reviews ADD UNIQUE INDEX uq_review_occurrence (listing_type, occurrence_kind, occurrence_ref, author_key)`);
    }
  });

  it("delete releases the visit, so the author can review it again; edit keeps one review", async () => {
    const client = id("c-resub");
    await confirm("booking", await booking(client), client);
    const first = (await (await post({ client }, { listingType: "centre", listingId: centreA })).json()) as { id: number };
    expect((await call("PUT", `/reviews/mine/${first.id}`, { client }, { rating: 5 })).status).toBe(200);
    expect((await post({ client }, { listingType: "centre", listingId: centreA })).status).toBe(409);
    expect((await call("DELETE", `/reviews/mine/${first.id}`, { client })).status).toBe(200);
    expect((await post({ client }, { listingType: "centre", listingId: centreA })).status).toBe(201);
  });

  it("repeated schema initialisation keeps historical duplicates and claims", async () => {
    const legacyClient = id("c-legacy");
    for (let i = 0; i < 3; i++) await db.prepare(`INSERT INTO reviews (listing_type, listing_id, client_id, name, rating, comment) VALUES ('centre', ?, ?, 'Old', 3, '')`).run(centreA, legacyClient);
    const claims = Number(((await db.prepare(`SELECT COUNT(*) as n FROM review_claims`).get()) as { n: number }).n);
    await initSchema();
    await initSchema();
    expect(Number(((await db.prepare(`SELECT COUNT(*) as n FROM reviews WHERE client_id = ?`).get(legacyClient)) as { n: number }).n)).toBe(3);
    expect(Number(((await db.prepare(`SELECT COUNT(*) as n FROM review_claims`).get()) as { n: number }).n)).toBe(claims);
  });
});

describe("attendance revocation, dispute and restoration", () => {
  it("a later no-show removes the label but keeps the review and its score, and flags it once for moderation", async () => {
    const client = id("c-revoke");
    const ref = await booking(client);
    await confirm("booking", ref, client);
    const rv = (await (await post({ client }, { listingType: "centre", listingId: centreA, rating: 1, comment: "Cold hall" })).json()) as { id: number };
    const before = await summary();
    expect((await call("POST", `/vendor/checkin/booking/${ref}`, { user: `vendor:${vendorA}` }, { status: "no_show" })).status).toBe(200);
    expect((await call("POST", `/vendor/checkin/booking/${ref}`, { user: `vendor:${vendorA}` }, { status: "no_show" })).status).toBe(200);
    const r = (await list()).find((x) => x.id === rv.id);
    expect(r).toMatchObject({ rating: 1, attendanceBasis: null });
    expect(await summary()).toEqual(before);
    const reports = (await db.prepare(`SELECT reason FROM reports WHERE target_type = 'review' AND target_id = ? AND status = 'pending'`).all(String(rv.id))) as { reason: string }[];
    expect(reports).toHaveLength(1);
    expect(reports[0].reason).toMatch(/don't hide it just because it's critical/);
    // Restored: the door record is put back to present → the label returns.
    await call("POST", `/vendor/checkin/booking/${ref}`, { user: `vendor:${vendorA}` }, { status: "present" });
    expect((await list()).find((x) => x.id === rv.id).attendanceBasis).toBe("person");
  });

  it("Sessions: a host no-show then the attendee's dispute keep the label off until the dispute is accepted", async () => {
    await db.prepare(`INSERT INTO attendance (kind, ref, status, source) VALUES ('game', ?, 'present', 'host_manual')`).run(`${gamePast}:${player}`);
    const rv = (await (await post({ resident: player, client: id("cl-p") }, { listingType: "game", listingId: gamePast, rating: 2 })).json()) as { id: number; attendanceBasis: string };
    expect(rv.attendanceBasis).toBe("person");
    const label = async () => ((await (await call("GET", `/reviews?listingType=game&listingId=${gamePast}`)).json()) as any[]).find((x) => x.id === rv.id).attendanceBasis;
    expect((await call("POST", `/attendance/games/${gamePast}/participants/${player}`, { resident: host }, { status: "no_show" })).status).toBe(200);
    expect(await label()).toBeNull();
    const asked = (await (await call("POST", "/attendance/corrections", { resident: player, client: id("cl-p") }, { kind: "game", ref: gamePast, note: "I was there" })).json()) as { id: number };
    expect(await label()).toBeNull();
    expect((await call("PUT", `/attendance/corrections/${asked.id}?as=host`, { resident: host }, { decision: "accept" })).status).toBe(200);
    expect(await label()).toBe("person");
  });

  it("support hiding a review recounts the score, and the author can quote the case reference to appeal", async () => {
    const client = id("c-hide");
    await confirm("booking", await booking(client), client);
    const rv = (await (await post({ client }, { listingType: "centre", listingId: centreA, rating: 1 })).json()) as { id: number };
    const before = await summary();
    await db.prepare(`UPDATE reviews SET hidden = 1, hidden_reason = 'Ineligible: not at the event' WHERE id = ?`).run(rv.id);
    const after = await summary();
    expect(after.count).toBe(before.count - 1);
    const rep = await db.prepare(`INSERT INTO reports (target_type, target_id, reporter_client_id, reason, status, decided_at) VALUES ('review', ?, 'system:attendance', 'x', 'actioned', NOW())`).run(String(rv.id));
    const ref = `R-${String(rep.lastInsertRowid).padStart(6, "0")}`;
    const ap = await call("POST", "/complaints", { client: id("c-appeal") }, { kind: "appeal", subjectType: "moderation_decision", subjectRef: ref, email: `${id("appeal")}@example.test`, body: "I was there; the organiser marked the wrong person." });
    expect(ap.status).toBe(201);
    const row = (await db.prepare(`SELECT report_id as reportId FROM complaints WHERE id = ?`).get(((await ap.json()) as { id: number }).id)) as { reportId: number };
    expect(row.reportId).toBe(Number(rep.lastInsertRowid));
  });
});

describe("organisers confirm named attendees", () => {
  it("lists past attendees, confirms only the holder of a group booking, and the holder can then review with no request", async () => {
    const client = id("c-group");
    const ref = id("exb");
    await db
      .prepare(`INSERT INTO experience_bookings (ref, experience_id, session_id, client_id, participant_name, email, phone, party_size, total_cents, payment_status, status) VALUES (?, ?, ?, ?, 'Lead Person', 'l@example.test', '', 4, 8000, 'paid', 'confirmed')`)
      .run(ref, expA, expSess, client);
    await db.prepare(`INSERT INTO attendance (kind, ref, status, source) VALUES ('experience', ?, 'present', 'qr')`).run(ref);
    const rows = (await (await call("GET", "/attendance/to-confirm", { user: `vendor:${vendorA}` })).json()) as any[];
    const row = rows.find((r) => r.ref === ref);
    expect(row).toMatchObject({ kind: "experience", holderName: "Lead Person", partySize: 4, doorStatus: "present", confirmationId: null, reviewSubmitted: false });
    // The door check-in is not a confirmation.
    expect((await post({ client }, { listingType: "experience", listingId: expA })).status).toBe(403);
    // Other organisations and roles can't.
    expect(((await (await call("GET", "/attendance/to-confirm", { user: `vendor:${vendorB}` })).json()) as any[]).some((r) => r.ref === ref)).toBe(false);
    expect((await call("POST", "/attendance/confirm", { user: `vendor:${vendorB}` }, { kind: "experience", ref })).status).toBe(404);
    expect((await call("POST", "/attendance/confirm", { user: `vendor:${staffA}:staff:finance` }, { kind: "experience", ref })).status).toBe(403);
    const ok = await call("POST", "/attendance/confirm", { user: `vendor:${vendorA}` }, { kind: "experience", ref });
    expect(ok.status).toBe(201);
    const { id: confId } = (await ok.json()) as { id: number };
    expect((await call("POST", "/attendance/confirm", { user: `vendor:${vendorA}` }, { kind: "experience", ref })).status).toBe(409);
    // The door record keeps its own source; one confirmation row, for the holder only.
    expect(((await db.prepare(`SELECT source FROM attendance WHERE kind = 'experience' AND ref = ?`).get(ref)) as { source: string }).source).toBe("qr");
    expect(Number(((await db.prepare(`SELECT COUNT(*) as n FROM attendance_corrections WHERE ref = ? AND status = 'accepted'`).get(ref)) as { n: number }).n)).toBe(1);
    const rv = await post({ client }, { listingType: "experience", listingId: expA, rating: 4 });
    expect(rv.status).toBe(201);
    const rvId = ((await rv.json()) as { id: number }).id;
    const after = ((await (await call("GET", "/attendance/to-confirm", { user: `vendor:${vendorA}` })).json()) as any[]).find((r) => r.ref === ref);
    expect(after).toMatchObject({ confirmationId: confId, confirmedBy: "organiser", reviewSubmitted: true });

    // A mistake is withdrawn with a reason; the review is flagged, not hidden, and loses its label.
    expect((await call("POST", `/attendance/confirm/${confId}/withdraw`, { user: `vendor:${vendorA}` }, { note: "short" })).status).toBe(400);
    expect((await call("POST", `/attendance/confirm/${confId}/withdraw`, { user: `vendor:${vendorB}` }, { note: "Wrong person entirely" })).status).toBe(404);
    expect((await call("POST", `/attendance/confirm/${confId}/withdraw`, { user: `vendor:${vendorA}` }, { note: "I confirmed the wrong booking" })).status).toBe(200);
    const pub = ((await (await call("GET", `/reviews?listingType=experience&listingId=${expA}`)).json()) as any[]).find((x) => x.id === rvId);
    expect(pub).toMatchObject({ rating: 4, attendanceBasis: null });
    expect(await db.prepare(`SELECT 1 FROM reports WHERE target_type = 'review' AND target_id = ? AND status = 'pending'`).get(String(pub.id))).toBeTruthy();
    const audit = (await db.prepare(`SELECT action FROM audit_log WHERE object_type = 'attendance_correction' AND object_id = ? ORDER BY id`).all(String(confId))) as { action: string }[];
    expect(audit.map((a) => a.action)).toEqual(["attendance.organiser_confirmed", "attendance.confirmation_withdrawn"]);
    // The holder can ask again afterwards (fallback route).
    const places = (await (await call("GET", `/attendance/places/experience/${ref}`, { client })).json()) as any;
    expect(places.items[0]).toMatchObject({ confirmed: false, canRequest: true, request: { status: "withdrawn" } });
  });

  it("an open participant request is accepted by the organiser's confirmation rather than duplicated", async () => {
    const client = id("c-open");
    const ref = await booking(client);
    const asked = (await (await call("POST", "/attendance/corrections", { client }, { kind: "booking", ref })).json()) as { id: number };
    const ok = (await (await call("POST", "/attendance/confirm", { user: `vendor:${vendorA}` }, { kind: "booking", ref })).json()) as { id: number };
    expect(ok.id).toBe(asked.id);
    expect((await (await call("GET", `/reviews/eligible?listingType=centre&listingId=${centreA}`, { client })).json() as any).eligible).toBe(true);
  });
});
