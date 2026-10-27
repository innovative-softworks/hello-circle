import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { circleExperienceRouter } from "./circleExperience.js";
import { circlesRouter } from "./circles.js";
import { gamesRouter } from "./games.js";
import { applyReportAction, resolveReportTarget } from "../reportModeration.js";

// Circles 3.0 — a Circle plan can point at a real listing (circlePlanListings.ts).
// Covers each listing type, visibility (private activity, unpublished and
// suspended supply), duplicates (including two at once), live state
// (cancelled, booked), the plan→activity guard, share-as-plan and reports.

let server: Server;
let baseUrl: string;
const u = () => crypto.randomUUID();
const organiserId = `t3-org-${u()}`;
const memberId = `t3-mem-${u()}`;
const outsiderId = `t3-out-${u()}`;
const circleId = `t3-circle-${u()}`;
const otherCircleId = `t3-circle2-${u()}`;
const vendorId = `t3-vendor-${u()}`;
const suspendedVendorId = `t3-vendor-s-${u()}`;
const suspendedOrgId = `t3-org-s-${u()}`;
const centreId = `t3-centre-${u()}`;
const expId = `t3-exp-${u()}`;
const sessionId = `t3-sess-${u()}`;
const suspendedExpId = `t3-exp-s-${u()}`;
const pendingExpId = `t3-exp-p-${u()}`;
const programId = `t3-prog-${u()}`;
const progSessionId = `t3-psess-${u()}`;
const publicGameId = `t3-game-${u()}`;
const privateGameId = `t3-game-p-${u()}`;

