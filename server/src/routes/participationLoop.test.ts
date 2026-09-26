import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import type { ScheduledActivity } from "../db/queries.js";
import { interestRange, normalizeDemand } from "../demandNormalize.js";
import { containsPhrase, getOpportunities, matchIntentsForSupply } from "../participationIntents.js";
import { scoreFit, type ScoringContext } from "../personalization.js";
import { DEFAULT_WEIGHTS, validateWeights } from "../recommendationWeights.js";
import { bookingsRouter } from "./bookings.js";
import { discoverRouter } from "./discover.js";
import { experiencesRouter } from "./experiences.js";
import { feedbackRouter } from "./feedback.js";
import { nextStepsRouter } from "./nextSteps.js";
import { participationIntentsRouter } from "./participationIntents.js";
import { vendorOperationsRouter } from "./vendorOperations.js";

// Community participation upgrade, Releases 3–6 — pure-function tests
// (demand clustering, fit scoring, weights) plus real-DB route tests on
// hello_circle_dev with stubbed identity (same approach as games.test.ts):
// no-show vs feedback, next-steps ownership, free volunteer booking,
// request clustering and dedupe, host opportunities, supply matching with
// the weekly cap, and the New Here gate. Unique run ids; all cleaned up.

// ---------------------------------------------------------------- pure --

describe("normalizeDemand", () => {
  it("puts wording variants in one cluster and pulls out day/time", () => {
    const keys = ["badminton", "Badminton Sunday", "Sunday badminton", "social badminton sunday morning", "badminton games"].map((t) => normalizeDemand(t).clusterKey);
    expect(new Set(keys)).toEqual(new Set(["badminton"]));
    expect(normalizeDemand("social badminton sunday morning")).toMatchObject({ label: "Badminton", category: "Badminton", days: ["sun"], time: "morning" });
  });
  it("maps synonyms and categories, and leaves nothing for timing-only text", () => {
    expect(normalizeDemand("5-a-side on Tuesdays").clusterKey).toBe("football");
    expect(normalizeDemand("hill walking").clusterKey).toBe("hiking");
    expect(normalizeDemand("hiking").category).toBe("Outdoor");
    expect(normalizeDemand("this weekend").clusterKey).toBe("");
  });
  it("shows hosts ranges, not exact counts", () => {
    expect([3, 4, 7, 12, 25, 31, 80].map(interestRange)).toEqual(["3+", "3+", "5+", "10+", "20+", "30+", "50+"]);
  });
  it("matches whole words only", () => {
    expect(containsPhrase("sunday badminton social", "badminton")).toBe(true);
    expect(containsPhrase("start-up networking", "art")).toBe(false);
  });
});

describe("scoreFit", () => {
  const activity = (over: Partial<ScheduledActivity> = {}): ScheduledActivity => ({
    kind: "game", id: "g1", title: "Badminton", date: "2026-10-04", time: "10:00", centreName: null, clubName: null, area: null, county: "Dublin",
    priceCents: 0, href: "/games/g1", spotsLeft: 3, joined: 2, imageUrl: null, isLive: false, durationMinutes: 120, lat: null, lng: null,
    locationSource: null, listingType: "game", listingId: "g1", circleId: null, ...over,
  });
  const ctx = (profile: Partial<NonNullable<ScoringContext["profile"]>> | null, attrs: string[] = []): ScoringContext => ({
    weights: DEFAULT_WEIGHTS,
    attributes: new Map([["game:g1", attrs]]),
    familiar: new Map(),
    profile: profile && {
      id: "r", homeCounty: "Dublin", interests: [], availability: new Set(), goals: [], prefSolo: false, prefBeginner: false, prefFirstTimer: false,
      prefFamily: false, prefGroupSize: "", prefBudget: "", home: null, radiusKm: 10, circleIds: new Set(), ...profile,
    },
  });

  it("gives a signed-out visitor nothing", () => {
    expect(scoreFit(activity(), ctx(null))).toMatchObject({ label: null, reasons: [] });
  });
  it("explains a strong match in plain language, never as a percentage", () => {
    // 2026-10-04 is a Sunday.
    const fit = scoreFit(activity(), ctx({ interests: ["Badminton"], availability: new Set(["sun:morning"]), prefSolo: true, goals: ["Meet people"] }, ["come_alone"]));
    expect(fit.label).toBe("Great fit");
    expect(fit.reasons).toEqual(expect.arrayContaining(["You're interested in badminton", "You're normally free Sunday mornings", "People commonly come on their own", "A good way to meet people"]));
    expect(fit.reasons.join(" ")).not.toMatch(/%/);
  });
  it("doesn't punish a sparse profile, and labels nothing without a real reason", () => {
    expect(scoreFit(activity(), ctx({ interests: ["Yoga"], homeCounty: null })).label).toBeNull();
    expect(scoreFit(activity(), ctx({ homeCounty: "Dublin" })).label).not.toBeNull(); // only county known, and it matches
  });
  it("respects configured weights", () => {
    const zeroInterest = { ...ctx({ interests: ["Badminton"], homeCounty: null }), weights: { ...DEFAULT_WEIGHTS, interest: 0 } };
    expect(scoreFit(activity(), zeroInterest).earned).toBe(0);
    expect(scoreFit(activity(), ctx({ interests: ["Badminton"], homeCounty: null })).earned).toBe(DEFAULT_WEIGHTS.interest);
  });
});

