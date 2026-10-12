import crypto from "node:crypto";
import http, { type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../db/index.js";
import { adminRouter } from "./admin.js";
import { helpRouter } from "./help.js";

// Revenue & Connect Stage 3 — field help: public read of the latest version,
// legal/super-only edits that add a version (never overwrite) with a reason.

const run = crypto.randomUUID().slice(0, 8);
const legal = `help-legal-${run}`;
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  await db.prepare(`INSERT INTO users (id, email, password_hash, role, status, name, admin_role) VALUES (?, ?, 'x', 'admin', 'approved', 'L', 'legal')`).run(legal, `${legal}@example.test`);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const role = req.header("X-Test-Admin-Role");
    if (role) (req as any).user = { id: legal, role: "admin", status: "approved", adminRole: role };
    next();
  });
  app.use("/help", helpRouter);
  app.use("/admin", adminRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.prepare(`DELETE FROM help_entries WHERE created_by = ?`).run(legal);
  await db.prepare(`DELETE FROM audit_log WHERE actor_user_id = ?`).run(legal);
  await db.prepare(`DELETE FROM users WHERE id = ?`).run(legal);
});

const put = (key: string, body: unknown, role?: string) =>
  fetch(`${baseUrl}/admin/help/${key}`, { method: "PUT", headers: { "Content-Type": "application/json", ...(role ? { "X-Test-Admin-Role": role } : {}) }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));

const entry = { name: "HelloCircle fee", definition: "Edited definition.", formula: "f", example: "e", whoPays: "The partner", whenCharged: "w", refundBehaviour: "r", policyKey: "payments-fees-payouts" };

describe("field help", () => {
  it("serves every seeded financial field, with the fee example matching test vector 1", async () => {
    const rows = await fetch(`${baseUrl}/help/fields`).then((r) => r.json());
    const keys = rows.map((r: { helpKey: string }) => r.helpKey);
    for (const k of ["customer_price", "platform_fee", "platform_fee_vat", "fee_base", "partner_payout", "venue_allocation", "host_allocation", "available_balance", "pro_break_even"]) expect(keys).toContain(k);
    // Commercial claims safety audit — the proposed fee model is no longer described as charged.
    const payout = rows.find((r: { helpKey: string }) => r.helpKey === "partner_payout");
    expect(payout.example).not.toContain("€88.93");
    expect(payout.definition).toContain("confirmed with you before paid bookings open");
  });

  it("fee-model entries carry the neutral correction; earlier versions are kept as history", async () => {
    const keys = ["platform_fee_vat", "fee_base", "partner_payout", "pro_break_even", "pro_benefit_1", "pro_benefit_2"];
    const rows = await fetch(`${baseUrl}/help/fields?keys=${keys.join(",")}`).then((r) => r.json());
    for (const r of rows as { helpKey: string; definition: string; example: string; formula: string }[]) {
      const text = `${r.definition} ${r.example} ${r.formula}`;
      expect(text, r.helpKey).not.toMatch(/\b9%|\b7%|€88\.93|success fee HelloCircle keeps|lower fee pays/);
      expect(r.definition, r.helpKey).toMatch(/confirmed/);
    }
    const versions = await fetch(`${baseUrl}/admin/help/fee_base/versions`, { headers: { "X-Test-Admin-Role": "legal" } }).then((x) => x.json());
    expect(versions.length).toBeGreaterThanOrEqual(2);
  });

  it("filters by key and ignores malformed keys", async () => {
    const rows = await fetch(`${baseUrl}/help/fields?keys=platform_fee,DROP%20TABLE`).then((r) => r.json());
    expect(rows.map((r: { helpKey: string }) => r.helpKey)).toEqual(["platform_fee"]);
  });

  it("only legal or super admins can edit; finance and anonymous cannot", async () => {
    expect((await put("platform_fee", { ...entry, reason: "clarify wording" })).status).toBe(401);
    expect((await put("platform_fee", { ...entry, reason: "clarify wording" }, "finance")).status).toBe(403);
  });

  it("an edit needs a reason and adds a version; the old version is kept", async () => {
    expect((await put("platform_fee", entry, "legal")).status).toBe(400);
    const before = await fetch(`${baseUrl}/help/fields?keys=platform_fee`).then((r) => r.json());
    const r = await put("platform_fee", { ...entry, reason: "clarify wording" }, "legal");
    expect(r.status).toBe(200);
    expect(r.body.version).toBe(before[0].version + 1);
    const after = await fetch(`${baseUrl}/help/fields?keys=platform_fee`).then((x) => x.json());
    expect(after[0].definition).toBe("Edited definition.");
    const versions = await fetch(`${baseUrl}/admin/help/platform_fee/versions`, { headers: { "X-Test-Admin-Role": "legal" } }).then((x) => x.json());
    expect(versions.length).toBeGreaterThanOrEqual(2);
    expect(versions.at(-1).definition).not.toBe("Edited definition.");
    expect((await put("no_such_key", { ...entry, reason: "clarify wording" }, "legal")).status).toBe(404);
  });
});