const as = (resident: string) => ({ "Content-Type": "application/json", "X-Test-Resident-Id": resident });
const post = (path: string, resident: string, body: unknown) => fetch(`${baseUrl}${path}`, { method: "POST", headers: as(resident), body: JSON.stringify(body) });

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const residentId = req.header("X-Test-Resident-Id");
    if (residentId) (req as any).resident = { id: residentId, name: `Resident ${residentId.slice(-4)}` };
    next();
  });
  app.use("/circles", circlesRouter);
  app.use("/circles", circleExperienceRouter);
  app.use("/games", gamesRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}`;

  for (const id of [organiserId, memberId, outsiderId]) await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'T3 Person')`).run(id, `${id}@example.test`);
  await db.prepare(`INSERT INTO circles (id, name, activity_label, area, county, about, created_by_resident_id) VALUES (?, 'T3 Circle', 'Hiking', 'Area', 'Dublin', '', ?)`).run(circleId, organiserId);
  await db.prepare(`INSERT INTO circles (id, name, activity_label, area, county, about, created_by_resident_id) VALUES (?, 'T3 Other', 'Hiking', 'Area', 'Dublin', '', ?)`).run(otherCircleId, organiserId);
  await db.prepare(`INSERT INTO circle_members (circle_id, resident_id, role) VALUES (?, ?, 'organiser')`).run(circleId, organiserId);
  await db.prepare(`INSERT INTO circle_members (circle_id, resident_id, role) VALUES (?, ?, 'member')`).run(circleId, memberId);
  await db.prepare(`INSERT INTO circle_members (circle_id, resident_id, role) VALUES (?, ?, 'organiser')`).run(otherCircleId, organiserId);

  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name) VALUES (?, ?, 'x', 'vendor', 'approved', 'T3 Vendor')`).run(vendorId, `${vendorId}@example.test`);
  await db.prepare(`INSERT INTO organisations (id, name, kind, status) VALUES (?, 'T3 Suspended Org', 'vendor', 'suspended')`).run(suspendedOrgId);
  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name, org_id) VALUES (?, ?, 'x', 'vendor', 'approved', 'T3 Suspended', ?)`).run(suspendedVendorId, `${suspendedVendorId}@example.test`, suspendedOrgId);
  await db
    .prepare(`INSERT INTO centres (id, name, area, county, rating, reviews, capacity, from_price, managed_by, ph, image_url, blurb, vendor_id, status) VALUES (?, 'T3 Hall', 'Area', 'Dublin', 0, 0, 20, 1000, 'M', '', '', '', ?, 'approved')`)
    .run(centreId, vendorId);
  const expSql = `INSERT INTO experiences (id, vendor_id, kind, title, blurb, description, fitness_requirements, itinerary, equipment_provided, equipment_required, transport_info, safety_info, weather_policy, eligibility, cancellation_terms, status, price_cents, capacity)
                  VALUES (?, ?, ?, ?, 'b', 'd', '', '', '', '', '', '', '', '', '', ?, 2500, 2)`;
  await db.prepare(expSql).run(expId, vendorId, "adventure", "T3 Glendalough Hike", "approved");
  await db.prepare(expSql).run(suspendedExpId, suspendedVendorId, "experience", "T3 Suspended Workshop", "approved");
  await db.prepare(expSql).run(pendingExpId, vendorId, "experience", "T3 Pending Workshop", "pending");
  await db.prepare(`INSERT INTO experience_sessions (id, experience_id, date, time) VALUES (?, ?, '2099-07-01', '10:00')`).run(sessionId, expId);
  await db.prepare(`INSERT INTO programs (id, listing_type, listing_id, vendor_id, title, description, status, price_cents) VALUES (?, 'centre', ?, ?, 'T3 Pottery', '', 'published', 6000)`).run(programId, centreId, vendorId);
  await db.prepare(`INSERT INTO program_sessions (id, program_id, date, time, status) VALUES (?, ?, '2099-08-01', '19:00', 'scheduled')`).run(progSessionId, programId);
  await db.prepare(`INSERT INTO games (id, host_resident_id, activity_label, date, time, capacity, status, visibility) VALUES (?, ?, 'T3 Pickleball', '2099-06-01', '10:00', 4, 'open', 'public')`).run(publicGameId, outsiderId);
  await db
    .prepare(`INSERT INTO games (id, host_resident_id, activity_label, date, time, capacity, status, visibility, circle_id) VALUES (?, ?, 'T3 Private Walk', '2099-06-02', '10:00', 4, 'open', 'circle', ?)`)
    .run(privateGameId, organiserId, otherCircleId);
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const c of [circleId, otherCircleId]) {
    await db.prepare(`DELETE FROM circle_plan_interest WHERE plan_id IN (SELECT id FROM circle_plans WHERE circle_id = ?)`).run(c);
    await db.prepare(`DELETE FROM circle_plans WHERE circle_id = ?`).run(c);
    await db.prepare(`DELETE FROM circle_members WHERE circle_id = ?`).run(c);
    await db.prepare(`DELETE FROM notifications WHERE listing_id = ?`).run(c);
    await db.prepare(`DELETE FROM circles WHERE id = ?`).run(c);
  }
  await db.prepare(`DELETE FROM experience_bookings WHERE experience_id = ?`).run(expId);
  await db.prepare(`DELETE FROM experience_sessions WHERE experience_id = ?`).run(expId);
  await db.prepare(`DELETE FROM experiences WHERE id IN (?, ?, ?)`).run(expId, suspendedExpId, pendingExpId);
  await db.prepare(`DELETE FROM program_sessions WHERE program_id = ?`).run(programId);
  await db.prepare(`DELETE FROM programs WHERE id = ?`).run(programId);
  await db.prepare(`DELETE FROM games WHERE id IN (?, ?)`).run(publicGameId, privateGameId);
  await db.prepare(`DELETE FROM centres WHERE id = ?`).run(centreId);
  await db.prepare(`DELETE FROM users WHERE id IN (?, ?)`).run(vendorId, suspendedVendorId);
  await db.prepare(`DELETE FROM organisations WHERE id = ?`).run(suspendedOrgId);
  await db.prepare(`DELETE FROM residents WHERE id IN (?, ?, ?)`).run(organiserId, memberId, outsiderId);
});

