import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, setSetting } from "./db/index.js";
import { adminRouter } from "./routes/admin.js";
import { vendorRouter } from "./routes/vendor.js";
import { orgRouter } from "./routes/org.js";
import { experiencesRouter } from "./routes/experiences.js";
import { CAPABILITIES, CapabilityChangeError, TEMPLATES, planChange, resolveStates, templateChange } from "./capabilities.js";
import { irelandTodayIso } from "./irelandTime.js";

// Configuration framework Phase B (docs/participation-expansion/14) — the
// organisation capability registry: pure rules, then the real admin and
// partner routers (requireAdmin / requireVendor run as in production; the
// test only stands in for attachUser). Real isolated MySQL.

const run = crypto.randomUUID().slice(0, 8);
const id = (k: string) => `t-${k}-cap-${run}`;
const orgA = id("orgA");
const orgB = id("orgB");
const ownerA = id("ownerA");
const ownerB = id("ownerB");
const adminSuper = id("super");
const adminSupport = id("support");
const expB = id("expB");
const sessB = id("sessB");
const refs: string[] = [];
let server: Server;
let base: string;

const SWITCHES = ["participation.events", "participation.attendees", "participation.checkin", "participation.options"];
const all = async <T = any>(sql: string, ...p: unknown[]) => (await db.prepare(sql).all(...p)) as T[];

function userFor(who: string) {
  const v = { role: "vendor", status: "approved", invitedStaff: false, platformRole: null, orgStatus: "active", name: who, businessName: who, email: `${who}@example.test` };
  switch (who) {
    case "ownerA": return { ...v, id: ownerA, orgId: orgA };
    case "ownerB": return { ...v, id: ownerB, orgId: orgB };
    case "ownerBsuspended": return { ...v, id: ownerB, orgId: orgB, orgStatus: "suspended" };
    case "super": return { id: adminSuper, role: "admin", status: "approved", adminRole: "super", name: "s", email: "s@example.test" };
    case "support": return { id: adminSupport, role: "admin", status: "approved", adminRole: "support", name: "u", email: "u@example.test" };
  }
  return undefined;
}

async function call(method: string, path: string, body?: unknown, who?: string, client = id("client")) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json", "X-Client-Id": client, ...(who ? { "X-Test-User": who } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

const caps = async (org: string) => (await call("GET", `/api/admin/organisations/${org}/capabilities`, undefined, "super")).body;

beforeAll(async () => {
  for (const k of SWITCHES) await setSetting(k, "true");
  await db.prepare(`INSERT INTO organisations (id, name, kind) VALUES (?, 'Cap A', 'vendor'), (?, 'Cap B', 'vendor')`).run(orgA, orgB);
  for (const [uid, org] of [[ownerA, orgA], [ownerB, orgB]]) {
    await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name, org_id) VALUES (?, ?, 'x', 'vendor', 'approved', 'Cap owner', ?)`).run(uid, `${uid}@example.test`, org);
  }
  await db.prepare(`INSERT INTO experiences (id, vendor_id, kind, title, blurb, description, fitness_requirements, itinerary, equipment_provided, equipment_required, transport_info, safety_info, weather_policy, eligibility, cancellation_terms, status, capacity, price_cents, payment_method)
    VALUES (?, ?, 'event', 'Cap B event', 'B', 'D', '', '', '', '', '', '', '', '', '', 'approved', 50, 0, 'cash')`).run(expB, ownerB);
  await db.prepare(`INSERT INTO experience_sessions (id, experience_id, date, time) VALUES (?, ?, ?, '23:59')`).run(sessB, expB, irelandTodayIso());
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const who = req.header("X-Test-User");
    if (who) (req as any).user = userFor(who);
    next();
  });
  app.use("/api/admin", adminRouter);
  app.use("/api/vendor/org", orgRouter);
  app.use("/api/vendor", vendorRouter);
  app.use("/api/experiences", experiencesRouter);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const a = server.address();
  if (!a || typeof a === "string") throw new Error("bind");
  base = `http://127.0.0.1:${a.port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  for (const k of SWITCHES) await setSetting(k, "false");
  const ph = refs.map(() => "?").join(",") || "''";
  for (const t of ["order_acknowledgements", "booking_attendees", "registration_answers"]) await db.prepare(`DELETE FROM ${t} WHERE source_ref IN (${ph})`).run(...refs);
  await db.prepare(`DELETE FROM experience_booking_participants WHERE booking_ref IN (${ph})`).run(...refs);
  await db.prepare(`DELETE FROM notifications WHERE listing_id = ?`).run(expB);
  await db.prepare(`DELETE FROM experience_bookings WHERE experience_id = ?`).run(expB);
  await db.prepare(`DELETE FROM experience_sessions WHERE experience_id = ?`).run(expB);
  await db.prepare(`DELETE FROM experiences WHERE vendor_id IN (?, ?)`).run(ownerA, ownerB);
  await db.prepare(`DELETE FROM listing_staff_assignments WHERE org_id IN (?, ?)`).run(orgA, orgB);
  await db.prepare(`DELETE FROM feature_flags WHERE org_id IN (?, ?)`).run(orgA, orgB);
  await db.prepare(`DELETE FROM org_capability_limits WHERE org_id IN (?, ?)`).run(orgA, orgB);
  await db.prepare(`DELETE FROM audit_log WHERE object_id IN (?, ?, ?)`).run(orgA, orgB, expB);
  await db.prepare(`DELETE FROM users WHERE id IN (?, ?)`).run(ownerA, ownerB);
  await db.prepare(`DELETE FROM organisations WHERE id IN (?, ?)`).run(orgA, orgB);
});

