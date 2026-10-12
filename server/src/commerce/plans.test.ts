import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { adminRouter } from "../routes/admin.js";
import { RULE_KEYS, validatePayload } from "./catalog.js";
import { currentPlanFor, planTermsFor, proBreakEvenMinor } from "./plans.js";
import { resolveRule } from "./rules.js";

// Revenue & Connect Stage 2a — configuration keys, admin sub-roles, the
// review/retire workflow, plan assignments and the founding-partner
// promotion, through the real admin routes. Identity is stubbed at req.user.

const run = crypto.randomUUID().slice(0, 8);
const ids = {
  super: `p-super-${run}`,
  super2: `p-super2-${run}`,
  finance: `p-fin-${run}`,
  finance2: `p-fin2-${run}`,
  support: `p-sup-${run}`,
  legal: `p-legal-${run}`,
};
const orgs = [1, 2, 3, 4, 5].map((n) => `p-org${n}-${run}`);
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const roles: [string, string][] = [[ids.super, "super"], [ids.super2, "super"], [ids.finance, "finance"], [ids.finance2, "finance"], [ids.support, "support"], [ids.legal, "legal"]];
  for (const [id, role] of roles) {
    await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name, admin_role) VALUES (?, ?, 'x', 'admin', 'approved', 'A', ?)`).run(id, `${id}@example.test`, role);
  }
  for (const o of orgs) await db.prepare(`INSERT INTO organisations (id, name) VALUES (?, 'Plan Test Org')`).run(o);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const id = req.header("X-Test-User-Id");
    const role = req.header("X-Test-Admin-Role");
    if (id) (req as any).user = { id, role: "admin", status: "approved", adminRole: role ?? "super" };
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
  const all = Object.values(ids);
  await db.prepare(`DELETE FROM promotion_enrollments WHERE partner_id IN (${orgs.map(() => "?").join(",")})`).run(...orgs);
  await db.prepare(`DELETE FROM promotion_campaigns WHERE campaign_key LIKE ?`).run(`%${run}`);
  await db.prepare(`DELETE FROM partner_plan_assignments WHERE partner_id IN (${orgs.map(() => "?").join(",")})`).run(...orgs);
  await db.prepare(`DELETE FROM commerce_rule_versions WHERE created_by IN (${all.map(() => "?").join(",")})`).run(...all);
  await db.prepare(`DELETE FROM audit_log WHERE actor_user_id IN (${all.map(() => "?").join(",")})`).run(...all);
  await db.prepare(`DELETE FROM organisations WHERE id IN (${orgs.map(() => "?").join(",")})`).run(...orgs);
  await db.prepare(`DELETE FROM users WHERE id IN (${all.map(() => "?").join(",")})`).run(...all);
});

async function call(method: string, path: string, body?: unknown, as = ids.finance, adminRole = "finance") {
  const res = await fetch(`${baseUrl}/admin${path}`, {
    method,
    headers: { "Content-Type": "application/json", "X-Test-User-Id": as, "X-Test-Admin-Role": adminRole },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

describe("configuration catalog (brief defaults as version 1)", () => {
  const keys = ["plan_free", "plan_pro", "plan_rules", "entitlements_free", "entitlements_pro", "tax_vat", "payment_costs", "settlement", "rewards", "credits", "availability"];
  it("every new key has a complete, valid v1 that resolves from the database", async () => {
    for (const key of keys) {
      expect(validatePayload(key, "global", RULE_KEYS[key].v1)).toEqual({ ok: true, errors: [] });
      expect((await resolveRule(key)).values).toEqual(RULE_KEYS[key].v1);
    }
  });
  it("holds the brief's numbers, not hardcoded ones", async () => {
    expect((await resolveRule("plan_free")).values).toMatchObject({ successFeeBps: 900, minFeeMinor: 75, subscriptionMonthlyMinor: 0 });
    expect((await resolveRule("plan_pro")).values).toMatchObject({ successFeeBps: 700, minFeeMinor: 50, subscriptionMonthlyMinor: 2_900 });
    expect((await resolveRule("tax_vat")).values).toMatchObject({ vatBps: 2_300, vatMode: "standard" });
    expect((await resolveRule("settlement")).values).toMatchObject({ reviewHours: 48, minPayoutMinor: 2_500, payoutSchedule: "weekly" });
    expect((await resolveRule("rewards")).values).toMatchObject({ pointsPerEuro: 1, redemptionPoints: 10_000, expiryMonths: 18 });
    expect((await resolveRule("plan_rules")).values).toMatchObject({ graceDays: 7, downgradeTakesEffect: "end_of_billing_period" });
  });
  it("the Free plan keeps every feature that exists for partners today", () => {
    const free = RULE_KEYS.entitlements_free.v1;
    for (const live of ["waitlists", "recurringActivities", "teamMembers"]) expect(free[live]).toBe("included");
  });
  it("Pro break-even: €29 / 2% = €1,450 monthly GMV", () => {
    expect(proBreakEvenMinor(900, 700, 2_900)).toBe(145_000);
    expect(proBreakEvenMinor(700, 700, 2_900)).toBeNull();
  });
});

describe("admin sub-roles (risk P1-1)", () => {
  it("finance (and super) can manage commercial rules and coupons; support and legal can't", async () => {
    expect((await call("GET", "/commerce/rules", undefined, ids.finance, "finance")).status).toBe(200);
    expect((await call("GET", "/commerce/rules", undefined, ids.super, "super")).status).toBe(200);
    expect((await call("GET", "/commerce/rules", undefined, ids.support, "support")).status).toBe(403);
    expect((await call("GET", "/commerce/rules", undefined, ids.legal, "legal")).status).toBe(403);
    expect((await call("GET", "/coupons", undefined, ids.support, "support")).status).toBe(403);
    expect((await call("GET", "/coupons", undefined, ids.finance, "finance")).status).toBe(200);
  });

  it("only a super admin assigns roles, with a reason, and never their own", async () => {
    expect((await call("PUT", `/admins/${ids.support}/role`, { adminRole: "finance", reason: "promote to finance" }, ids.finance, "finance")).status).toBe(403);
    expect((await call("PUT", `/admins/${ids.support}/role`, { adminRole: "finance" }, ids.super, "super")).status).toBe(400);
    expect((await call("PUT", `/admins/${ids.super}/role`, { adminRole: "legal", reason: "demote myself" }, ids.super, "super")).status).toBe(403);
    const ok = await call("PUT", `/admins/${ids.legal}/role`, { adminRole: "support", reason: "moving to support desk" }, ids.super, "super");
    expect(ok.status).toBe(200);
    const audit = (await db.prepare(`SELECT reason FROM audit_log WHERE action = 'admin.role_changed' AND object_id = ?`).get(ids.legal)) as { reason: string };
    expect(audit.reason).toBe("moving to support desk");
  });

  it("the last super admin can't be demoted", async () => {
    // Make this test's super the only one: park every other super admin as
    // finance for the duration, then restore them exactly.
    const others = (await db.prepare(`SELECT id FROM users WHERE role = 'admin' AND COALESCE(admin_role, 'super') = 'super' AND id != ?`).all(ids.super)) as { id: string }[];
    for (const o of others) await db.prepare(`UPDATE users SET admin_role = 'finance' WHERE id = ?`).run(o.id);
    try {
      const r = await call("PUT", `/admins/${ids.super}/role`, { adminRole: "finance", reason: "try removing the last super" }, ids.finance, "super");
      expect(r.status).toBe(409);
      expect(r.body.error).toBe("At least one super admin must remain");
    } finally {
      for (const o of others) await db.prepare(`UPDATE users SET admin_role = 'super' WHERE id = ?`).run(o.id);
    }
  });

  it("rule changes record the admin's role in the audit log", async () => {
    const d = await call("POST", "/commerce/rules/drafts", { key: "plan_free", scopeType: "partner", scopeId: `org:${orgs[0]}`, payload: { successFeeBps: 800 }, reason: "partner pilot rate" });
    expect(d.status).toBe(200);
    const row = (await db.prepare(`SELECT actor_role as role FROM audit_log WHERE action = 'commerce_rule.draft_created' AND object_id = ?`).get(String(d.body.id))) as { role: string };
    expect(row.role).toBe("finance");
  });
});

describe("configuration workflow: draft → review → approve → publish → retire", () => {
  it("runs the full lifecycle; a retired override stops applying", async () => {
    const d = await call("POST", "/commerce/rules/drafts", { key: "plan_free", scopeType: "partner", scopeId: `org:${orgs[1]}`, payload: { minFeeMinor: 50 }, reason: "negotiated minimum" });
    expect((await call("POST", `/commerce/rules/${d.body.id}/review`, { reason: "ready for review" })).body.status).toBe("review");
    expect((await call("POST", `/commerce/rules/${d.body.id}/review`, { reason: "again" })).status).toBe(409);
    expect((await call("POST", `/commerce/rules/${d.body.id}/approve`, { reason: "self approval" })).status).toBe(403);
    const approved = await call("POST", `/commerce/rules/${d.body.id}/approve`, { reason: "checked the numbers" }, ids.finance2, "finance");
    expect(approved.body).toMatchObject({ status: "approved", approvedBy: ids.finance2 });
    expect((await call("POST", `/commerce/rules/${d.body.id}/publish`, { reason: "go live" })).body.status).toBe("published");
    expect((await resolveRule("plan_free", { orgId: orgs[1] })).values.minFeeMinor).toBe(50);

    const retired = await call("POST", `/commerce/rules/${d.body.id}/retire`, { reason: "deal ended" });
    expect(retired.body.status).toBe("retired");
    expect((await resolveRule("plan_free", { orgId: orgs[1] })).values.minFeeMinor).toBe(75);
    expect((await call("POST", `/commerce/rules/${d.body.id}/retire`, { reason: "retire twice" })).status).toBe(409);
  });

  it("the global version in force can't be retired", async () => {
    const { body } = await call("GET", "/commerce/rules?key=plan_pro");
    const g = body.find((r: any) => r.scopeType === "global" && r.inForce);
    expect((await call("POST", `/commerce/rules/${g.id}/retire`, { reason: "try retiring global" })).status).toBe(409);
  });
});

describe("plan assignments", () => {
  it("partners start on Free; Free terms resolve from the published rules", async () => {
    const plan = await currentPlanFor({ kind: "org", id: orgs[2] });
    expect(plan).toMatchObject({ planKey: "free", feePlanKey: "free", source: "default" });
    const terms = await planTermsFor({ kind: "org", id: orgs[2] });
    expect(terms.fees.values.successFeeBps).toBe(900);
  });

  it("an admin assignment to Pro applies from now, needs a reason, and can't be back-dated", async () => {
    expect((await call("POST", `/commerce/partners/org/${orgs[2]}/plan`, { planKey: "pro" })).status).toBe(400);
    expect((await call("POST", `/commerce/partners/org/${orgs[2]}/plan`, { planKey: "pro", reason: "back-dated", effectiveFrom: "2020-01-01" })).status).toBe(400);
    const r = await call("POST", `/commerce/partners/org/${orgs[2]}/plan`, { planKey: "pro", reason: "manual upgrade for testing" });
    expect(r.status).toBe(200);
    expect(r.body.current).toMatchObject({ planKey: "pro", source: "admin" });
    expect((await planTermsFor({ kind: "org", id: orgs[2] })).fees.values.successFeeBps).toBe(700);
    // Only one assignment is ever in force.
    await call("POST", `/commerce/partners/org/${orgs[2]}/plan`, { planKey: "free", reason: "back to free" });
    const open = (await db.prepare(`SELECT COUNT(*) as n FROM partner_plan_assignments WHERE partner_id = ? AND effective_to IS NULL`).get(orgs[2])) as { n: number };
    expect(Number(open.n)).toBe(1);
    expect((await currentPlanFor({ kind: "org", id: orgs[2] })).planKey).toBe("free");
  });

  it("the Enterprise plan is disabled for the MVP", async () => {
    expect((await call("POST", `/commerce/partners/org/${orgs[2]}/plan`, { planKey: "enterprise", reason: "try enterprise" })).status).toBe(409);
  });

  it("unknown partners are refused", async () => {
    expect((await call("POST", `/commerce/partners/org/no-such-org/plan`, { planKey: "pro", reason: "ghost partner" })).status).toBe(404);
  });
});

describe("founding-partner promotion", () => {
  let campaignId: number;
  it("an admin creates a capped, dated campaign with terms and a reason", async () => {
    const r = await call("POST", "/commerce/campaigns", {
      campaignKey: `founding-${run}`,
      planKey: "pro",
      commissionPlanKey: "free",
      benefitDays: 90,
      maxEnrollments: 2,
      startsAt: new Date(Date.now() - 60_000).toISOString(),
      endsAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
      terms: "Pro subscription waived for 90 days; commission not waived.",
      reason: "Founding partner launch",
    });
    expect(r.status).toBe(200);
    campaignId = r.body.id;
  });

  it("enrolment gives Pro features for 90 days while commission stays on Free rates (decision B12)", async () => {
    const r = await call("POST", `/commerce/campaigns/${campaignId}/enroll`, { partnerKind: "org", partnerId: orgs[3], reason: "approved founding partner" });
    expect(r.status).toBe(200);
    const terms = await planTermsFor({ kind: "org", id: orgs[3] });
    expect(terms.assignment).toMatchObject({ planKey: "pro", feePlanKey: "free", source: "promotion" });
    expect(terms.fees.values.successFeeBps).toBe(900);
    expect(terms.entitlements?.values.advancedAnalytics).toBe("included");
    const days = (new Date(terms.assignment.effectiveTo!).getTime() - Date.now()) / (24 * 3600 * 1000);
    expect(Math.round(days)).toBe(90);
    // After the benefit ends the partner is back on Free.
    const after = await currentPlanFor({ kind: "org", id: orgs[3] }, new Date(Date.now() + 91 * 24 * 3600 * 1000));
    expect(after.planKey).toBe("free");
  });

  it("a partner can't enrol twice, and the cap holds under concurrent enrolments", async () => {
    expect((await call("POST", `/commerce/campaigns/${campaignId}/enroll`, { partnerKind: "org", partnerId: orgs[3], reason: "enrol again" })).status).toBe(409);
    const results = await Promise.all(
      [orgs[0], orgs[1], orgs[4]].map((o) => call("POST", `/commerce/campaigns/${campaignId}/enroll`, { partnerKind: "org", partnerId: o, reason: "race to enrol" }))
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1); // cap 2, one already enrolled
    const { n } = (await db.prepare(`SELECT COUNT(*) as n FROM promotion_enrollments WHERE campaign_id = ?`).get(campaignId)) as { n: number };
    expect(Number(n)).toBe(2);
  });
});
