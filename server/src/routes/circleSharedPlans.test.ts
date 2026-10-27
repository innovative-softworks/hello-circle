import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { setFeature } from "../circleFeatures.js";
import { circleExperienceRouter } from "./circleExperience.js";
import { circlesRouter } from "./circles.js";

// Circles 3.0 (owner decision 5, 2026-10-28) — one plan shared between two
// Circles through Circle-to-Circle: organiser invites, partner organiser
// accepts, the same plan record shows in both, members of both say "I'm in"
// on it, only the home Circle's organisers decide, and members are never
// shared. Withdrawing un-shares it.

let server: Server;
let baseUrl: string;
const u = () => crypto.randomUUID().slice(0, 8);
const t = u();
const A = `t3s-a-${t}`;
const B = `t3s-b-${t}`;
const oA = `t3s-oa-${t}`;
const mA = `t3s-ma-${t}`;
const oB = `t3s-ob-${t}`;
const mB = `t3s-mb-${t}`;
const out = `t3s-out-${t}`;
const vendor = `t3s-v-${t}`;
const exp = `t3s-exp-${t}`;
const plan = `t3s-plan-${t}`;
let collabId = "";

const as = (r: string) => ({ "Content-Type": "application/json", "X-Test-Resident-Id": r });
const call = (method: string, path: string, who: string, body?: unknown) => fetch(`${baseUrl}${path}`, { method, headers: as(who), body: body === undefined ? undefined : JSON.stringify(body) });

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const id = req.header("X-Test-Resident-Id");
    if (id) (req as any).resident = { id, name: `R ${id.slice(-4)}` };
    next();
  });
  app.use("/circles", circlesRouter);
  app.use("/circles", circleExperienceRouter);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const a = server.address();
  if (!a || typeof a === "string") throw new Error("no port");
  baseUrl = `http://127.0.0.1:${a.port}`;
  await setFeature("circles.collaboration", true);
  await setFeature("circles.make_it_happen", true);

  for (const id of [oA, mA, oB, mB, out]) await db.prepare(`INSERT INTO residents (id, email, name) VALUES (?, ?, 'T3S')`).run(id, `${id}@example.test`);
  await db.prepare(`INSERT INTO circles (id, name, activity_label, area, county, about, created_by_resident_id) VALUES (?, 'Howth Walkers T3S', 'Walking', 'Howth', 'Dublin', '', ?)`).run(A, oA);
  await db.prepare(`INSERT INTO circles (id, name, activity_label, area, county, about, created_by_resident_id, join_mode) VALUES (?, 'Sutton Swimmers T3S', 'Swimming', 'Sutton', 'Dublin', '', ?, 'approval')`).run(B, oB);
  for (const [c, r, role] of [[A, oA, "organiser"], [A, mA, "member"], [B, oB, "organiser"], [B, mB, "member"]]) await db.prepare(`INSERT INTO circle_members (circle_id, resident_id, role) VALUES (?, ?, ?)`).run(c, r, role);
  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name) VALUES (?, ?, 'x', 'vendor', 'approved', 'T3S Vendor')`).run(vendor, `${vendor}@example.test`);
  await db
    .prepare(`INSERT INTO experiences (id, vendor_id, kind, title, blurb, description, fitness_requirements, itinerary, equipment_provided, equipment_required, transport_info, safety_info, weather_policy, eligibility, cancellation_terms, status, price_cents, capacity) VALUES (?, ?, 'experience', 'T3S Sea Swim', 'b', 'd', '', '', '', '', '', '', '', '', '', 'approved', 1200, 10)`)
    .run(exp, vendor);
  await db.prepare(`INSERT INTO circle_plans (id, circle_id, created_by_resident_id, title, note, listing_type, listing_id) VALUES (?, ?, ?, 'T3S Sea Swim', '', 'experience', ?)`).run(plan, A, oA, exp);
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await setFeature("circles.collaboration", false);
  await setFeature("circles.make_it_happen", false);
  await db.prepare(`DELETE FROM circle_plan_interest WHERE plan_id = ?`).run(plan);
  await db.prepare(`DELETE FROM circle_plans WHERE id = ?`).run(plan);
  await db.prepare(`DELETE FROM circle_collaborations WHERE proposer_circle_id = ?`).run(A);
  for (const c of [A, B]) {
    await db.prepare(`DELETE FROM circle_members WHERE circle_id = ?`).run(c);
    await db.prepare(`DELETE FROM notifications WHERE listing_id = ?`).run(c);
    await db.prepare(`DELETE FROM audit_log WHERE object_id = ?`).run(c);
    await db.prepare(`DELETE FROM circles WHERE id = ?`).run(c);
  }
  await db.prepare(`DELETE FROM experiences WHERE id = ?`).run(exp);
  await db.prepare(`DELETE FROM users WHERE id = ?`).run(vendor);
  for (const id of [oA, mA, oB, mB, out]) await db.prepare(`DELETE FROM residents WHERE id = ?`).run(id);
});

describe("one plan shared between two Circles", () => {
  it("only the home Circle's organiser can offer a plan, and only its own open plan", async () => {
    expect((await call("POST", `/circles/${A}/collaborations`, mA, { partnerCircleId: B, planId: plan })).status).toBe(403);
    expect((await call("POST", `/circles/${A}/collaborations`, oA, { partnerCircleId: B, planId: "not-a-plan" })).status).toBe(400);
    const r = await call("POST", `/circles/${A}/collaborations`, oA, { partnerCircleId: B, planId: plan });
    expect(r.status).toBe(201);
    collabId = (await r.json()).id;
  });

  it("before acceptance, the partner Circle doesn't see it", async () => {
    const list = await (await call("GET", `/circles/${B}/plan-ideas`, mB)).json();
    expect(list.find((p: any) => p.id === plan)).toBeUndefined();
  });

  it("after the partner organiser accepts, the same plan shows in both Circles, naming both", async () => {
    expect((await call("POST", `/circles/${B}/collaborations/${collabId}/respond`, oB, { accept: true })).status).toBe(200);
    const inB = (await (await call("GET", `/circles/${B}/plan-ideas`, mB)).json()).find((p: any) => p.id === plan);
    expect(inB).toBeTruthy();
    expect(inB.shared.homeCircle.name).toBe("Howth Walkers T3S");
    expect(inB.shared.partnerCircle.name).toBe("Sutton Swimmers T3S");
    expect(inB.listing.title).toBe("T3S Sea Swim");
    const { n } = (await db.prepare(`SELECT COUNT(*) as n FROM circle_plans WHERE listing_id = ?`).get(exp)) as { n: number };
    expect(Number(n)).toBe(1);
  });

  it("members of both Circles say I'm in on the one plan; totals only", async () => {
    const b = await call("POST", `/circles/${B}/plan-ideas/${plan}/interest`, mB);
    expect(b.status).toBe(200);
    const a = await (await call("POST", `/circles/${A}/plan-ideas/${plan}/interest`, mA)).json();
    expect(a.interestCount).toBe(2);
    const shown = JSON.stringify(await (await call("GET", `/circles/${A}/plan-ideas/${plan}`, mA)).json());
    expect(shown).not.toContain(mB);
  });

  it("only the home Circle's organisers decide", async () => {
    expect((await call("POST", `/circles/${B}/plan-ideas/${plan}/confirm`, oB)).status).toBe(404);
    expect((await call("POST", `/circles/${B}/plan-ideas/${plan}/cancel`, oB, {})).status).toBe(404);
  });

  it("an outsider can't see it through the private partner Circle", async () => {
    expect((await call("GET", `/circles/${B}/plan-ideas/${plan}`, out)).status).toBe(403);
  });

  it("shows once in a member's My Life, under their own Circle", async () => {
    const mine = (await (await call("GET", `/circles/my-plans`, mB)).json()).filter((p: any) => p.planId === plan);
    expect(mine).toHaveLength(1);
    expect(mine[0].circles.map((c: any) => c.name)).toEqual(["Sutton Swimmers T3S"]);
  });

  it("withdrawing un-shares it from the partner Circle", async () => {
    expect((await call("POST", `/circles/${A}/collaborations/${collabId}/withdraw`, oA)).status).toBe(200);
    const list = await (await call("GET", `/circles/${B}/plan-ideas`, mB)).json();
    expect(list.find((p: any) => p.id === plan)).toBeUndefined();
  });
});

describe("Suggest again (no recurring plans, owner decision 6)", () => {
  it("a plan that went quiet doesn't block suggesting the same listing again", async () => {
    await db.prepare(`UPDATE circle_plans SET expires_at = NOW() - INTERVAL 1 DAY WHERE id = ?`).run(plan);
    const r = await call("POST", `/circles/${A}/plan-ideas`, mA, { title: "T3S Sea Swim", listing: { type: "experience", id: exp } });
    expect(r.status).toBe(201);
    const again = (await r.json()).id;
    expect(again).not.toBe(plan);
    // …but a second open one still does.
    expect((await call("POST", `/circles/${A}/plan-ideas`, oA, { listing: { type: "experience", id: exp } })).status).toBe(409);
    await db.prepare(`DELETE FROM circle_plan_interest WHERE plan_id = ?`).run(again);
    await db.prepare(`DELETE FROM circle_plans WHERE id = ?`).run(again);
  });
});

describe("member identities stay inside their Circle", () => {
  it("a partner Circle sees the shared plan without the suggester's name", async () => {
    const pid = `t3s-plan2-${t}`;
    await db.prepare(`INSERT INTO circle_plans (id, circle_id, created_by_resident_id, title, note, partner_circle_id) VALUES (?, ?, ?, 'T3S Joint walk', '', ?)`).run(pid, A, mA, B);
    const fromB = await (await call("GET", `/circles/${B}/plan-ideas/${pid}`, mB)).json();
    expect(fromB.createdByName).toBe("");
    expect(fromB.createdByResidentId).toBe("");
    const fromA = await (await call("GET", `/circles/${A}/plan-ideas/${pid}`, mA)).json();
    expect(fromA.createdByResidentId).toBe(mA);
    await db.prepare(`DELETE FROM circle_plans WHERE id = ?`).run(pid);
  });
});