describe("capability rules", () => {
  const none = new Map<string, boolean>();
  it("defaults: every available capability is on (opt-out, like the old flags); unavailable ones never are", () => {
    const s = resolveStates(none, new Map(), new Map());
    for (const c of CAPABILITIES) expect([c.key, s.find((x) => x.key === c.key)!.effective]).toEqual([c.key, c.status === "available"]);
  });
  it("platform switch and dependencies win over the organisation's own setting", () => {
    const s = resolveStates(new Map([["experiences", false]]), new Map(), new Map([["checkin", false]]));
    const get = (k: string) => s.find((x) => x.key === k)!;
    expect(get("events")).toMatchObject({ orgEnabled: true, dependenciesOn: false, effective: false });
    expect(get("checkin")).toMatchObject({ orgEnabled: true, platformOn: false, effective: false });
    expect(get("venues").effective).toBe(true);
  });
  it("limits are capped at the platform maximum", () => {
    const s = resolveStates(none, new Map([["registration_questions.max_questions", 5]]), new Map());
    expect(s.find((x) => x.key === "registration_questions")!.limits).toEqual({ max_questions: 5 });
    expect(() => planChange({ enabled: none, limits: new Map() }, { limits: { "registration_questions.max_questions": 13 } })).toThrow(CapabilityChangeError);
  });
  it("refuses unknown keys, unavailable capabilities and broken dependencies", () => {
    const err = (raw: unknown) => {
      try { planChange({ enabled: none, limits: new Map() }, raw); return null; } catch (e) { return e instanceof CapabilityChangeError ? [e.status, e.message] : String(e); }
    };
    expect(err({ enabled: { nope: true } })?.[0]).toBe(400);
    expect(err({ enabled: { donations: true } })).toEqual([409, expect.stringMatching(/Donations can't be switched on/)]);
    expect(err({ enabled: { experiences: false } })).toEqual([409, expect.stringMatching(/Community events needs Experiences/)]);
    expect(err({ enabled: { experiences: false, events: false, volunteering: false, registration_options: false } })).toBeNull();
  });
  it("every template is a valid set and never switches on an unavailable capability", () => {
    for (const t of TEMPLATES) {
      const change = templateChange(t.key);
      expect(change.donations).toBeUndefined();
      expect(() => planChange({ enabled: none, limits: new Map() }, { enabled: change })).not.toThrow();
    }
  });
});

describe("admin configuration and enforcement (tests 1, 4, 7, 17, 18)", () => {
  it("only admins with orgs.manage save; support can read and preview", async () => {
    expect((await call("GET", `/api/admin/organisations/${orgB}/capabilities`, undefined, "support")).status).toBe(200);
    expect((await call("POST", `/api/admin/organisations/${orgB}/capabilities/preview`, { template: "event_organiser" }, "support")).status).toBe(200);
    expect((await call("PUT", `/api/admin/organisations/${orgB}/capabilities`, { template: "event_organiser", configVersion: 0 }, "support")).status).toBe(403);
    expect((await call("PUT", `/api/admin/organisations/${orgB}/capabilities`, { template: "event_organiser", configVersion: 0 }, "ownerB")).status).toBe(403);
  });

  it("#1/#17 two organisations configured differently, audited, with a stale-version guard", async () => {
    const preview = await call("POST", `/api/admin/organisations/${orgB}/capabilities/preview`, { template: "event_organiser", enabled: { checkin: false } }, "super");
    expect(preview.body.impact.map((i: { key: string; existing: number }) => [i.key, i.existing])).toEqual(expect.arrayContaining([["venues", 0], ["checkin", 0]]));
    expect((await call("PUT", `/api/admin/organisations/${orgB}/capabilities`, { template: "event_organiser", enabled: { experiences: false }, configVersion: 0 }, "super")).status).toBe(409);
    const saved = await call("PUT", `/api/admin/organisations/${orgB}/capabilities`, { template: "event_organiser", enabled: { checkin: false }, limits: { "registration_questions.max_questions": 2 }, configVersion: 0, reason: "Event organiser onboarding" }, "super");
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ template: "event_organiser", configVersion: 1 });
    expect((await call("PUT", `/api/admin/organisations/${orgB}/capabilities`, { enabled: { checkin: true }, configVersion: 0 }, "super")).status).toBe(409);
    const b = await caps(orgB);
    const eff = (s: { key: string; effective: boolean }[], k: string) => s.find((x) => x.key === k)!.effective;
    expect([eff(b.states, "venues"), eff(b.states, "clubs"), eff(b.states, "events"), eff(b.states, "checkin")]).toEqual([false, false, true, false]);
    const a = await caps(orgA);
    expect([eff(a.states, "venues"), eff(a.states, "checkin"), a.template]).toEqual([true, true, null]);
    const audit = await all(`SELECT action, previous_value, new_value, reason FROM audit_log WHERE object_id = ? AND action = 'org.capabilities_changed'`, orgB);
    expect(audit).toHaveLength(1);
    expect(JSON.parse(audit[0].new_value)).toMatchObject({ template: "event_organiser", changed: { enabled: { venues: false, checkin: false } } });
    expect(JSON.parse(audit[0].previous_value).effective.venues).toBe(true);
    expect(audit[0].reason).toBe("Event organiser onboarding");
    const org = await call("GET", `/api/vendor/org`, undefined, "ownerB");
    expect(org.body.capabilities).toMatchObject({ venues: false, events: true, checkin: false });
  });

  it("#4 a switched-off module is refused through the API, the other organisation is unaffected", async () => {
    const centre = await call("POST", `/api/vendor/centres`, { name: "Cap B hall" }, "ownerB");
    expect([centre.status, centre.body.capabilityOff]).toEqual([403, "venues"]);
    expect((await call("POST", `/api/vendor/clubs`, { name: "Cap B club" }, "ownerB")).body.capabilityOff).toBe("clubs");
    expect((await call("GET", `/api/vendor/door/sessions/${sessB}`, undefined, "ownerB")).body.capabilityOff).toBe("checkin");
    const tooMany = await call("PUT", `/api/vendor/experiences/${expB}/questions`, { version: 0, questions: [1, 2, 3].map((n) => ({ scope: "booking", inputType: "text", label: `Q${n}`, purpose: "why" })) }, "ownerB");
    expect([tooMany.status, tooMany.body.error]).toEqual([400, expect.stringMatching(/at most 2 questions/)]);
    const ev = await call("POST", `/api/vendor/experiences`, { title: "Cap A event", kind: "event" }, "ownerA");
    expect(ev.body?.capabilityOff).toBeUndefined();
    if (ev.body?.id) await db.prepare(`DELETE FROM experiences WHERE id = ?`).run(ev.body.id);
  });

  it("#7 removing a capability never removes what exists: the event stays public, bookable and readable", async () => {
    const r = await call("POST", `/api/experiences/${expB}/sessions/${sessB}/checkout`, { participantName: "Cap guest", email: "cap@example.test", acceptedTerms: true });
    expect(r.status).toBe(201);
    refs.push(r.body.ref);
    const off = await call("PUT", `/api/admin/organisations/${orgB}/capabilities`, { enabled: { events: false, registration_options: false, experiences: false, volunteering: false, registration_questions: false }, configVersion: 1 }, "super");
    expect(off.status).toBe(200);
    expect((await call("GET", `/api/experiences/${expB}`)).status).toBe(200);
    expect((await call("GET", `/api/experiences/bookings/${r.body.ref}/details`)).status).toBe(200);
    const again = await call("POST", `/api/experiences/${expB}/sessions/${sessB}/checkout`, { participantName: "Cap guest 2", email: "cap2@example.test", acceptedTerms: true });
    expect(again.status).toBe(201);
    refs.push(again.body.ref);
    expect((await call("POST", `/api/vendor/experiences`, { title: "Cap B new" }, "ownerB")).body.capabilityOff).toBe("experiences");
    // Editing the existing event is still allowed.
    expect((await call("PUT", `/api/vendor/experiences/${expB}`, { blurb: "Updated" }, "ownerB")).status).toBe(200);
  });

  it("#18 a suspended organisation is refused before any capability is considered", async () => {
    const r = await call("POST", `/api/vendor/experiences`, { title: "x" }, "ownerBsuspended");
    expect([r.status, r.body.orgSuspended]).toEqual([403, true]);
  });

  it("the original flag routes still work on the same table", async () => {
    expect((await call("PUT", `/api/admin/organisations/${orgA}/flags/programs`, { enabled: false }, "super")).status).toBe(200);
    expect((await call("GET", `/api/admin/organisations/${orgA}/flags`, undefined, "super")).body.programs).toBe(false);
    expect((await caps(orgA)).states.find((s: { key: string }) => s.key === "programs").effective).toBe(false);
  });
});