describe("validateWeights", () => {
  it("accepts known keys in range and rejects anything else", () => {
    expect(validateWeights({ interest: 40 })).toEqual({ ...DEFAULT_WEIGHTS, interest: 40 });
    expect(validateWeights({ interest: 101 })).toBeNull();
    expect(validateWeights({ interest: "40" })).toBeNull();
    expect(validateWeights(null)).toBeNull();
  });
});

// ------------------------------------------------------------- real DB --

let server: Server;
let baseUrl: string;
const run = crypto.randomUUID().slice(0, 8);
const COUNTY = `TestCounty${run}`;
const residents = [0, 1, 2, 3].map((i) => `test-loop-r${i}-${run}`);
const clientA = `test-loop-ca-${run}`;
const clientB = `test-loop-cb-${run}`;
const bookingRef = `TLB${run}`.toUpperCase();
const experienceId = `test-loop-exp-${run}`;
const sessionId = `test-loop-es-${run}`;
let centre: { id: string; vendorId: string };

function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}${path}`, { method, headers: { "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
}
const iso = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const residentId = req.header("X-Test-Resident-Id");
    if (residentId) (req as any).resident = { id: residentId, name: "Test", homeCounty: req.header("X-Test-County") ?? null };
    const vendorId = req.header("X-Test-Vendor-Id");
    if (vendorId) {
      (req as any).user = { id: vendorId, role: "vendor", status: "approved", invitedStaff: false, platformRole: null };
      (req as any).vendorIds = [vendorId];
    }
    next();
  });
  app.use("/feedback", feedbackRouter);
  app.use("/next-steps", nextStepsRouter);
  app.use("/bookings", bookingsRouter);
  app.use("/intents", participationIntentsRouter);
  app.use("/discover", discoverRouter);
  app.use("/experiences", experiencesRouter);
  app.use("/vendor", vendorOperationsRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}`;

  centre = (await db.prepare(`SELECT id, vendor_id as vendorId FROM centres WHERE status = 'approved' AND vendor_id IS NOT NULL LIMIT 1`).get()) as typeof centre;
  for (const id of residents) await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, ?)`).run(id, `${id}@example.test`, id);
  await db
    .prepare(
      `INSERT INTO bookings (ref, centre_id, room_id, date, time, duration, event_type, guests, name, email, phone, notes, total_cents, client_id, payment_status)
       VALUES (?, ?, '', ?, '10:00', 1, '', 1, 'Loop Guest', 'loop@example.test', '', '', 1000, ?, 'paid')`
    )
    .run(bookingRef, centre.id, iso(-1), clientA);
  await db
    .prepare(
      `INSERT INTO experiences (id, vendor_id, kind, title, county, blurb, description, fitness_requirements, itinerary, equipment_provided, equipment_required,
         transport_info, safety_info, weather_policy, eligibility, cancellation_terms, price_cents, capacity, status)
       VALUES (?, ?, 'volunteer', 'Beach clean-up', ?, '', '', '', '', '', '', '', '', '', '', '', 0, 20, 'approved')`
    )
    .run(experienceId, centre.vendorId, COUNTY);
  await db.prepare(`INSERT INTO experience_sessions (id, experience_id, date, time, status) VALUES (?, ?, ?, '10:00', 'scheduled')`).run(sessionId, experienceId, iso(3));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const marks = residents.map(() => "?").join(", ");
  await db.prepare(`DELETE FROM attendance WHERE ref = ?`).run(bookingRef);
  await db.prepare(`DELETE FROM activity_feedback WHERE ref = ?`).run(bookingRef);
  await db.prepare(`DELETE FROM bookings WHERE ref = ?`).run(bookingRef);
  await db.prepare(`DELETE FROM experience_bookings WHERE experience_id = ?`).run(experienceId);
  await db.prepare(`DELETE FROM experience_sessions WHERE experience_id = ?`).run(experienceId);
  await db.prepare(`DELETE FROM experiences WHERE id = ?`).run(experienceId);
  await db.prepare(`DELETE FROM participation_intents WHERE county = ?`).run(COUNTY);
  await db.prepare(`DELETE FROM intent_cluster_notifications WHERE county = ?`).run(COUNTY);
  await db.prepare(`DELETE FROM notifications WHERE resident_id IN (${marks})`).run(...residents);
  await db.prepare(`DELETE FROM analytics_events WHERE resident_id IN (${marks}) OR client_id IN (?, ?) OR metadata LIKE ?`).run(...residents, clientA, clientB, `%${run}%`);
  await db.prepare(`DELETE FROM residents WHERE id IN (${marks})`).run(...residents);
});

describe("Release 3 — attendance, feedback, next steps", () => {
  it("records a no-show, shows it to the guest, and refuses feedback for it", async () => {
    const vendor = { "X-Test-Vendor-Id": centre.vendorId };
    expect((await call("POST", `/vendor/checkin/booking/${bookingRef}`, { status: "no_show" }, vendor)).status).toBe(200);
    const status = await (await call("GET", `/vendor/checkin/booking/${bookingRef}`, undefined, vendor)).json();
    expect(status).toMatchObject({ checkedIn: false, status: "no_show" });
    const mine = (await (await call("GET", "/bookings", undefined, { "X-Client-Id": clientA })).json()) as { ref: string; attendance: string }[];
    expect(mine.find((b) => b.ref === bookingRef)?.attendance).toBe("no_show");
    expect((await call("POST", "/feedback", { kind: "booking", ref: bookingRef, response: "yes" }, { "X-Client-Id": clientA })).status).toBe(409);
  });

  it("stores rating, tags and comment once they did attend", async () => {
    await call("POST", `/vendor/checkin/booking/${bookingRef}`, { status: "present" }, { "X-Test-Vendor-Id": centre.vendorId });
    const res = await call("POST", "/feedback", { kind: "booking", ref: bookingRef, response: "yes", rating: 5, tags: ["great_host", "nonsense"], comment: "  Lovely  " }, { "X-Client-Id": clientA });
    expect(res.status).toBe(201);
    const status = await (await call("GET", `/feedback/status?kind=booking&ref=${bookingRef}`, undefined, { "X-Client-Id": clientA })).json();
    expect(status).toMatchObject({ response: "yes", rating: 5, tags: ["great_host"], comment: "Lovely" });
    expect((await call("POST", "/feedback", { kind: "booking", ref: bookingRef, response: "yes", rating: 6 }, { "X-Client-Id": clientA })).status).toBe(400);
  });

  it("gives next steps only to whoever made the booking", async () => {
    expect((await call("GET", `/next-steps?kind=booking&ref=${bookingRef}`, undefined, { "X-Client-Id": clientA })).status).toBe(200);
    expect((await call("GET", `/next-steps?kind=booking&ref=${bookingRef}`, undefined, { "X-Client-Id": clientB })).status).toBe(404);
    expect((await call("GET", `/next-steps?kind=nope&ref=${bookingRef}`)).status).toBe(400);
  });
});

describe("Release 5 — volunteering and New Here", () => {
  it("confirms a free volunteer sign-up immediately (no Stripe)", async () => {
    const res = await call("POST", `/experiences/${experienceId}/sessions/${sessionId}/checkout`, { participantName: "Vol", email: "vol@example.test", partySize: 2 }, { "X-Client-Id": clientB });
    expect(res.status).toBe(201);
    const { ref } = await res.json();
    const row = (await db.prepare(`SELECT payment_status FROM experience_bookings WHERE ref = ?`).get(ref)) as { payment_status: string };
    expect(row.payment_status).toBe("paid");
    const detail = await (await call("GET", `/experiences/${experienceId}`)).json();
    expect(detail).toMatchObject({ kind: "volunteer", priceCents: 0 });
  });

  it("shows New Here only to someone who said they're new", async () => {
    const me = { "X-Test-Resident-Id": residents[0], "X-Test-County": COUNTY };
    expect(await (await call("GET", "/discover/new-here", undefined, me)).json()).toEqual({ sections: [], circles: [] });
    await db.prepare(`UPDATE residents SET area_tenure = 'new' WHERE id = ?`).run(residents[0]);
    const data = await (await call("GET", "/discover/new-here", undefined, me)).json();
    expect(Array.isArray(data.sections) && Array.isArray(data.circles)).toBe(true);
    expect(data.sections.find((s: { key: string }) => s.key === "volunteer")?.items[0]?.title).toBe("Beach clean-up");
  });
});

describe("Release 6 — the demand loop", () => {
  const request = (label: string, headers: Record<string, string>, extra: Record<string, unknown> = {}) =>
    call("POST", "/intents", { activityLabel: label, county: COUNTY, ...extra }, headers);
  const count = (label: string, clientId: string) => call("GET", `/intents/count?activityLabel=${encodeURIComponent(label)}&county=${COUNTY}`, undefined, { "X-Client-Id": clientId }).then((r) => r.json());

  it("clusters wording variants and counts each person once", async () => {
    await request("badminton", { "X-Client-Id": clientA });
    await request("Sunday badminton", { "X-Client-Id": clientB }, { budgetMaxEuro: 15 });
    expect((await count("social badminton", clientA)).count).toBe(2);
    // The same person asking again, differently, updates their own request.
    await request("badminton sunday morning", { "X-Client-Id": clientA });
    expect((await count("badminton", clientA)).count).toBe(2);
    const rows = (await db.prepare(`SELECT preferred_days, cluster_key FROM participation_intents WHERE county = ? AND client_id = ?`).all(COUNTY, clientA)) as { preferred_days: string; cluster_key: string }[];
    expect(rows).toEqual([{ preferred_days: "sun", cluster_key: "badminton" }]);
  });

  it("only surfaces resident-backed demand to hosts, as a range, with no identities", async () => {
    expect((await getOpportunities([COUNTY])).length).toBe(0); // 2 anonymous devices so far
    for (const r of residents.slice(0, 3)) await request("Badminton", { "X-Client-Id": `dev-${r}`, "X-Test-Resident-Id": r }, { preferredDays: ["sun"], preferredTimeWindow: "morning" });
    const [o] = await getOpportunities([COUNTY]);
    expect(o).toMatchObject({ clusterKey: "badminton", county: COUNTY, interested: "3+", preferredDays: ["sun"], preferredTime: "morning" });
    expect(JSON.stringify(o)).not.toMatch(/test-loop-r/);
  });

  it("notifies interested residents once when matching supply is published, within the weekly cap", async () => {
    // residents[2] has already had 3 match notifications this week.
    for (let i = 0; i < 3; i++) {
      await db
        .prepare(`INSERT INTO notifications (recipient_id, resident_id, kind, title, body, listing_type, listing_id, ref) VALUES ('', ?, 'intent_match', 't', 'b', 'game', 'x', 'x')`)
        .run(residents[2]);
    }
    await matchIntentsForSupply({ kind: "program", id: `prog-${run}`, title: "Sunday Badminton Social", county: COUNTY, when: "Sunday · 10:00" });
    const statuses = (await db
      .prepare(`SELECT resident_id as r, status FROM participation_intents WHERE county = ? AND resident_id IS NOT NULL ORDER BY resident_id`)
      .all(COUNTY)) as { r: string; status: string }[];
    expect(statuses.find((s) => s.r === residents[0])?.status).toBe("converted");
    expect(statuses.find((s) => s.r === residents[2])?.status).toBe("active"); // capped — kept for a later match
    const notified = (await db.prepare(`SELECT COUNT(*) as n FROM notifications WHERE resident_id = ? AND listing_id = ?`).get(residents[0], `prog-${run}`)) as { n: number };
    expect(Number(notified.n)).toBe(1);
    // Publishing again doesn't notify twice.
    await matchIntentsForSupply({ kind: "program", id: `prog-${run}`, title: "Sunday Badminton Social", county: COUNTY, when: "" });
    const again = (await db.prepare(`SELECT COUNT(*) as n FROM notifications WHERE resident_id = ? AND listing_id = ?`).get(residents[0], `prog-${run}`)) as { n: number };
    expect(Number(again.n)).toBe(1);
  });
});
