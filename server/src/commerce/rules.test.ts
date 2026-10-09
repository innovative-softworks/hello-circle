import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, setSetting } from "../db/index.js";
import { adminRouter } from "../routes/admin.js";
import { RULE_KEYS, TARGET_MODEL_DRAFT, validatePayload } from "./catalog.js";
import { resolveRule } from "./rules.js";

// Commerce Engine Phase 1 — versioned rules end to end through the real
// /api/admin/commerce routes (requireAdmin included). Identity is stubbed at
// the req.user layer, same approach as the other route suites. Tests that
// change what is in force use scenario/category/partner scopes or a future
// effective date, so the seeded global v1 (today's live pricing) stays intact.

const run = crypto.randomUUID().slice(0, 8);
const adminA = `admin-a-${run}`;
const adminB = `admin-b-${run}`;
const vendorUser = `vendor-${run}`;
const orgId = `org-rules-${run}`;
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  for (const [id, role] of [[adminA, "admin"], [adminB, "admin"], [vendorUser, "vendor"]] as const) {
    await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name) VALUES (?, ?, 'x', ?, 'approved', 'T')`).run(id, `${id}@example.test`, role);
  }
  await db.prepare(`INSERT INTO organisations (id, name) VALUES (?, 'Rules Test Org')`).run(orgId);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const id = req.header("X-Test-User-Id");
    if (id) (req as any).user = { id, role: req.header("X-Test-Role") ?? "admin", status: "approved" };
    next();
  });
  app.use("/admin", adminRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await setSetting("commerce.require_second_approver", "false");
  await db.prepare(`DELETE FROM commerce_rule_versions WHERE created_by IN (?, ?)`).run(adminA, adminB);
  await db.prepare(`DELETE FROM audit_log WHERE actor_user_id IN (?, ?)`).run(adminA, adminB);
  await db.prepare(`DELETE FROM users WHERE id IN (?, ?, ?)`).run(adminA, adminB, vendorUser);
  await db.prepare(`DELETE FROM organisations WHERE id = ?`).run(orgId);
});

async function call(method: string, path: string, body?: unknown, as = adminA, role = "admin") {
  const res = await fetch(`${baseUrl}/admin/commerce${path}`, {
    method,
    headers: { "Content-Type": "application/json", "X-Test-User-Id": as, "X-Test-Role": role },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

const draft = (scopeType: string, scopeId: string, payload: Record<string, unknown>, reason = "test change for rules suite", as = adminA) =>
  call("POST", "/rules/drafts", { key: "pricing", scopeType, scopeId, payload, reason }, as);

describe("catalog validation", () => {
  it("every seeded v1 payload is complete and valid", () => {
    for (const spec of Object.values(RULE_KEYS)) expect(validatePayload(spec.key, "global", spec.v1)).toEqual({ ok: true, errors: [] });
  });
  it("rejects unknown fields, out-of-range values and wrong scopes", () => {
    expect(validatePayload("pricing", "scenario", { customerFeeBps: 500, typoField: 1 }).ok).toBe(false);
    expect(validatePayload("pricing", "scenario", { customerFeeBps: 99_999 }).ok).toBe(false);
    expect(validatePayload("pricing", "scenario", { vatMode: "sometimes" }).ok).toBe(false);
    expect(validatePayload("checkout", "global", { pendingHoldMinutes: 10 }).ok).toBe(false); // below Stripe's 30-minute floor
    expect(validatePayload("checkout", "partner", { pendingHoldMinutes: 60 }).ok).toBe(false); // global-only rule
    expect(validatePayload("pricing", "global", { customerFeeBps: 0 }).ok).toBe(false); // global must be complete
  });
});

describe("seeded state", () => {
  it("global v1 of every rule is in force with today's values", async () => {
    for (const spec of Object.values(RULE_KEYS)) {
      const r = await resolveRule(spec.key);
      expect(r.values).toEqual(spec.v1);
      expect(r.sources[0]).toMatchObject({ scopeType: "global", version: 1 });
    }
  });
  it("the earlier brief's target-model draft is no longer seeded, and any system copy is discarded (decision B11)", async () => {
    const { body } = await call("GET", "/rules?key=pricing");
    const systemDrafts = body.filter((r: any) => r.createdBy === "system" && r.status !== "published");
    for (const d of systemDrafts) expect(d.status).toBe("discarded");
  });
});

describe("authorisation", () => {
  it("non-admins can't read or change commercial rules", async () => {
    expect((await call("GET", "/rules", undefined, vendorUser, "vendor")).status).toBe(401);
    expect((await call("POST", "/rules/drafts", { key: "pricing", scopeType: "scenario", scopeId: "free", payload: { customerFeeBps: 0 }, reason: "nope nope" }, vendorUser, "vendor")).status).toBe(401);
  });
});

describe("draft → publish lifecycle", () => {
  it("requires a change reason", async () => {
    const r = await call("POST", "/rules/drafts", { key: "pricing", scopeType: "scenario", scopeId: "pass", payload: { customerFeeBps: 100 } });
    expect(r.status).toBe(400);
  });

  it("a scenario override changes resolution only for that scenario, field by field", async () => {
    const d = await draft("scenario", "host_activity", { successFeeBps: 900 });
    expect(d.status).toBe(200);
    expect((await resolveRule("pricing", { scenario: "host_activity" })).values.successFeeBps).toBe(0); // drafts never resolve

    const p = await call("POST", `/rules/${d.body.id}/publish`, { reason: "publish host override" });
    expect(p.status).toBe(200);
    const host = await resolveRule("pricing", { scenario: "host_activity" });
    expect(host.values.successFeeBps).toBe(900);
    expect(host.values.vatBps).toBe(2300); // untouched fields inherit from global
    expect(host.sources.map((s) => s.scopeType)).toEqual(["global", "scenario"]);
    expect((await resolveRule("pricing", { scenario: "venue_booking" })).values.successFeeBps).toBe(0);
  });

  it("published versions can't be edited or re-published", async () => {
    const { body } = await call("GET", "/rules?key=pricing");
    const published = body.find((r: any) => r.scopeType === "scenario" && r.scopeId === "host_activity" && r.status === "published");
    expect((await call("PUT", `/rules/${published.id}`, { payload: { successFeeBps: 1 }, reason: "try to edit history" })).status).toBe(409);
    expect((await call("POST", `/rules/${published.id}/publish`, { reason: "publish again" })).status).toBe(409);
  });

  it("refuses to take effect in the past (history is never re-priced)", async () => {
    const d = await draft("scenario", "free", { customerFeeBps: 0 });
    const r = await call("POST", `/rules/${d.body.id}/publish`, { reason: "backdate attempt", effectiveFrom: "2020-01-01T00:00:00Z" });
    expect(r.status).toBe(400);
    await call("POST", `/rules/${d.body.id}/discard`, { reason: "cleanup backdate test" });
  });

  it("a scheduled version is invisible until its effective date, then wins", async () => {
    const d = await draft("category", "pass", { customerFeeBps: 250 });
    const from = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    const p = await call("POST", `/rules/${d.body.id}/publish`, { reason: "schedule next week", effectiveFrom: from.toISOString() });
    expect(p.status).toBe(200);
    expect((await resolveRule("pricing", { category: "pass" })).values.customerFeeBps).toBe(500);
    expect((await resolveRule("pricing", { category: "pass" }, new Date(from.getTime() + 60_000))).values.customerFeeBps).toBe(250);
    const list = (await call("GET", "/rules?key=pricing")).body;
    expect(list.find((r: any) => r.id === d.body.id).lifecycle).toBe("scheduled");
  });

  it("a partner override can be ended, falling back to the wider scope", async () => {
    const d = await draft("partner", `org:${orgId}`, { successFeeBps: 300 });
    expect(d.status).toBe(200);
    await call("POST", `/rules/${d.body.id}/publish`, { reason: "partner deal" });
    expect((await resolveRule("pricing", { orgId })).values.successFeeBps).toBe(300);
    // Schedule the end an hour out: still in force now, gone afterwards.
    const endsAt = new Date(Date.now() + 3600 * 1000);
    const end = await call("POST", `/rules/${d.body.id}/end`, { reason: "partner deal over", effectiveTo: endsAt.toISOString() });
    expect(end.status).toBe(200);
    expect((await resolveRule("pricing", { orgId })).values.successFeeBps).toBe(300);
    expect((await resolveRule("pricing", { orgId }, new Date(endsAt.getTime() + 60_000))).values.successFeeBps).toBe(0);
    // A scheduled end can be brought forward to now; once ended it can't be ended again.
    const now = await call("POST", `/rules/${d.body.id}/end`, { reason: "end the partner deal now" });
    expect(now.status).toBe(200);
    expect((await resolveRule("pricing", { orgId }, new Date(Date.now() + 2000))).values.successFeeBps).toBe(0);
    expect((await call("POST", `/rules/${d.body.id}/end`, { reason: "end it twice" })).status).toBe(409);
  });

  it("rejects a partner override for an organisation that doesn't exist", async () => {
    expect((await draft("partner", "org:does-not-exist", { successFeeBps: 1 })).status).toBe(400);
  });

  it("the global rule can't be ended", async () => {
    const { body } = await call("GET", "/rules?key=pricing");
    const g1 = body.find((r: any) => r.scopeType === "global" && r.version === 1);
    expect((await call("POST", `/rules/${g1.id}/end`, { reason: "try ending global" })).status).toBe(409);
  });
});

describe("rollback", () => {
  it("rolls back by publishing a NEW version with the earlier values", async () => {
    const v1 = await draft("scenario", "programme", { customerFeeBps: 300 });
    await call("POST", `/rules/${v1.body.id}/publish`, { reason: "programme v1" });
    const v2 = await draft("scenario", "programme", { customerFeeBps: 100 });
    await call("POST", `/rules/${v2.body.id}/publish`, { reason: "programme v2" });
    expect((await resolveRule("pricing", { scenario: "programme" })).values.customerFeeBps).toBe(100);

    const rb = await call("POST", `/rules/${v1.body.id}/rollback`, { reason: "v2 was a mistake" });
    expect(rb.status).toBe(200);
    expect(rb.body.version).toBe(v2.body.version + 1);
    expect(rb.body.status).toBe("published");
    expect((await resolveRule("pricing", { scenario: "programme" })).values.customerFeeBps).toBe(300);
    // v2 itself is untouched — still published, now superseded.
    const after = (await call("GET", `/rules/${v2.body.id}`)).body.version;
    expect(after.status).toBe("published");
    expect(after.payload).toEqual({ customerFeeBps: 100 });
  });

  it("diff lists exactly the changed fields", async () => {
    const { body } = await call("GET", "/rules?key=pricing");
    const g1 = body.find((r: any) => r.scopeType === "global" && r.version === 1);
    const target = await draft("global", "", TARGET_MODEL_DRAFT.payload, "diff test draft (target model)");
    try {
      const d = await call("GET", `/rules/${g1.id}/diff/${target.body.id}`);
      expect(d.body.changes.map((c: any) => c.field).sort()).toEqual(["customerFeeBps", "successFeeBps", "vatMode"]);
    } finally {
      await call("POST", `/rules/${target.body.id}/discard`, { reason: "cleanup diff test" });
    }
  });
});

describe("two-person approval", () => {
  it("when enabled, the author can't approve or publish alone; a second admin can", async () => {
    await setSetting("commerce.require_second_approver", "true");
    try {
      const d = await draft("scenario", "experience", { customerFeeBps: 400 });
      expect((await call("POST", `/rules/${d.body.id}/publish`, { reason: "solo publish" })).status).toBe(403);
      expect((await call("POST", `/rules/${d.body.id}/approve`, { reason: "self approve" })).status).toBe(403);
      expect((await call("POST", `/rules/${d.body.id}/approve`, { reason: "second admin approves" }, adminB)).status).toBe(200);
      // Editing after approval voids it.
      await call("PUT", `/rules/${d.body.id}`, { payload: { customerFeeBps: 450 }, reason: "tweak after approval" });
      expect((await call("POST", `/rules/${d.body.id}/publish`, { reason: "publish edited" })).status).toBe(403);
      await call("POST", `/rules/${d.body.id}/approve`, { reason: "re-approve edited" }, adminB);
      expect((await call("POST", `/rules/${d.body.id}/publish`, { reason: "publish approved" })).status).toBe(200);
      expect((await resolveRule("pricing", { scenario: "experience" })).values.customerFeeBps).toBe(450);
    } finally {
      await setSetting("commerce.require_second_approver", "false");
    }
  });
});

describe("preview and audit", () => {
  it("previews a draft's money impact on sample prices", async () => {
    const g2 = await draft("global", "", TARGET_MODEL_DRAFT.payload, "preview test draft (target model)");
    const p = await call("GET", `/rules/${g2.body.id}/preview`);
    await call("POST", `/rules/${g2.body.id}/discard`, { reason: "cleanup preview test" });
    expect(p.status).toBe(200);
    const s = p.body.samples.find((x: any) => x.listMinor === 10_000);
    expect(s.current.customerPaidMinor).toBe(12_800); // today: +23% VAT +5% fee
    expect(s.proposed.customerPaidMinor).toBe(10_000); // target: one VAT-inclusive price
    expect(s.proposed.customerFeeMinor).toBe(0);
  });

  it("every change is audited with actor, reason, correlation id and environment", async () => {
    const { body } = await call("GET", "/audit");
    const mine = body.filter((a: any) => a.actorUserId === adminA);
    expect(mine.length).toBeGreaterThan(5);
    for (const a of mine) {
      expect(a.reason).toBeTruthy();
      expect(a.correlationId).toMatch(/^[0-9a-f-]{36}$/);
      expect(a.environment).toBeTruthy();
    }
    expect(mine.map((a: any) => a.action)).toEqual(expect.arrayContaining(["commerce_rule.draft_created", "commerce_rule.published", "commerce_rule.override_ended"]));
  });

  it("switches need a reason and are audited", async () => {
    expect((await call("PUT", "/switches/commerce.shadow_pricing", { enabled: true })).status).toBe(400);
    expect((await call("PUT", "/switches/commerce.not_a_switch", { enabled: true, reason: "unknown key" })).status).toBe(404);
    const ok = await call("PUT", "/switches/commerce.require_second_approver", { enabled: false, reason: "keep single-admin publish" });
    expect(ok.status).toBe(200);
  });
});