describe("suggesting a listing", () => {
  it("an adventure departure becomes a plan that references it, with the departure's date", async () => {
    const r = await post(`/circles/${circleId}/plan-ideas`, memberId, { title: "", listing: { type: "experience", id: expId, sessionId } });
    expect(r.status).toBe(201);
    const plan = await r.json();
    expect(plan.title).toBe("T3 Glendalough Hike");
    expect(plan.proposedDate).toBe("2099-07-01");
    expect(plan.listing).toMatchObject({ type: "experience", kind: "adventure", id: expId, sessionId, availability: "available", spotsLeft: 2, myState: null, href: expect.stringContaining("/adventures/") });
    const row = (await db.prepare(`SELECT listing_type as t, listing_id as id, listing_session_id as s FROM circle_plans WHERE id = ?`).get(plan.id)) as { t: string; id: string; s: string };
    expect(row).toEqual({ t: "experience", id: expId, s: sessionId });
  });

  it("the same listing and date can't be suggested twice; the existing plan is returned", async () => {
    const r = await post(`/circles/${circleId}/plan-ideas`, organiserId, { listing: { type: "experience", id: expId, sessionId } });
    expect(r.status).toBe(409);
    const body = await r.json();
    expect(typeof body.planId).toBe("string");
  });

  it("two members suggesting the same programme at once make one plan", async () => {
    const [a, b] = await Promise.all([
      post(`/circles/${circleId}/plan-ideas`, memberId, { listing: { type: "program", id: programId } }),
      post(`/circles/${circleId}/plan-ideas`, organiserId, { listing: { type: "program", id: programId } }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const { n } = (await db.prepare(`SELECT COUNT(*) as n FROM circle_plans WHERE circle_id = ? AND listing_type = 'program' AND listing_id = ?`).get(circleId, programId)) as { n: number };
    expect(Number(n)).toBe(1);
  });

  it("a programme session plan keeps enrolment programme-level", async () => {
    const r = await post(`/circles/${circleId}/plan-ideas`, memberId, { listing: { type: "program", id: programId, sessionId: progSessionId } });
    expect(r.status).toBe(201);
    const plan = await r.json();
    expect(plan.listing).toMatchObject({ kind: "programme", sessionId: progSessionId, date: "2099-08-01" });
    expect(plan.listing.bookingNote).toMatch(/whole programme/);
  });

  it("a public activity and a venue can be suggested; the venue never claims a booking", async () => {
    const g = await post(`/circles/${circleId}/plan-ideas`, memberId, { listing: { type: "game", id: publicGameId } });
    expect(g.status).toBe(201);
    expect((await g.json()).listing).toMatchObject({ kind: "activity", availability: "available", spotsLeft: 4 });
    const v = await post(`/circles/${circleId}/plan-ideas`, memberId, { title: "Meet at the hall", listing: { type: "centre", id: centreId } });
    expect(v.status).toBe(201);
    const venue = (await v.json()).listing;
    expect(venue).toMatchObject({ kind: "venue", priceCents: null, spotsLeft: null });
    expect(venue.bookingNote).toMatch(/doesn't book a room/);
    // Venue pages are gated in this environment: no link to a coming-soon page.
    expect(venue.href).toBeNull();
  });
});

describe("visibility", () => {
  it("another Circle's private activity can't be suggested, and nothing about it leaks", async () => {
    const r = await post(`/circles/${circleId}/plan-ideas`, memberId, { listing: { type: "game", id: privateGameId } });
    expect(r.status).toBe(404);
    expect(JSON.stringify(await r.json())).not.toContain("Private Walk");
  });

  it("an unpublished or suspended-organisation listing can't be suggested", async () => {
    expect((await post(`/circles/${circleId}/plan-ideas`, memberId, { listing: { type: "experience", id: pendingExpId } })).status).toBe(404);
    expect((await post(`/circles/${circleId}/plan-ideas`, memberId, { listing: { type: "experience", id: suspendedExpId } })).status).toBe(404);
  });

  it("a non-member can't suggest, and bad references are refused", async () => {
    expect((await post(`/circles/${circleId}/plan-ideas`, outsiderId, { listing: { type: "game", id: publicGameId } })).status).toBe(403);
    expect((await post(`/circles/${circleId}/plan-ideas`, memberId, { listing: { type: "space", id: "x" } })).status).toBe(400);
    expect((await post(`/circles/${circleId}/plan-ideas`, memberId, { listing: { type: "game", id: publicGameId, sessionId: "x" } })).status).toBe(400);
  });
});

describe("live state", () => {
  it("a booking shows as booked for that member only; interest alone never does", async () => {
    await db
      .prepare(`INSERT INTO experience_bookings (ref, experience_id, session_id, client_id, resident_id, participant_name, email, phone, party_size, total_cents, payment_status, status) VALUES (?, ?, ?, 't3-client', ?, 'M', 'm@example.test', '', 1, 2500, 'paid', 'confirmed')`)
      .run(`EX-T3${u().slice(0, 6)}`, expId, sessionId, memberId);
    const list = await (await fetch(`${baseUrl}/circles/${circleId}/plan-ideas`, { headers: as(memberId) })).json();
    const mine = list.find((p: any) => p.listing?.id === expId);
    expect(mine.listing.myState).toBe("booked");
    expect(mine.listing.spotsLeft).toBe(1);
    const theirs = (await (await fetch(`${baseUrl}/circles/${circleId}/plan-ideas`, { headers: as(organiserId) })).json()).find((p: any) => p.listing?.id === expId);
    expect(theirs.listing.myState).toBeNull();
  });

  it("a cancelled departure shows as cancelled, and can't be suggested again", async () => {
    await db.prepare(`UPDATE experience_sessions SET status = 'cancelled' WHERE id = ?`).run(sessionId);
    const list = await (await fetch(`${baseUrl}/circles/${circleId}/plan-ideas`, { headers: as(memberId) })).json();
    expect(list.find((p: any) => p.listing?.id === expId).listing.availability).toBe("cancelled");
    await db.prepare(`UPDATE circle_plans SET status = 'cancelled' WHERE circle_id = ? AND listing_id = ?`).run(circleId, expId);
    expect((await post(`/circles/${circleId}/plan-ideas`, memberId, { listing: { type: "experience", id: expId, sessionId } })).status).toBe(409);
    await db.prepare(`UPDATE experience_sessions SET status = 'scheduled' WHERE id = ?`).run(sessionId);
  });
});

describe("plans about a listing don't become a second listing", () => {
  it("a confirmed programme plan can't be converted into an activity", async () => {
    const plan = (await db.prepare(`SELECT id FROM circle_plans WHERE circle_id = ? AND listing_type = 'program' AND listing_session_id IS NULL`).get(circleId)) as { id: string };
    expect((await post(`/circles/${circleId}/plan-ideas/${plan.id}/confirm`, organiserId, {})).status).toBe(200);
    const r = await post(`/games`, organiserId, { activityLabel: "T3 Pottery", date: "2099-08-01", time: "19:00", capacity: 6, circleId, planId: plan.id, locationText: "Hall" });
    expect(r.status).toBe(409);
    const { n } = (await db.prepare(`SELECT COUNT(*) as n FROM games WHERE plan_id = ?`).get(plan.id)) as { n: number };
    expect(Number(n)).toBe(0);
  });
});

describe("share as a plan", () => {
  it("sharing with 'also add it to the plans' reuses an open suggestion instead of doubling it", async () => {
    const r = await post(`/circles/${circleId}/share`, memberId, { entityType: "game", entityId: publicGameId, addAsPlan: true });
    expect(r.status).toBe(201);
    const body = await r.json();
    const existing = (await db.prepare(`SELECT id FROM circle_plans WHERE circle_id = ? AND listing_type = 'game' AND listing_id = ? AND status IN ('idea','confirmed')`).get(circleId, publicGameId)) as { id: string };
    expect(body.planId).toBe(existing.id);
    const { n } = (await db.prepare(`SELECT COUNT(*) as n FROM circle_plans WHERE circle_id = ? AND listing_id = ?`).get(circleId, publicGameId)) as { n: number };
    expect(Number(n)).toBe(1);
  });

  it("sharing without the box creates no plan", async () => {
    const r = await post(`/circles/${circleId}/share`, memberId, { entityType: "adventure", entityId: expId });
    expect((await r.json()).planId).toBeNull();
  });
});

describe("reports", () => {
  it("a plan can be reported and removed by HelloCircle, with members told", async () => {
    const plan = (await db.prepare(`SELECT id FROM circle_plans WHERE circle_id = ? AND listing_type = 'centre'`).get(circleId)) as { id: string };
    const target = await resolveReportTarget("circle_plan", plan.id);
    expect(target).toMatchObject({ id: plan.id, circleId, listingType: "centre" });
    const action = await applyReportAction({ id: 0, targetType: "circle_plan", targetId: plan.id }, vendorId, { reasonCategory: "other", explanation: "Not appropriate for this Circle" } as never);
    expect(action.action).toBe("circle_plan_removed");
    const row = (await db.prepare(`SELECT status FROM circle_plans WHERE id = ?`).get(plan.id)) as { status: string };
    expect(row.status).toBe("cancelled");
  });
});

describe("provider cancellation notices", () => {
  it("cancelling a suggested activity tells the Circle's organisers once; a repeat is silent", async () => {
    const { cancelGameAndNotify } = await import("./games.js");
    const plan = (await db.prepare(`SELECT id FROM circle_plans WHERE circle_id = ? AND listing_type = 'game' AND listing_id = ? AND status IN ('idea','confirmed')`).get(circleId, publicGameId)) as { id: string };
    expect(await cancelGameAndNotify(publicGameId, { by: "host" })).toBe(true);
    const count = async () => Number(((await db.prepare(`SELECT COUNT(*) as n FROM notifications WHERE resident_id = ? AND ref = ? AND title LIKE '%was cancelled%'`).get(organiserId, plan.id)) as { n: number }).n);
    expect(await count()).toBe(1);
    expect(await cancelGameAndNotify(publicGameId, { by: "host" })).toBe(false);
    const { noticeListingCancelled } = await import("../circlePlanNotices.js");
    expect(await noticeListingCancelled("game", publicGameId, { title: "T3 Pickleball" })).toBe(0);
    expect(await count()).toBe(1);
    // The plan stays; its listing now reads as cancelled.
    const read = await (await fetch(`${baseUrl}/circles/${circleId}/plan-ideas/${plan.id}`, { headers: as(memberId) })).json();
    expect(read.listing.availability).toBe("cancelled");
  });
});

describe("My Life: plans you're in", () => {
  it("the same programme planned in two Circles is one entry naming both, and isn't shown as booked", async () => {
    await db.prepare(`INSERT INTO circle_members (circle_id, resident_id, role) VALUES (?, ?, 'member')`).run(otherCircleId, memberId);
    const here = (await db.prepare(`SELECT id FROM circle_plans WHERE circle_id = ? AND listing_type = 'program' AND listing_session_id IS NULL`).get(circleId)) as { id: string };
    const thereId = `t3-plan-${u()}`;
    await db
      .prepare(`INSERT INTO circle_plans (id, circle_id, created_by_resident_id, title, note, listing_type, listing_id) VALUES (?, ?, ?, 'T3 Pottery', '', 'program', ?)`)
      .run(thereId, otherCircleId, organiserId, programId);
    await db.prepare(`INSERT IGNORE INTO circle_plan_interest (plan_id, resident_id) VALUES (?, ?), (?, ?)`).run(here.id, memberId, thereId, memberId);
    const r = await fetch(`${baseUrl}/circles/my-plans`, { headers: as(memberId) });
    expect(r.status).toBe(200);
    const list = await r.json();
    const pottery = list.filter((p: any) => p.listing?.id === programId && !p.listing.sessionId);
    expect(pottery).toHaveLength(1);
    expect(pottery[0].circles.map((c: any) => c.name).sort()).toEqual(["T3 Circle", "T3 Other"]);
    expect(pottery[0].listing.myState).toBeNull();
    // Leaving a Circle drops its plans from the list.
    await db.prepare(`DELETE FROM circle_members WHERE circle_id = ? AND resident_id = ?`).run(otherCircleId, memberId);
    const after = (await (await fetch(`${baseUrl}/circles/my-plans`, { headers: as(memberId) })).json()).find((p: any) => p.listing?.id === programId && !p.listing.sessionId);
    expect(after.circles.map((c: any) => c.name)).toEqual(["T3 Circle"]);
  });

  it("needs a signed-in resident", async () => {
    expect((await fetch(`${baseUrl}/circles/my-plans`)).status).toBe(401);
  });
});

describe("who can reopen a closed Circle", () => {
  const put = (status: string) => fetch(`${baseUrl}/circles/${otherCircleId}/status`, { method: "PUT", headers: as(organiserId), body: JSON.stringify({ status }) });
  it("an organiser reopens their own closure", async () => {
    expect((await put("closed")).status).toBe(200);
    expect(((await db.prepare(`SELECT closed_by as b FROM circles WHERE id = ?`).get(otherCircleId)) as { b: string }).b).toBe("organiser");
    expect((await put("active")).status).toBe(200);
  });
  it("but not a Circle HelloCircle closed", async () => {
    await db.prepare(`UPDATE circles SET status = 'closed', closed_by = 'helloCircle' WHERE id = ?`).run(otherCircleId);
    expect((await put("active")).status).toBe(403);
    expect(((await db.prepare(`SELECT status FROM circles WHERE id = ?`).get(otherCircleId)) as { status: string }).status).toBe("closed");
  });
});

describe("day-before reminders", () => {
  it("say whether each person is booked, go once, and skip cancelled listings", async () => {
    const { sweepCirclePlanReminders } = await import("../circlePlanNotices.js");
    const listingPlan = `t3-rem-l-${u()}`;
    const freePlan = `t3-rem-f-${u()}`;
    await db
      .prepare(`INSERT INTO circle_plans (id, circle_id, created_by_resident_id, title, note, proposed_date, proposed_time, listing_type, listing_id, listing_session_id) VALUES (?, ?, ?, 'T3 Hike day', '', '2099-07-01', '10:00', 'experience', ?, ?)`)
      .run(listingPlan, circleId, memberId, expId, sessionId);
    await db.prepare(`INSERT INTO circle_plans (id, circle_id, created_by_resident_id, title, note, proposed_date) VALUES (?, ?, ?, 'T3 Picnic', '', '2099-07-01')`).run(freePlan, circleId, memberId);
    await db.prepare(`INSERT IGNORE INTO circle_plan_interest (plan_id, resident_id) VALUES (?, ?), (?, ?), (?, ?)`).run(listingPlan, memberId, listingPlan, organiserId, freePlan, memberId);
    const sent = await sweepCirclePlanReminders("2099-06-30");
    expect(sent).toBe(3);
    const body = async (who: string, plan: string) => ((await db.prepare(`SELECT body FROM notifications WHERE resident_id = ? AND ref = ? AND title LIKE 'Tomorrow%'`).get(who, plan)) as { body: string }).body;
    expect(await body(memberId, listingPlan)).toMatch(/You're booked/);
    expect(await body(organiserId, listingPlan)).toMatch(/isn't booked yet/);
    expect(await body(memberId, freePlan)).toMatch(/still a plan/);
    expect(await sweepCirclePlanReminders("2099-06-30")).toBe(0);

    // A cancelled departure gets no reminder.
    const cancelledPlan = `t3-rem-c-${u()}`;
    await db.prepare(`UPDATE experience_sessions SET status = 'cancelled' WHERE id = ?`).run(sessionId);
    await db
      .prepare(`INSERT INTO circle_plans (id, circle_id, created_by_resident_id, title, note, proposed_date, listing_type, listing_id, listing_session_id) VALUES (?, ?, ?, 'T3 Cancelled hike', '', '2099-07-01', 'experience', ?, ?)`)
      .run(cancelledPlan, circleId, memberId, expId, sessionId);
    await db.prepare(`INSERT IGNORE INTO circle_plan_interest (plan_id, resident_id) VALUES (?, ?)`).run(cancelledPlan, memberId);
    expect(await sweepCirclePlanReminders("2099-06-30")).toBe(0);
    await db.prepare(`UPDATE experience_sessions SET status = 'scheduled' WHERE id = ?`).run(sessionId);
  });
});
